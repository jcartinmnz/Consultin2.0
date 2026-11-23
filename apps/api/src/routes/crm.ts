import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { AppBindings } from "../env";
import { getDb } from "../db/client";
import { casos, configuracion, conexiones, contactos, conversaciones, mensajes, notasCaso, opticas } from "../db/schema";
import { canalDeConversacion } from "../channels";
import * as repo from "../services/repo";
import { clientesRuta } from "./clientes";
import { PROMPT_BASE_DEFAULT, REGLAS_FIJAS } from "../agent/prompt";
import { ESPERA_DEFAULT_S, ESPERA_MAX_S } from "../services/procesar";
import { leerEsperaMs } from "./webhooks";
import { listarCuentas, urlConectar, type CuentaZernio } from "../lib/zernio-api";

export const crm = new Hono<AppBindings>();
crm.route("/", clientesRuta);

/* ───────────── Casos ───────────── */

crm.get("/casos", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const estado = c.req.query("estado") as (typeof casos.$inferSelect)["estado"] | undefined;
  const rows = await db
    .select({ caso: casos, optica: opticas.nombre, telefono: conversaciones.telefono, participante: conversaciones.participanteNombre, plataforma: conversaciones.plataforma })
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
  if (!conv) return c.json({ error: "No existe la conversación" }, 404);
  const canal = canalDeConversacion(c.env, conv.canal);
  if (!canal) return c.json({ error: `No se puede responder por el canal "${conv.canal}" desde el CRM` }, 409);
  await canal.enviar(conv.externalId, texto);
  await repo.guardarMensaje(db, { conversacionId: conv.id, rol: "agente", contenido: texto, autor });
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
  const body = z.object({
    nombre: z.string().trim().min(1), codigoLensware: z.string().trim().nullable().optional().transform((v) => v || null),
  }).parse(await c.req.json());
  const [row] = await db.insert(opticas).values(body).returning();
  await repo.clienteDeOptica(db, row!); // cada óptica tiene su perfil de cliente
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

/* ───────────── Chats (todas las conversaciones) ───────────── */

crm.get("/conversaciones", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const rows = await db.execute(sql`
    SELECT cv.id, cv.canal, cv.plataforma, cv.estado, cv.telefono, cv.participante_nombre AS "participanteNombre",
           cv.last_message_at AS "lastMessageAt", o.nombre AS optica, cx.nombre AS cuenta,
           (SELECT contenido FROM mensajes m WHERE m.conversacion_id = cv.id ORDER BY created_at DESC LIMIT 1) AS ultimo,
           (SELECT rol FROM mensajes m WHERE m.conversacion_id = cv.id ORDER BY created_at DESC LIMIT 1) AS "ultimoRol",
           EXISTS (SELECT 1 FROM casos cs WHERE cs.conversacion_id = cv.id AND cs.estado <> 'resuelto') AS "casoAbierto"
    FROM conversaciones cv
    LEFT JOIN opticas o ON o.id = cv.optica_id
    LEFT JOIN conexiones cx ON cx.cuenta_id = cv.cuenta_id
    WHERE cv.canal <> 'dev'
    ORDER BY cv.last_message_at DESC LIMIT 200`);
  return c.json(rows.rows);
});

crm.get("/conversaciones/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const [conv] = await db.select().from(conversaciones).where(eq(conversaciones.id, c.req.param("id")));
  if (!conv) return c.json({ error: "No existe" }, 404);
  const chat = await db.select().from(mensajes).where(eq(mensajes.conversacionId, conv.id)).orderBy(asc(mensajes.createdAt));
  const [optica] = conv.opticaId ? await db.select().from(opticas).where(eq(opticas.id, conv.opticaId)) : [];
  return c.json({ conversacion: conv, optica: optica ?? null, mensajes: chat, caso: await repo.casoAbierto(db, conv.id) });
});

/** Encender o apagar el agente en una conversación. Apagado = solo responde una persona desde el panel. */
crm.patch("/conversaciones/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const { agenteActivo } = z.object({ agenteActivo: z.boolean() }).parse(await c.req.json());
  const [conv] = await db.update(conversaciones).set({ estado: agenteActivo ? "bot" : "humano" })
    .where(eq(conversaciones.id, c.req.param("id"))).returning();
  if (!conv) return c.json({ error: "No existe" }, 404);
  return c.json(conv);
});

