import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import type { AppBindings } from "../env";
import { getDb } from "../db/client";
import { casos, contactos, conversaciones, mensajes, notasCaso, opticas } from "../db/schema";
import { getChannel } from "../channels";
import * as repo from "../services/repo";

export const crm = new Hono<AppBindings>();

/* ───────────── Casos ───────────── */

crm.get("/casos", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const estado = c.req.query("estado") as (typeof casos.$inferSelect)["estado"] | undefined;
  const rows = await db
    .select({ caso: casos, optica: opticas.nombre, telefono: conversaciones.telefono })
    .from(casos)
    .innerJoin(conversaciones, eq(casos.conversacionId, conversaciones.id))
    .leftJoin(opticas, eq(casos.opticaId, opticas.id))
    .where(estado ? eq(casos.estado, estado) : undefined)
    .orderBy(desc(casos.nivel), desc(casos.createdAt))
    .limit(200);
  return c.json(rows);
});

crm.get("/casos/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const [caso] = await db.select().from(casos).where(eq(casos.id, c.req.param("id")));
  if (!caso) return c.json({ error: "No existe" }, 404);
  const [conv] = await db.select().from(conversaciones).where(eq(conversaciones.id, caso.conversacionId));
  const chat = await db.select().from(mensajes).where(eq(mensajes.conversacionId, caso.conversacionId)).orderBy(asc(mensajes.createdAt));
  const notas = await db.select().from(notasCaso).where(eq(notasCaso.casoId, caso.id)).orderBy(asc(notasCaso.createdAt));
  return c.json({ caso, conversacion: conv, mensajes: chat, notas });
});

const patchCaso = z.object({
  estado: z.enum(["nuevo", "en_atencion", "en_espera", "resuelto"]).optional(),
  asignadoA: z.string().nullable().optional(),
});

crm.patch("/casos/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = patchCaso.parse(await c.req.json());
  const [caso] = await db.update(casos).set({
    ...body,
    ...(body.estado === "resuelto" ? { resueltoAt: new Date() } : {}),
  }).where(eq(casos.id, c.req.param("id"))).returning();
  if (!caso) return c.json({ error: "No existe" }, 404);
  // Al resolver, el bot vuelve a atender esa conversación
  if (body.estado === "resuelto") await repo.setEstadoConversacion(db, caso.conversacionId, "bot");
  return c.json(caso);
});

crm.post("/casos/:id/notas", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const { autor, texto } = z.object({ autor: z.string(), texto: z.string().min(1) }).parse(await c.req.json());
  const [nota] = await db.insert(notasCaso).values({ casoId: c.req.param("id"), autor, texto }).returning();
  return c.json(nota, 201);
});

/** La persona del equipo responde al mismo chat de WhatsApp desde el CRM. */
crm.post("/casos/:id/responder", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const { autor, texto } = z.object({ autor: z.string(), texto: z.string().min(1) }).parse(await c.req.json());
  const [caso] = await db.select().from(casos).where(eq(casos.id, c.req.param("id")));
  if (!caso) return c.json({ error: "No existe" }, 404);
  const [conv] = await db.select().from(conversaciones).where(eq(conversaciones.id, caso.conversacionId));
  await getChannel(c.env).enviar(conv!.externalId, texto);
  await repo.guardarMensaje(db, { conversacionId: conv!.id, rol: "agente", contenido: texto, autor });
  if (caso.estado === "nuevo") await db.update(casos).set({ estado: "en_atencion", asignadoA: caso.asignadoA ?? autor }).where(eq(casos.id, caso.id));
  return c.json({ ok: true });
});

/* ───────────── Ópticas y contactos ───────────── */

crm.get("/opticas", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  return c.json(await db.select().from(opticas).orderBy(asc(opticas.nombre)));
});

crm.get("/opticas/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  const [optica] = await db.select().from(opticas).where(eq(opticas.id, id));
  if (!optica) return c.json({ error: "No existe" }, 404);
  const cts = await db.select().from(contactos).where(eq(contactos.opticaId, id));
  const convs = await db.select().from(conversaciones).where(eq(conversaciones.opticaId, id)).orderBy(desc(conversaciones.lastMessageAt)).limit(20);
  const cs = await db.select().from(casos).where(eq(casos.opticaId, id)).orderBy(desc(casos.createdAt)).limit(20);
  return c.json({ optica, contactos: cts, conversaciones: convs, casos: cs });
});

crm.post("/opticas", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = z.object({ nombre: z.string(), codigoLensware: z.string() }).parse(await c.req.json());
  const [row] = await db.insert(opticas).values(body).returning();
  return c.json(row, 201);
});

crm.post("/opticas/:id/contactos", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = z.object({ nombre: z.string().optional(), telefono: z.string().transform((t) => t.replace(/\D/g, "")) }).parse(await c.req.json());
  const [row] = await db.insert(contactos).values({ ...body, opticaId: c.req.param("id") }).returning();
  return c.json(row, 201);
});

crm.patch("/contactos/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = z.object({ autorizado: z.boolean() }).parse(await c.req.json());
  const [row] = await db.update(contactos).set(body).where(and(eq(contactos.id, c.req.param("id")))).returning();
  return c.json(row);
});
