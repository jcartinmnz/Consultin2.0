import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { AppBindings } from "../env";
import { buildDeps } from "../deps";
import { DevChannel } from "../channels/dev";
import { procesarMensaje } from "../services/procesar";
import { conversaciones } from "../db/schema";

export const dev = new Hono<AppBindings>();

/**
 * Prueba el agente de punta a punta con curl, sin WhatsApp ni Instagram (herramienta de desarrollo).
 *   curl -X POST localhost:8787/dev/chat -H 'content-type: application/json' \
 *        -H "authorization: Bearer $ADMIN_API_KEY" \
 *        -d '{"telefono":"50688880001","texto":"cuánto sale un progresivo 1.67 con AR?"}'
 * Funciona con cualquier CHANNEL (usa su propio canal "dev"); se apaga con SIMULADOR=off.
 * Protegido con ADMIN_API_KEY (ver index.ts).
 */
dev.use("*", async (c, next) => {
  if (c.env.SIMULADOR === "off") return c.json({ error: "Simulador apagado (SIMULADOR=off)" }, 404);
  await next();
});

dev.post("/chat", async (c) => {
  const channel = new DevChannel();
  const deps = buildDeps(c.env, channel);
  const [msg] = await channel.parseWebhook(c.req.raw);
  await procesarMensaje(deps, msg!);
  const [conv] = await deps.db.select({ estado: conversaciones.estado }).from(conversaciones)
    .where(and(eq(conversaciones.canal, "dev"), eq(conversaciones.externalId, msg!.conversacionExtId)));
  return c.json({ respuestas: channel.salida, estado: conv?.estado ?? "bot" });
});
