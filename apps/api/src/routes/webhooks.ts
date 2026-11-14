import { Hono } from "hono";
import type { AppBindings } from "../env";
import { buildDeps } from "../deps";
import { procesarMensaje } from "../services/procesar";

export const webhooks = new Hono<AppBindings>();

/**
 * Webhook de Zernio. Responde 200 de inmediato y procesa en segundo plano
 * (waitUntil) para no exceder el timeout del proveedor.
 * Si el volumen crece: mover a Cloudflare Queues.
 */
webhooks.post("/zernio", async (c) => {
  const deps = buildDeps(c.env);
  let mensajes;
  try {
    mensajes = await deps.channel.parseWebhook(c.req.raw);
  } catch (err) {
    console.warn("[webhook] rechazado:", err);
    return c.json({ ok: false }, 401);
  }
  c.executionCtx.waitUntil(Promise.all(mensajes.map((m) => procesarMensaje(deps, m).catch((e) => console.error(e)))));
  return c.json({ ok: true, recibidos: mensajes.length });
});
