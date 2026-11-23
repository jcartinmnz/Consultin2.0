import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { AppBindings } from "../env";
import { getDb } from "../db/client";
import { casos, clientes, compras, contactos, conversaciones, eventos, opticas } from "../db/schema";
import { getSources } from "../sources";
import { normalizarTelefono } from "../lib/telefono";
import { clienteDeOptica } from "../services/repo";

/** Perfiles de cliente: datos, compras, consultas al agente, órdenes y métricas. Montado en /crm (requiere ADMIN_API_KEY). */
export const clientesRuta = new Hono<AppBindings>();

/** Lista con métricas resumidas. ?q= busca por nombre, empresa, email o teléfono; ?tipo=optica|persona */
clientesRuta.get("/clientes", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const q = (c.req.query("q") ?? "").trim();
  const tipo = c.req.query("tipo");
  const filtroQ = q ? sql`AND (cl.nombre ILIKE ${"%" + q + "%"} OR cl.empresa ILIKE ${"%" + q + "%"} OR cl.email ILIKE ${"%" + q + "%"} OR cl.telefono ILIKE ${"%" + q + "%"})` : sql``;
  const filtroTipo = tipo === "optica" || tipo === "persona" ? sql`AND cl.tipo = ${tipo}` : sql``;
  const rows = await db.execute(sql`
    SELECT cl.id, cl.tipo, cl.nombre, cl.empresa, cl.origen, cl.created_at AS "createdAt",
           (SELECT count(*) FROM conversaciones cv WHERE cv.cliente_id = cl.id)::int AS conversaciones,
           (SELECT count(*) FROM eventos e JOIN conversaciones cv ON cv.id = e.conversacion_id
             WHERE cv.cliente_id = cl.id AND e.tipo = 'tool_call' AND e.tool IN ('buscar_precio','estado_orden'))::int AS consultas,
           (SELECT count(*) FROM compras co WHERE co.cliente_id = cl.id)::int AS compras,
           (SELECT coalesce(sum(total), 0) FROM compras co WHERE co.cliente_id = cl.id)::float AS "totalCompras",
           (SELECT max(last_message_at) FROM conversaciones cv WHERE cv.cliente_id = cl.id) AS "ultimaActividad"
    FROM clientes cl
    WHERE true ${filtroQ} ${filtroTipo}
    ORDER BY "ultimaActividad" DESC NULLS LAST, cl.created_at DESC
    LIMIT 300`);
  return c.json(rows.rows);
});

