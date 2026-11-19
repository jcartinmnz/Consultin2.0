import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { casos, configuracion, conexiones, contactos, conversaciones, eventos, mensajes, opticas } from "../db/schema";
import type { Turno } from "../agent/run";

export async function identificar(db: Db, telefono: string) {
  const [row] = await db
    .select({ contacto: contactos, optica: opticas })
    .from(contactos)
    .innerJoin(opticas, eq(contactos.opticaId, opticas.id))
    .where(and(eq(contactos.telefono, telefono), eq(contactos.autorizado, true), eq(opticas.activa, true)))
    .limit(1);
  return row ?? null;
}

export async function upsertConversacion(db: Db, p: {
  canal: string; externalId: string; telefono: string | null; opticaId: string | null;
  cuentaId?: string | null; participanteNombre?: string | null;
}) {
  const datos = {
    opticaId: p.opticaId,
    ...(p.participanteNombre ? { participanteNombre: p.participanteNombre } : {}),
  };
  const [row] = await db
    .insert(conversaciones)
    .values({
      canal: p.canal, plataforma: p.canal, externalId: p.externalId, telefono: p.telefono || null,
      cuentaId: p.cuentaId ?? null, ...datos,
    })
    .onConflictDoUpdate({
      target: [conversaciones.canal, conversaciones.externalId],
      set: { lastMessageAt: new Date(), ...datos },
    })
    .returning();
  return row!;
}

/** Devuelve false si el mensaje ya existía (reintento del webhook). */
export async function guardarMensaje(db: Db, p: {
  conversacionId: string; rol: "cliente" | "bot" | "agente"; contenido: string; autor?: string; externalId?: string;
}) {
  const rows = await db.insert(mensajes).values(p).onConflictDoNothing({ target: mensajes.externalId }).returning({ id: mensajes.id });
  return rows.length > 0;
}

export async function historial(db: Db, conversacionId: string, limite = 20): Promise<Turno[]> {
  const rows = await db
    .select({ rol: mensajes.rol, contenido: mensajes.contenido })
    .from(mensajes)
    .where(eq(mensajes.conversacionId, conversacionId))
    .orderBy(desc(mensajes.createdAt))
    .limit(limite);
  return rows.reverse();
}

export async function setEstadoConversacion(db: Db, id: string, estado: "bot" | "humano" | "cerrada") {
  await db.update(conversaciones).set({ estado }).where(eq(conversaciones.id, id));
}

export async function casoAbierto(db: Db, conversacionId: string) {
  const [row] = await db.select().from(casos)
    .where(and(eq(casos.conversacionId, conversacionId), inArray(casos.estado, ["nuevo", "en_atencion", "en_espera"])))
    .limit(1);
  return row ?? null;
}

export async function crearCaso(db: Db, p: {
  conversacionId: string; opticaId: string | null; nivel: "N2" | "N3"; motivo: string; resumen: string;
}) {
  // El índice único parcial casos_conv_abierto_uq garantiza un solo caso abierto por conversación,
  // incluso si dos mensajes llegan a la vez: el segundo insert no hace nada y devuelve el existente.
  const [row] = await db.insert(casos).values(p)
    .onConflictDoNothing({ target: casos.conversacionId, where: sql`${casos.estado} <> 'resuelto'` })
    .returning();
  if (!row) return (await casoAbierto(db, p.conversacionId))!;
  await setEstadoConversacion(db, p.conversacionId, "humano");
  await registrarEvento(db, { conversacionId: p.conversacionId, tipo: "escalamiento", metadata: { nivel: p.nivel, motivo: p.motivo } });
  return row!;
}

export async function registrarEvento(db: Db, e: {
  conversacionId?: string | null; tipo: string; tool?: string; ok?: boolean; latenciaMs?: number; metadata?: Record<string, unknown>;
}) {
  await db.insert(eventos).values(e);
}

/* ───────────── Configuración y conexiones ───────────── */

export type Conexion = typeof conexiones.$inferSelect;

export async function conexionActiva(db: Db, cuentaId: string): Promise<Conexion | null> {
  const [row] = await db.select().from(conexiones).where(and(eq(conexiones.cuentaId, cuentaId), eq(conexiones.activa, true)));
  return row ?? null;
}

export async function leerConfig(db: Db, clave: string): Promise<string | null> {
  const [row] = await db.select().from(configuracion).where(eq(configuracion.clave, clave));
  return row?.valor ?? null;
}

export async function guardarConfig(db: Db, clave: string, valor: string) {
  await db.insert(configuracion).values({ clave, valor })
    .onConflictDoUpdate({ target: configuracion.clave, set: { valor, updatedAt: new Date() } });
}