/** Una persona del equipo escribe en la conversación (sale por el mismo canal: WhatsApp o Instagram). */
crm.post("/conversaciones/:id/mensajes", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const { autor, texto } = z.object({ autor: z.string(), texto: z.string().min(1) }).parse(await c.req.json());
  const [conv] = await db.select().from(conversaciones).where(eq(conversaciones.id, c.req.param("id")));
  if (!conv) return c.json({ error: "No existe" }, 404);
  const canal = canalDeConversacion(c.env, conv.canal);
  if (!canal) return c.json({ error: `No se puede responder por el canal "${conv.canal}" desde el panel` }, 409);
  try {
    await canal.enviar(conv.externalId, texto);
  } catch (err) {
    return c.json({ error: `El mensaje no salió: ${String((err as Error).message).slice(0, 300)}` }, 502);
  }
  await repo.guardarMensaje(db, { conversacionId: conv.id, rol: "agente", contenido: texto, autor });
  return c.json({ ok: true }, 201);
});

/* ───────────── Configuración: prompt ───────────── */

crm.get("/config/prompt", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const guardado = await repo.leerConfig(db, "prompt_base");
  return c.json({ prompt: guardado ?? PROMPT_BASE_DEFAULT, personalizado: guardado !== null, porDefecto: PROMPT_BASE_DEFAULT, reglasFijas: REGLAS_FIJAS });
});

crm.put("/config/prompt", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const { prompt } = z.object({ prompt: z.string().trim().min(20, "El prompt es muy corto").max(20000) }).parse(await c.req.json());
  await repo.guardarConfig(db, "prompt_base", prompt);
  return c.json({ ok: true });
});

/** Volver al prompt por defecto del código. */
crm.delete("/config/prompt", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  await db.delete(configuracion).where(eq(configuracion.clave, "prompt_base"));
  return c.json({ ok: true });
});

/* ───────────── Configuración: espera para juntar mensajes seguidos ───────────── */

crm.get("/config/espera", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  return c.json({ segundos: (await leerEsperaMs(db)) / 1000, max: ESPERA_MAX_S, porDefecto: ESPERA_DEFAULT_S });
});

crm.put("/config/espera", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const { segundos } = z.object({ segundos: z.number().min(0).max(ESPERA_MAX_S) }).parse(await c.req.json());
  await repo.guardarConfig(db, "espera_segundos", String(segundos));
  return c.json({ ok: true, segundos });
});

/* ───────────── Configuración: conexiones (cuentas de Zernio) ───────────── */

const MODOS = ["opticas", "abierto"] as const;

/** Cuentas conectadas a Zernio y si Consultin las atiende. */
crm.get("/conexiones", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const guardadas = await db.select().from(conexiones);
  let cuentas: CuentaZernio[] = [];
  let error: string | null = null;
  if (c.env.ZERNIO_API_KEY) {
    try { cuentas = await listarCuentas(c.env.ZERNIO_API_KEY); } catch (e) { error = String((e as Error).message); }
  } else error = "Falta ZERNIO_API_KEY";
  const porId = new Map(guardadas.map((g) => [g.cuentaId, g]));
  const lista = cuentas.map((cu) => ({ ...cu, conexion: porId.get(cu.id) ?? null }));
  // Conexiones guardadas cuya cuenta ya no está en Zernio
  for (const g of guardadas) if (!cuentas.some((cu) => cu.id === g.cuentaId)) {
    lista.push({ id: g.cuentaId, plataforma: g.plataforma, usuario: g.nombre, nombre: null, foto: null, activa: false, necesitaReconexion: true, conexion: g });
  }
  return c.json({ cuentas: lista, error });
});

/** Dar de alta (o actualizar) una cuenta para que la atienda Consultin. */
crm.put("/conexiones/:cuentaId", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = z.object({
    plataforma: z.string(), nombre: z.string(),
    modo: z.enum(MODOS), activa: z.boolean(),
    prompt: z.string().trim().max(20000).nullable().transform((p) => (p ? p : null)),
  }).parse(await c.req.json());
  const cuentaId = c.req.param("cuentaId");
  const [row] = await db.insert(conexiones).values({ cuentaId, ...body })
    .onConflictDoUpdate({ target: conexiones.cuentaId, set: body }).returning();
  return c.json(row);
});

/** Quitar la conexión: Consultin deja de atender esa cuenta. No desconecta nada en Zernio. */
crm.delete("/conexiones/:cuentaId", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  await db.delete(conexiones).where(eq(conexiones.cuentaId, c.req.param("cuentaId")));
  return c.json({ ok: true });
});

/** Enlace para conectar una cuenta nueva (Instagram, WhatsApp, Messenger) en Zernio. */
crm.get("/conexiones/conectar/:plataforma", async (c) => {
  const plataforma = c.req.param("plataforma");
  if (!["instagram", "whatsapp", "facebook"].includes(plataforma)) return c.json({ error: "Plataforma no soportada" }, 400);
  if (!c.env.ZERNIO_API_KEY) return c.json({ error: "Falta ZERNIO_API_KEY" }, 500);
  const volverA = c.env.PANEL_URL ?? c.req.header("origin") ?? "https://zernio.com";
  return c.json({ url: await urlConectar(c.env.ZERNIO_API_KEY, plataforma, volverA) });
});