/** Perfil completo. */
clientesRuta.get("/clientes/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, id));
  if (!cliente) return c.json({ error: "No existe" }, 404);

  const [optica] = cliente.opticaId ? await db.select().from(opticas).where(eq(opticas.id, cliente.opticaId)) : [];
  const cts = optica ? await db.select().from(contactos).where(eq(contactos.opticaId, optica.id)) : [];
  const convs = await db.select().from(conversaciones).where(eq(conversaciones.clienteId, id)).orderBy(desc(conversaciones.lastMessageAt));
  const convIds = convs.map((x) => x.id);

  const consultas = convIds.length ? await db.select({
    id: eventos.id, tool: eventos.tool, ok: eventos.ok, metadata: eventos.metadata, fecha: eventos.createdAt, conversacionId: eventos.conversacionId,
  }).from(eventos)
    .where(and(inArray(eventos.conversacionId, convIds), eq(eventos.tipo, "tool_call"), inArray(eventos.tool, ["buscar_precio", "estado_orden"])))
    .orderBy(desc(eventos.createdAt)).limit(100) : [];

  const listaCompras = await db.select().from(compras).where(eq(compras.clienteId, id)).orderBy(desc(compras.fecha));
  const listaCasos = convIds.length ? await db.select().from(casos).where(inArray(casos.conversacionId, convIds)).orderBy(desc(casos.createdAt)).limit(50) : [];

  const [m] = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM eventos e JOIN conversaciones cv ON cv.id = e.conversacion_id
        WHERE cv.cliente_id = ${id} AND e.tipo = 'mensaje_entrante')::int AS mensajes,
      (SELECT count(*) FROM eventos e JOIN conversaciones cv ON cv.id = e.conversacion_id
        WHERE cv.cliente_id = ${id} AND e.tipo = 'respuesta')::int AS "respuestasBot",
      (SELECT min(created_at) FROM conversaciones WHERE cliente_id = ${id}) AS "primeraInteraccion",
      (SELECT max(last_message_at) FROM conversaciones WHERE cliente_id = ${id}) AS "ultimaInteraccion"
  `)).rows as any[];

  // Órdenes de laboratorio (solo ópticas). Hoy salen del mock; con LensWare conectado son las reales.
  let ordenes: unknown[] = [];
  let ordenesError: string | null = null;
  if (optica && !optica.codigoLensware) ordenesError = "Esta óptica todavía no tiene código de LensWare.";
  else if (optica?.codigoLensware) {
    try { ordenes = await getSources(c.env, db).orders.recientes(optica.codigoLensware, 10); }
    catch (e) { ordenesError = String((e as Error).message); }
  }

  const totalCompras = listaCompras.reduce((a, x) => a + Number(x.total), 0);
  const conCaso = new Set(listaCasos.map((x) => x.conversacionId));
  const productos = new Map<string, { nombre: string; veces: number }>();
  for (const ev of consultas) {
    if (ev.tool !== "buscar_precio") continue;
    const r = (ev.metadata as any)?.resultado as { sku: string; nombre: string }[] | undefined;
    for (const p of (r ?? []).slice(0, 1)) productos.set(p.sku, { nombre: p.nombre, veces: (productos.get(p.sku)?.veces ?? 0) + 1 });
  }

  return c.json({
    cliente, optica: optica ?? null, contactos: cts,
    conversaciones: convs.map((x) => ({ id: x.id, plataforma: x.plataforma ?? x.canal, estado: x.estado, lastMessageAt: x.lastMessageAt, createdAt: x.createdAt })),
    consultas: consultas.map((ev) => ({
      id: ev.id, tipo: ev.tool === "buscar_precio" ? "precio" : "orden", fecha: ev.fecha, ok: ev.ok, conversacionId: ev.conversacionId,
      consulta: (ev.metadata as any)?.input?.consulta ?? (ev.metadata as any)?.input?.numero_orden ?? null,
      resultado: (ev.metadata as any)?.resultado ?? null,
    })),
    compras: listaCompras.map((x) => ({ ...x, precioUnitario: Number(x.precioUnitario), total: Number(x.total) })),
    casos: listaCasos, ordenes, ordenesError,
    metricas: {
      totalCompras, numCompras: listaCompras.length,
      ticketPromedio: listaCompras.length ? Math.round(totalCompras / listaCompras.length) : null,
      ultimaCompra: listaCompras[0]?.fecha ?? null,
      conversaciones: convs.length, mensajes: m?.mensajes ?? 0, respuestasBot: m?.respuestasBot ?? 0,
      consultasPrecio: consultas.filter((x) => x.tool === "buscar_precio").length,
      consultasOrden: consultas.filter((x) => x.tool === "estado_orden").length,
      escalamientos: listaCasos.length,
      resolucionBot: convs.length ? Number(((convs.length - convs.filter((x) => conCaso.has(x.id)).length) / convs.length).toFixed(3)) : null,
      primeraInteraccion: m?.primeraInteraccion ?? null, ultimaInteraccion: m?.ultimaInteraccion ?? null,
      productosConsultados: [...productos.values()].sort((a, b) => b.veces - a.veces).slice(0, 5),
    },
  });
});

const perfil = z.object({
  nombre: z.string().trim().min(1).max(200),
  empresa: z.string().trim().max(200).nullable(),
  email: z.string().trim().max(200).nullable().refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Correo inválido"),
  telefono: z.string().trim().max(40).nullable(),
  direccion: z.string().trim().max(500).nullable(),
  notas: z.string().trim().max(5000).nullable(),
}).partial();

clientesRuta.patch("/clientes/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = perfil.parse(await c.req.json());
  const vacio = (v: string | null | undefined) => (v === "" ? null : v);
  const datos = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, k === "nombre" ? v : vacio(v as string | null)]));
  const [row] = await db.update(clientes).set(datos).where(eq(clientes.id, c.req.param("id"))).returning();
  if (!row) return c.json({ error: "No existe" }, 404);
  return c.json(row);
});

/** Registrar una compra. El total se calcula en el servidor. */
clientesRuta.post("/clientes/:id/compras", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = z.object({
    descripcion: z.string().trim().min(1).max(500),
    sku: z.string().trim().max(120).nullable().optional(),
    cantidad: z.number().int().min(1).max(10000),
    precioUnitario: z.number().min(0).max(100_000_000),
    fecha: z.string().datetime({ offset: true }).optional(),
    notas: z.string().trim().max(2000).nullable().optional(),
    autor: z.string().trim().max(120).optional(),
  }).parse(await c.req.json());
  const [cliente] = await db.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, c.req.param("id")));
  if (!cliente) return c.json({ error: "No existe" }, 404);
  const [row] = await db.insert(compras).values({
    clienteId: cliente.id, descripcion: body.descripcion, sku: body.sku || null, cantidad: body.cantidad,
    precioUnitario: String(body.precioUnitario), total: String(body.precioUnitario * body.cantidad),
    fecha: body.fecha ? new Date(body.fecha) : undefined, notas: body.notas || null, autor: body.autor ?? null,
  }).returning();
  return c.json(row, 201);
});

clientesRuta.delete("/compras/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const rows = await db.delete(compras).where(eq(compras.id, c.req.param("id"))).returning({ id: compras.id });
  if (!rows.length) return c.json({ error: "No existe" }, 404);
  return c.json({ ok: true });
});

/** Buscador de la lista de precios para registrar compras (misma búsqueda que usa el agente). */
clientesRuta.get("/productos", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json([]);
  return c.json(await getSources(c.env, db).prices.buscar({ consulta: q }, 8));
});

/* ───────────── Alta manual (panel → Agregar cliente) ───────────── */

const texto = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const correo = texto(200).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Correo inválido");

export const nuevoCliente = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("optica"),
    nombre: z.string().trim().min(2, "Falta el nombre").max(200),
    razonSocial: texto(200), codigoSap: texto(40), codigoMac: texto(40), ruta: texto(80), codigoLensware: texto(60),
    /** Números de WhatsApp que identifican a la óptica (quedan autorizados) */
    whatsapp: z.array(z.string()).max(20).default([]),
    telefono: texto(100), email: correo, direccion: texto(500), horario: texto(200), contacto: texto(120), notas: texto(5000),
    forzar: z.boolean().optional(),
  }),
  z.object({
    tipo: z.literal("persona"),
    nombre: z.string().trim().min(2, "Falta el nombre").max(200),
    empresa: texto(200), email: correo, telefono: texto(40), direccion: texto(500), notas: texto(5000),
    forzar: z.boolean().optional(),
  }),
]);

clientesRuta.post("/clientes", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = nuevoCliente.parse(await c.req.json());

  if (body.tipo === "persona") {
    const telefono = body.telefono ? normalizarTelefono(body.telefono) : null;
    if (body.telefono && !telefono) return c.json({ error: `Teléfono inválido: "${body.telefono}"` }, 400);
    if (!body.forzar) {
      const [dup] = await db.select({ id: clientes.id, nombre: clientes.nombre }).from(clientes)
        .where(telefono ? eq(clientes.telefono, telefono) : sql`lower(${clientes.nombre}) = lower(${body.nombre})`).limit(1);
      if (dup) return c.json({ error: `Ya existe un cliente "${dup.nombre}" con ese ${telefono ? "teléfono" : "nombre"}.`, duplicado: dup.id }, 409);
    }
    const [row] = await db.insert(clientes).values({
      tipo: "persona", nombre: body.nombre, empresa: body.empresa, email: body.email, telefono,
      direccion: body.direccion, notas: body.notas, origen: "panel",
    }).returning({ id: clientes.id });
    return c.json({ clienteId: row!.id }, 201);
  }

  // Óptica: validar todo antes de escribir
  const numeros: string[] = [];
  for (const n of body.whatsapp.map((x) => x.trim()).filter(Boolean)) {
    const t = normalizarTelefono(n);
    if (!t) return c.json({ error: `Número de WhatsApp inválido: "${n}"` }, 400);
    if (!numeros.includes(t)) numeros.push(t);
  }
  if (numeros.length) {
    const usados = await db.select({ telefono: contactos.telefono, optica: opticas.nombre }).from(contactos)
      .innerJoin(opticas, eq(opticas.id, contactos.opticaId)).where(inArray(contactos.telefono, numeros));
    if (usados.length) return c.json({ error: `Estos números ya pertenecen a otra óptica: ${usados.map((u) => `+${u.telefono} (${u.optica})`).join(", ")}` }, 409);
  }
  if (body.codigoLensware) {
    const [dup] = await db.select({ nombre: opticas.nombre }).from(opticas).where(eq(opticas.codigoLensware, body.codigoLensware));
    if (dup) return c.json({ error: `El código de LensWare ${body.codigoLensware} ya es de "${dup.nombre}".` }, 409);
  }
  if (!body.forzar) {
    const [dup] = await db.select({ id: opticas.id, nombre: opticas.nombre }).from(opticas)
      .where(sql`lower(${opticas.nombre}) = lower(${body.nombre})`).limit(1);
    if (dup) return c.json({ error: `Ya existe una óptica llamada "${dup.nombre}".`, duplicado: dup.id }, 409);
  }

  const [optica] = await db.insert(opticas).values({
    nombre: body.nombre, razonSocial: body.razonSocial, codigoSap: body.codigoSap, codigoMac: body.codigoMac,
    ruta: body.ruta, codigoLensware: body.codigoLensware,
  }).returning();
  const clienteId = await clienteDeOptica(db, optica!);
  const notas = [body.ruta && `Ruta: ${body.ruta}`, body.horario && `Horario: ${body.horario}`, body.contacto && `Contacto: ${body.contacto}`,
    (body.codigoSap || body.codigoMac) && `Código SAP: ${body.codigoSap ?? "—"} · MAC: ${body.codigoMac ?? "—"}`, body.notas].filter(Boolean).join("\n");
  await db.update(clientes).set({
    empresa: body.razonSocial, email: body.email, direccion: body.direccion, origen: "panel",
    telefono: [...numeros.map((n) => `+${n}`), body.telefono].filter(Boolean).join(" / ") || null, notas: notas || null,
  }).where(eq(clientes.id, clienteId));
  if (numeros.length) {
    await db.insert(contactos).values(numeros.map((telefono) => ({ opticaId: optica!.id, telefono, nombre: body.contacto ?? "WhatsApp" })));
  }
  return c.json({ clienteId, opticaId: optica!.id }, 201);
});
