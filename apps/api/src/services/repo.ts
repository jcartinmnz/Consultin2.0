import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { casos, clientes, configuracion, conexiones, contactos, conversaciones, eventos, mensajes, opticas } from "../db/schema";
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

/** Devuelve el id del mensaje, o null si ya existía (reintento del webhook). */
export async function guardarMensaje(db: Db, p: {
  conversacionId: string; rol: "cliente" | "bot" | "agente"; contenido: string; autor?: string; externalId?: string;
}): Promise<string | null> {
  const rows = await db.insert(mensajes).values(p).onConflictDoNothing({ target: mensajes.externalId }).returning({ id: mensajes.id });
  return rows[0]?.id ?? null;
}

/** Id del último mensaje del cliente en la conversación (para saber si llegó otro durante la espera). */
export async function ultimoMensajeCliente(db: Db, conversacionId: string): Promise<string | null> {
  const [row] = await db.select({ id: mensajes.id }).from(mensajes)
    .where(and(eq(mensajes.conversacionId, conversacionId), eq(mensajes.rol, "cliente")))
    .orderBy(desc(mensajes.createdAt), desc(mensajes.id)).limit(1);
  return row?.id ?? null;
}

/** Mensajes del cliente que todavía no tienen respuesta (los que llegaron después de la última del bot o del equipo). */
export async function textoPendiente(db: Db, conversacionId: string): Promise<string> {
  const rows = await db.select({ rol: mensajes.rol, contenido: mensajes.contenido }).from(mensajes)
    .where(eq(mensajes.conversacionId, conversacionId)).orderBy(desc(mensajes.createdAt)).limit(20);
  const pendientes: string[] = [];
  for (const r of rows) { if (r.rol !== "cliente") break; pendientes.unshift(r.contenido); }
  return pendientes.join("\n");
}

export async function estadoConversacion(db: Db, id: string) {
  const [row] = await db.select({ estado: conversaciones.estado }).from(conversaciones).where(eq(conversaciones.id, id));
  return row?.estado ?? null;
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

/* ───────────── Clientes ───────────── */

/** Cliente de una óptica (se crea si no existe). */
export async function clienteDeOptica(db: Db, optica: { id: string; nombre: string }): Promise<string> {
  const [existente] = await db.select({ id: clientes.id }).from(clientes).where(eq(clientes.opticaId, optica.id));
  if (existente) return existente.id;
  const [nuevo] = await db.insert(clientes).values({ tipo: "optica", opticaId: optica.id, nombre: optica.nombre, origen: "whatsapp" })
    .onConflictDoNothing({ target: clientes.opticaId }).returning({ id: clientes.id });
  if (nuevo) return nuevo.id;
  const [carrera] = await db.select({ id: clientes.id }).from(clientes).where(eq(clientes.opticaId, optica.id));
  return carrera!.id;
}

/**
 * Liga la conversación a su perfil de cliente:
 * - óptica identificada → el cliente de esa óptica (aunque antes fuera "persona");
 * - sin identidad → un cliente "persona" propio de la conversación, creado con su primer mensaje.
 */
export async function asegurarCliente(db: Db, conv: { id: string; clienteId: string | null },
  p: { optica: { id: string; nombre: string } | null; nombre: string | null; telefono: string | null; plataforma: string }): Promise<string> {
  let clienteId = conv.clienteId;
  if (p.optica) {
    const id = await clienteDeOptica(db, p.optica);
    if (id !== clienteId) clienteId = id;
  } else if (!clienteId) {
    const [nuevo] = await db.insert(clientes).values({
      tipo: "persona", nombre: p.nombre || (p.telefono ? `+${p.telefono}` : "Sin nombre"),
      telefono: p.telefono || null, origen: p.plataforma,
    }).returning({ id: clientes.id });
    clienteId = nuevo!.id;
  }
  if (clienteId !== conv.clienteId) await db.update(conversaciones).set({ clienteId }).where(eq(conversaciones.id, conv.id));
  return clienteId!;
}
