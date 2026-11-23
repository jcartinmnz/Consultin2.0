import { Hono } from "hono";
import type { AppBindings } from "../env";
import { buildDeps } from "../deps";
import { ESPERA_DEFAULT_S, ESPERA_MAX_S, MODOS_CONEXION, procesarMensaje, type ModoConexion } from "../services/procesar";
import * as repo from "../services/repo";

export const webhooks = new Hono<AppBindings>();

/**
 * Webhook de Zernio. Responde 200 de inmediato y procesa en segundo plano
 * (waitUntil) para no exceder el timeout del proveedor.
 * Si el volumen crece: mover a Cloudflare Queues.
 */
webhooks.post("/zernio", async (c) => {
  // Sin esto, con CHANNEL=dev el webhook usaría el canal de desarrollo, que acepta
  // cualquier teléfono sin firma: cualquiera podría suplantar a una óptica.
  if (c.env.CHANNEL !== "zernio") return c.json({ error: "Webhook de Zernio inactivo (CHANNEL != zernio)" }, 404);
  const deps = buildDeps(c.env);
  let mensajes;
  try {
    mensajes = await deps.channel.parseWebhook(c.req.raw);
  } catch (err) {
    console.warn("[webhook] rechazado:", err);
    return c.json({ ok: false }, 401);
  }
  // Espera para juntar mensajes seguidos (panel → Ajustes)
  deps.esperaMs = mensajes.length ? await leerEsperaMs(deps.db) : 0;

  // Solo se atienden las cuentas dadas de alta (y activas) en el panel → Ajustes → Conexiones
  const procesar = async (m: (typeof mensajes)[number]) => {
    const conexion = m.cuentaId ? await repo.conexionActiva(deps.db, m.cuentaId) : null;
    if (!conexion) { console.log(`[webhook] cuenta ${m.cuentaId} no conectada a Consultin: ignorado`); return; }
    const modo = (MODOS_CONEXION as readonly string[]).includes(conexion.modo) ? (conexion.modo as ModoConexion) : "opticas";
    await procesarMensaje(deps, m, { modo, prompt: conexion.prompt });
  };
  c.executionCtx.waitUntil(Promise.all(mensajes.map((m) => procesar(m).catch((e) => console.error(e)))));
  return c.json({ ok: true, recibidos: mensajes.length });
});

export async function leerEsperaMs(db: Parameters<typeof repo.leerConfig>[0]): Promise<number> {
  const v = Number(await repo.leerConfig(db, "espera_segundos").catch(() => null) ?? ESPERA_DEFAULT_S);
  return Math.round(Math.min(Math.max(Number.isFinite(v) ? v : ESPERA_DEFAULT_S, 0), ESPERA_MAX_S) * 1000);
}
