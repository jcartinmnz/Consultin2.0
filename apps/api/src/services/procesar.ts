import type { Env } from "../env";
import type { Db } from "../db/client";
import type { ChannelAdapter, InboundMessage } from "../channels/types";
import type { OrderSource, PriceSource } from "../sources/types";
import { correrAgente, type LlmClient } from "../agent/run";
import { systemPrompt } from "../agent/prompt";
import * as repo from "./repo";
import { MENSAJES, pideHumano, resumenDesdeHistorial } from "./reglas";

export interface Deps {
  env: Env;
  db: Db;
  channel: ChannelAdapter;
  llm: LlmClient;
  sources: { prices: PriceSource; orders: OrderSource };
}

/** Flujo completo de un mensaje entrante. Ver CLAUDE.md → "Flujo de un mensaje". */
export async function procesarMensaje(d: Deps, msg: InboundMessage): Promise<void> {
  const { db, env, channel } = d;
  const t0 = Date.now();

  // 1. Identidad: el número debe pertenecer a una óptica registrada
  const ident = await repo.identificar(db, msg.telefono);
  const conv = await repo.upsertConversacion(db, {
    canal: msg.canal, externalId: msg.conversacionExtId, telefono: msg.telefono, opticaId: ident?.optica.id ?? null,
  });

  // 2. Guardar mensaje (idempotente ante reintentos del webhook)
  const nuevo = await repo.guardarMensaje(db, { conversacionId: conv.id, rol: "cliente", contenido: msg.texto, externalId: `${msg.canal}:${msg.mensajeExtId}` });
  if (!nuevo) return;
  await repo.registrarEvento(db, { conversacionId: conv.id, tipo: "mensaje_entrante" });

  // 3. Si una persona ya tomó la conversación, el bot no responde
  if (conv.estado === "humano") return;

  const responder = async (texto: string) => {
    await repo.guardarMensaje(db, { conversacionId: conv.id, rol: "bot", contenido: texto });
    await channel.enviar(msg.conversacionExtId, texto);
    await repo.registrarEvento(db, { conversacionId: conv.id, tipo: "respuesta", latenciaMs: Date.now() - t0 });
  };

  // 4. Número no registrado → caso N2, sin pasar por el modelo
  if (!ident) {
    await repo.crearCaso(db, {
      conversacionId: conv.id, opticaId: null, nivel: "N2", motivo: "numero_no_registrado",
      resumen: `Número ${msg.telefono}${msg.nombrePerfil ? ` (${msg.nombrePerfil})` : ""} escribió: "${msg.texto.slice(0, 300)}"`,
    });
    return responder(MENSAJES.noRegistrado(env.LAB_NAME));
  }

  const turnos = await repo.historial(db, conv.id);

  // 5. Pide hablar con una persona → caso N2 directo
  if (pideHumano(msg.texto)) {
    await repo.crearCaso(db, {
      conversacionId: conv.id, opticaId: ident.optica.id, nivel: "N2", motivo: "pide_humano",
      resumen: resumenDesdeHistorial(turnos),
    });
    return responder(MENSAJES.handoff);
  }

  // 6. Agente con herramientas
  try {
    const r = await correrAgente({
      llm: d.llm,
      model: env.ANTHROPIC_MODEL,
      system: systemPrompt({ lab: env.LAB_NAME, optica: ident.optica, contacto: ident.contacto.nombre, ahora: new Date() }),
      historial: turnos,
      ctx: {
        prices: d.sources.prices,
        orders: d.sources.orders,
        optica: ident.optica,
        escalar: async (e) => { await repo.crearCaso(db, { conversacionId: conv.id, opticaId: ident.optica.id, ...e }); },
      },
    });
    for (const tc of r.toolCalls) {
      await repo.registrarEvento(db, { conversacionId: conv.id, tipo: "tool_call", tool: tc.tool, ok: tc.ok, latenciaMs: tc.latenciaMs, metadata: { input: tc.input } });
    }
    await repo.registrarEvento(db, { conversacionId: conv.id, tipo: "uso_llm", metadata: r.usage });
    await responder(r.texto || MENSAJES.handoff);
  } catch (err) {
    console.error("[agente]", err);
    await repo.registrarEvento(db, { conversacionId: conv.id, tipo: "error", metadata: { mensaje: String(err) } });
    await repo.crearCaso(db, { conversacionId: conv.id, opticaId: ident.optica.id, nivel: "N2", motivo: "otro", resumen: `Error técnico del agente.\n${resumenDesdeHistorial(turnos)}` });
    await responder(MENSAJES.errorGeneral);
  }
}
