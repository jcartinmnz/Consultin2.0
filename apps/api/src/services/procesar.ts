import type { Env } from "../env";
import type { Db } from "../db/client";
import type { ChannelAdapter, InboundMessage } from "../channels/types";
import type { OrderSource, PriceSource } from "../sources/types";
import { correrAgente, type LlmClient } from "../agent/run";
import { toolsPara } from "../agent/tools";
import { systemPrompt } from "../agent/prompt";
import * as repo from "./repo";
import { MENSAJES, pideHumano, resumenDesdeHistorial } from "./reglas";

export interface Deps {
  env: Env;
  db: Db;
  channel: ChannelAdapter;
  llm: LlmClient;
  sources: { prices: PriceSource; orders: OrderSource };
  /**
   * Cuánto esperar antes de responder, para juntar mensajes seguidos ("hola" / "quiero info" / "¿precio?")
   * y contestar una sola vez. 0 = responder de inmediato.
   */
  esperaMs?: number;
}

/** Espera por defecto y máxima (el procesamiento corre en waitUntil, que tiene ~30 s de margen). */
export const ESPERA_DEFAULT_S = 6;
export const ESPERA_MAX_S = 15;

/** Cómo se atiende una conexión. Sin conexión (dev, Forja) = modo ópticas con el prompt base. */
export interface ConfigConexion { modo: "opticas" | "abierto"; prompt: string | null }

/** Flujo completo de un mensaje entrante. Ver CLAUDE.md → "Flujo de un mensaje". */
export async function procesarMensaje(d: Deps, msg: InboundMessage, conexion: ConfigConexion = { modo: "opticas", prompt: null }): Promise<void> {
  const { db, env, channel } = d;
  const t0 = Date.now();

  // 1. Identidad: solo un teléfono de WhatsApp registrado identifica a una óptica (nunca el texto ni el nombre)
  const ident = msg.telefono ? await repo.identificar(db, msg.telefono) : null;
  const conv = await repo.upsertConversacion(db, {
    canal: msg.canal, externalId: msg.conversacionExtId, telefono: msg.telefono, opticaId: ident?.optica.id ?? null,
    cuentaId: msg.cuentaId, participanteNombre: msg.nombrePerfil,
  });

  // 2. Guardar mensaje (idempotente ante reintentos del webhook)
  const nuevo = await repo.guardarMensaje(db, { conversacionId: conv.id, rol: "cliente", contenido: msg.texto, externalId: `${msg.canal}:${msg.mensajeExtId}` });
  if (!nuevo) return;
  await repo.registrarEvento(db, { conversacionId: conv.id, tipo: "mensaje_entrante" });

  // 3. Si una persona ya tomó la conversación, el bot no responde
  if (conv.estado === "humano") return;

  // 3b. Ráfaga: esperar por si llegan más mensajes. Solo responde el último; como el agente lee el
  //     historial completo, contesta a todos juntos en un solo mensaje.
  if (d.esperaMs && d.esperaMs > 0) {
    await new Promise((r) => setTimeout(r, d.esperaMs));
    if ((await repo.ultimoMensajeCliente(db, conv.id)) !== nuevo) return; // llegó otro: ese responde por todos
    if ((await repo.estadoConversacion(db, conv.id)) === "humano") return; // apagaron el agente durante la espera
  }
  const textoRafaga = (await repo.textoPendiente(db, conv.id)) || msg.texto;

  // Primero se envía y solo después se guarda: el chat del panel nunca muestra como enviado algo que no salió.
  // Si el canal falla (ventana de 24 h cerrada, cuenta desconectada…), queda un caso con el texto que no salió.
  const responder = async (texto: string) => {
    try {
      await channel.enviar(msg.conversacionExtId, texto);
    } catch (err) {
      console.error("[envío]", err);
      await repo.registrarEvento(db, { conversacionId: conv.id, tipo: "error", metadata: { etapa: "envio", mensaje: String(err).slice(0, 500) } });
      await repo.crearCaso(db, {
        conversacionId: conv.id, opticaId: ident?.optica.id ?? null, nivel: "N2", motivo: "otro",
        resumen: `No se pudo enviar la respuesta por ${msg.canal} (${String((err as Error).message ?? err).slice(0, 200)}).\nRespuesta que no salió: ${texto.slice(0, 800)}`,
      });
      return;
    }
    await repo.guardarMensaje(db, { conversacionId: conv.id, rol: "bot", contenido: texto });
    await repo.registrarEvento(db, { conversacionId: conv.id, tipo: "respuesta", latenciaMs: Date.now() - t0 });
  };

  // 4. Modo ópticas + número no registrado → caso N2, sin pasar por el modelo.
  //    En modo abierto (p. ej. Instagram) el agente atiende igual, pero sin precios ni órdenes.
  if (!ident && conexion.modo === "opticas") {
    await repo.crearCaso(db, {
      conversacionId: conv.id, opticaId: null, nivel: "N2", motivo: "numero_no_registrado",
      resumen: `Número ${msg.telefono}${msg.nombrePerfil ? ` (${msg.nombrePerfil})` : ""} escribió: "${textoRafaga.slice(0, 300)}"`,
    });
    return responder(MENSAJES.noRegistrado(env.LAB_NAME));
  }

  const turnos = await repo.historial(db, conv.id);
  const quien = ident?.optica.nombre ?? msg.nombrePerfil ?? msg.telefono;

  // 5. Pide hablar con una persona → caso N2 directo
  if (textoRafaga.split("\n").some(pideHumano)) {
    await repo.crearCaso(db, {
      conversacionId: conv.id, opticaId: ident?.optica.id ?? null, nivel: "N2", motivo: "pide_humano",
      resumen: resumenDesdeHistorial(turnos),
    });
    return responder(MENSAJES.handoff);
  }

  // 6. Agente con herramientas
  let texto: string;
  try {
    const instrucciones = conexion.prompt ?? await repo.leerConfig(db, "prompt_base");
    const r = await correrAgente({
      llm: d.llm,
      model: env.ANTHROPIC_MODEL,
      system: systemPrompt({
        instrucciones, lab: env.LAB_NAME, optica: ident?.optica ?? null, contacto: ident?.contacto.nombre ?? null,
        participante: msg.nombrePerfil, plataforma: msg.canal, herramientasCompletas: !!ident, ahora: new Date(),
      }),
      historial: turnos,
      tools: toolsPara(!!ident),
      ctx: {
        prices: d.sources.prices,
        orders: d.sources.orders,
        optica: ident?.optica ?? null,
        escalar: async (e) => { await repo.crearCaso(db, { conversacionId: conv.id, opticaId: ident?.optica.id ?? null, ...e }); },
      },
    });
    for (const tc of r.toolCalls) {
      await repo.registrarEvento(db, { conversacionId: conv.id, tipo: "tool_call", tool: tc.tool, ok: tc.ok, latenciaMs: tc.latenciaMs, metadata: { input: tc.input } });
    }
    await repo.registrarEvento(db, { conversacionId: conv.id, tipo: "uso_llm", metadata: r.usage });
    texto = r.texto || MENSAJES.handoff;
  } catch (err) {
    console.error("[agente]", err);
    await repo.registrarEvento(db, { conversacionId: conv.id, tipo: "error", metadata: { etapa: "agente", mensaje: String(err).slice(0, 500) } });
    await repo.crearCaso(db, { conversacionId: conv.id, opticaId: ident?.optica.id ?? null, nivel: "N2", motivo: "otro", resumen: `Error técnico del agente (${quien}).\n${resumenDesdeHistorial(turnos)}` });
    texto = MENSAJES.errorGeneral;
  }
  await responder(texto);
}
