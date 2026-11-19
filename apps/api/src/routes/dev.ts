import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import type { AppBindings } from "../env";
import { buildDeps } from "../deps";
import { DevChannel, devConversacionId } from "../channels/dev";
import { procesarMensaje } from "../services/procesar";
import { getDb } from "../db/client";
import { contactos, conversaciones, mensajes, opticas } from "../db/schema";

export const dev = new Hono<AppBindings>();

/**
 * Simula WhatsApp para probar el agente de punta a punta (lo usa el simulador del panel).
 *   curl -X POST localhost:8787/dev/chat -H 'content-type: application/json' \
 *        -H "authorization: Bearer $ADMIN_API_KEY" \
 *        -d '{"telefono":"50688880001","texto":"cuánto sale un progresivo 1.67 con AR?"}'
 * Solo disponible con CHANNEL=dev. Protegido con ADMIN_API_KEY (ver index.ts).
 */
dev.use("*", async (c, next) => {
  if (c.env.CHANNEL !== "dev") return c.json({ error: "Solo disponible con CHANNEL=dev" }, 404);
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

/** Mensajes y estado de una conversación del simulador (para ver respuestas enviadas desde el CRM). */
dev.get("/conversacion", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const extId = devConversacionId(c.req.query("telefono") ?? "", c.req.query("sesion"));
  const [conv] = await db.select().from(conversaciones)
    .where(and(eq(conversaciones.canal, "dev"), eq(conversaciones.externalId, extId)));
  if (!conv) return c.json({ estado: "bot", mensajes: [] });
  const chat = await db.select({ id: mensajes.id, rol: mensajes.rol, contenido: mensajes.contenido, autor: mensajes.autor, createdAt: mensajes.createdAt })
    .from(mensajes).where(eq(mensajes.conversacionId, conv.id)).orderBy(asc(mensajes.createdAt));
  return c.json({ estado: conv.estado, mensajes: chat });
});

/** Teléfonos registrados, para elegir "como quién" escribir en el simulador. */
dev.get("/contactos", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const rows = await db.select({ telefono: contactos.telefono, nombre: contactos.nombre, optica: opticas.nombre })
    .from(contactos).innerJoin(opticas, eq(contactos.opticaId, opticas.id))
    .where(and(eq(contactos.autorizado, true), eq(opticas.activa, true)))
    .orderBy(asc(opticas.nombre));
  return c.json(rows);
});
