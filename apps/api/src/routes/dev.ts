import { Hono } from "hono";
import type { AppBindings } from "../env";
import { buildDeps } from "../deps";
import { DevChannel } from "../channels/dev";
import { procesarMensaje } from "../services/procesar";

export const dev = new Hono<AppBindings>();

/**
 * Simula WhatsApp para probar el agente de punta a punta.
 *   curl -X POST localhost:8787/dev/chat -H 'content-type: application/json' \
 *        -d '{"telefono":"50688880001","texto":"cuánto sale un progresivo 1.67 con AR?"}'
 * Solo disponible con CHANNEL=dev.
 */
dev.post("/chat", async (c) => {
  if (c.env.CHANNEL !== "dev") return c.json({ error: "Solo disponible con CHANNEL=dev" }, 404);
  const channel = new DevChannel();
  const deps = buildDeps(c.env, channel);
  const [msg] = await channel.parseWebhook(c.req.raw);
  await procesarMensaje(deps, msg!);
  return c.json({ respuestas: channel.salida });
});
