import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, text, boolean, numeric, integer, timestamp, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";

/* ───────────── Clientes del laboratorio ───────────── */

export const opticas = pgTable("opticas", {
  id: uuid("id").primaryKey().defaultRandom(),
  nombre: text("nombre").notNull(),
  /**
   * Código de cliente tal como aparece en LensWare. Llave para filtrar órdenes.
   * null = todavía no vinculada con LensWare: el agente no da órdenes de esta óptica (las pasa a una persona).
   */
  codigoLensware: text("codigo_lensware").unique(),
  /** Llave de importación (SAP-MAC-nombre): permite volver a importar la base sin duplicar. */
  clave: text("clave").unique(),
  codigoSap: text("codigo_sap"),
  codigoMac: text("codigo_mac"),
  razonSocial: text("razon_social"),
  /** Ruta de visita/entrega de Topex (Ruta Larga C1, Heredia, Encomiendas…) */
  ruta: text("ruta"),
  activa: boolean("activa").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Perfil de cliente (panel → Clientes). Una óptica tiene exactamente un cliente (`opticaId`).
 * Quien escribe por Instagram/Messenger (o un WhatsApp no registrado en modo abierto) es un cliente
 * tipo "persona", creado con su primer mensaje. Ley 8968: aquí NO se guardan datos clínicos.
 */
export const clientes = pgTable("clientes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tipo: text("tipo").notNull(),                   // optica | persona
  opticaId: uuid("optica_id").references(() => opticas.id).unique(),
  nombre: text("nombre").notNull(),
  empresa: text("empresa"),
  email: text("email"),
  telefono: text("telefono"),
  direccion: text("direccion"),
  /** Canal por el que llegó (whatsapp | instagram | facebook | panel) */
  origen: text("origen"),
  notas: text("notas"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Compras registradas a mano desde el perfil (hasta que haya una fuente de ventas real). */
export const compras = pgTable("compras", {
  id: uuid("id").primaryKey().defaultRandom(),
  clienteId: uuid("cliente_id").notNull().references(() => clientes.id),
  fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
  /** SKU de la lista de precios, si se eligió de ahí */
  sku: text("sku"),
  descripcion: text("descripcion").notNull(),
  cantidad: integer("cantidad").notNull().default(1),
  precioUnitario: numeric("precio_unitario", { precision: 12, scale: 2 }).notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  moneda: text("moneda").notNull().default("CRC"),
  notas: text("notas"),
  autor: text("autor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("compras_cliente_idx").on(t.clienteId, t.fecha)]);

export const contactos = pgTable("contactos", {
  id: uuid("id").primaryKey().defaultRandom(),
  opticaId: uuid("optica_id").notNull().references(() => opticas.id),
  nombre: text("nombre"),
  /** E.164 sin "+" → 50688887777 */
  telefono: text("telefono").notNull(),
  autorizado: boolean("autorizado").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("contactos_telefono_uq").on(t.telefono)]);

/* ───────────── Lista de precios (importada) ───────────── */

export const productos = pgTable("productos", {
  id: uuid("id").primaryKey().defaultRandom(),
  sku: text("sku").notNull().unique(),
  /** Código del laboratorio, si la lista lo trae (terminados, MYO) */
  codigo: text("codigo"),
  familia: text("familia"),               // Shamir | Image | Convencional | Terminado | Servicios
  nombre: text("nombre").notNull(),
  diseno: text("diseno"),                 // "Shamir Autograph III", "Progresivo Image Mobile"…
  tipo: text("tipo").notNull(),           // monofocal | bifocal | progresivo | ocupacional | antifatiga | myo | servicio
  nivel: text("nivel"),                   // Very Best | Best | Very Good | Good
  uso: text("uso"),
  material: text("material"),             // CR39 | Policarbonato | Trilogy | 1.56 | Futurex 1.57 | 1.60 | 1.67 | 1.74 (null en servicios)
  color: text("color"),
  /** Observaciones para la óptica: altura de pupila mínima, rango, protección… */
  notas: text("notas"),
  /** true = la lista marca el precio como "CONSULTAR": el agente lo da como referencia a confirmar */
  consultar: boolean("consultar").notNull().default(false),
  unidad: text("unidad").notNull().default("par"),
  indice: numeric("indice", { precision: 4, scale: 2 }),
  tratamiento: text("tratamiento"),       // AR | blue | fotocromático | ...
  esferaMin: numeric("esfera_min", { precision: 5, scale: 2 }),
  esferaMax: numeric("esfera_max", { precision: 5, scale: 2 }),
  cilindroMax: numeric("cilindro_max", { precision: 5, scale: 2 }),
  precio: numeric("precio", { precision: 12, scale: 2 }).notNull(),
  moneda: text("moneda").notNull().default("CRC"),
  /** Texto libre con sinónimos y cómo lo piden las ópticas ("varilux", "antirreflejo") */
  alias: text("alias"),
  activo: boolean("activo").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("productos_tipo_idx").on(t.tipo)]);

/* ───────────── Conversaciones y CRM ───────────── */

export const estadoConversacion = pgEnum("estado_conversacion", ["bot", "humano", "cerrada"]);
export const rolMensaje = pgEnum("rol_mensaje", ["cliente", "bot", "agente"]);
export const nivelCaso = pgEnum("nivel_caso", ["N2", "N3"]);
export const estadoCaso = pgEnum("estado_caso", ["nuevo", "en_atencion", "en_espera", "resuelto"]);

export const conversaciones = pgTable("conversaciones", {
  id: uuid("id").primaryKey().defaultRandom(),
  canal: text("canal").notNull(),                 // whatsapp | dev
  externalId: text("external_id").notNull(),      // id de conversación en Zernio ("<accountId>:<conversationId>")
  /** Solo WhatsApp. Instagram/Messenger no exponen teléfono. */
  telefono: text("telefono"),
  plataforma: text("plataforma"),                 // whatsapp | instagram | facebook | dev
  /** Cuenta de Zernio por la que entró (ver tabla conexiones) */
  cuentaId: text("cuenta_id"),
  participanteNombre: text("participante_nombre"),
  opticaId: uuid("optica_id").references(() => opticas.id),
  clienteId: uuid("cliente_id").references(() => clientes.id),
  estado: estadoConversacion("estado").notNull().default("bot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("conv_canal_ext_uq").on(t.canal, t.externalId)]);

export const mensajes = pgTable("mensajes", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversacionId: uuid("conversacion_id").notNull().references(() => conversaciones.id),
  rol: rolMensaje("rol").notNull(),
  contenido: text("contenido").notNull(),
  autor: text("autor"),                           // nombre del agente humano si rol=agente
  /** id del mensaje en el proveedor: evita procesar dos veces un reintento del webhook */
  externalId: text("external_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("mensajes_conv_idx").on(t.conversacionId, t.createdAt)]);

export const casos = pgTable("casos", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversacionId: uuid("conversacion_id").notNull().references(() => conversaciones.id),
  opticaId: uuid("optica_id").references(() => opticas.id),
  nivel: nivelCaso("nivel").notNull(),
  motivo: text("motivo").notNull(),               // ver MOTIVOS_ESCALAMIENTO
  resumen: text("resumen").notNull(),
  estado: estadoCaso("estado").notNull().default("nuevo"),
  asignadoA: text("asignado_a"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resueltoAt: timestamp("resuelto_at", { withTimezone: true }),
}, (t) => [
  index("casos_estado_idx").on(t.estado),
  /** Un solo caso abierto por conversación: evita duplicados si llegan dos mensajes a la vez */
  uniqueIndex("casos_conv_abierto_uq").on(t.conversacionId).where(sql`${t.estado} <> 'resuelto'`),
]);

export const notasCaso = pgTable("notas_caso", {
  id: uuid("id").primaryKey().defaultRandom(),
  casoId: uuid("caso_id").notNull().references(() => casos.id),
  autor: text("autor").notNull(),
  texto: text("texto").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────── Configuración del agente (editable desde el panel) ───────────── */

/** Cuentas de Zernio que atiende Consultin. Una cuenta sin fila (o inactiva) se ignora. */
export const conexiones = pgTable("conexiones", {
  cuentaId: text("cuenta_id").primaryKey(),       // _id de la cuenta en Zernio
  plataforma: text("plataforma").notNull(),
  nombre: text("nombre").notNull(),               // @usuario o número, para mostrar
  /** Qué pasa con quien NO está registrado: opticas = aviso + caso · abierto = agente solo escala · precios = agente cotiza (nunca órdenes) */
  modo: text("modo").notNull().default("opticas"),
  /** Prompt propio de esta conexión. null = usa el prompt base. */
  prompt: text("prompt"),
  activa: boolean("activa").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Pares clave/valor: prompt_base, etc. */
export const configuracion = pgTable("configuracion", {
  clave: text("clave").primaryKey(),
  valor: text("valor").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────── Analytics (alimenta el dashboard) ───────────── */

export const eventos = pgTable("eventos", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversacionId: uuid("conversacion_id").references(() => conversaciones.id),
  /** mensaje_entrante | tool_call | respuesta | escalamiento | error */
  tipo: text("tipo").notNull(),
  tool: text("tool"),
  ok: boolean("ok"),
  latenciaMs: integer("latencia_ms"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("eventos_tipo_fecha_idx").on(t.tipo, t.createdAt)]);
