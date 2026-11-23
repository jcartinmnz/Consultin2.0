import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { OrderSource, PriceSource, EstadoOrden } from "../sources/types";
import { estaAtrasada, traducirEstado } from "../sources/orders/estados";

export const MOTIVOS_ESCALAMIENTO = [
  "pide_humano", "producto_fuera_de_lista", "orden_atrasada", "orden_con_alerta",
  "reclamo", "garantia", "reproceso", "facturacion", "no_entendido", "numero_no_registrado", "otro",
] as const;

export interface OpticaCtx { id: string; nombre: string; codigoLensware: string | null }

export interface ToolContext {
  prices: PriceSource;
  orders: OrderSource;
  /** null = remitente no identificado (p. ej. un DM de Instagram): solo puede escalar. */
  optica: OpticaCtx | null;
  escalar: (e: { nivel: "N2" | "N3"; motivo: string; resumen: string }) => Promise<void>;
  ahora?: Date;
}

/* ───────────── Definiciones que ve el modelo ───────────── */

export const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "buscar_precio",
    description: "Busca en la lista oficial de precios del laboratorio (lentes por familia y diseño: Shamir, Image, talla convencional, terminados, Image MYO; y servicios de laboratorio como montajes, antirreflejos, teñidos y reparaciones). Usar para cualquier pregunta de precio o disponibilidad. Precios en colones, por par salvo que `unidad` diga otra cosa. Devuelve hasta 8 coincidencias, de la más parecida a la menos; a igual relevancia, la más barata primero.",
    input_schema: {
      type: "object",
      properties: {
        consulta: { type: "string", description: "Lo que pidió la óptica, en sus palabras. Ej: 'progresivo Autograph 1.67 transitions gris', 'montaje al aire'" },
        tipo: { type: "string", enum: ["monofocal", "bifocal", "progresivo", "ocupacional", "antifatiga", "myo", "servicio"], description: "monofocal = visión sencilla; ocupacional = oficina/computadora; antifatiga = relax; myo = Image MYO; servicio = montajes, capas AR, teñidos, reparaciones, urgencias" },
        marca: { type: "string", description: "Marca o familia si la óptica la menciona: Shamir, Image, Younger, Futurex, Nupolar, Vision Ease…" },
        material: { type: "string", description: "CR39, policarbonato, Trilogy/Trivex, 1.56, Futurex 1.57, 1.60, 1.67, 1.74" },
        indice: { type: "number", description: "Índice de refracción: 1.50 (CR39), 1.53 (Trilogy), 1.56, 1.57, 1.59 (policarbonato), 1.60, 1.67, 1.74" },
        tratamiento: { type: "string", description: "Claro, Transitions Gen 8 / Gen S / Xtractive / Signature VII / Vantage, Drivewear, Nupolar polarizado, fotocromático (Photo, Neochromes), Blue Zero / Blue Protect (luz azul), antireflejo" },
        color: { type: "string", description: "Gris, café, verde, sapphire, amethyst, emerald, amber, ruby…" },
        esfera: { type: "number", description: "Esfera más alta en valor absoluto de la receta, con signo (filtra productos con rango, como los terminados)" },
        cilindro: { type: "number", description: "Cilindro (negativo)" },
      },
      required: ["consulta"],
    },
  },
  {
    name: "estado_orden",
    description: "Consulta el estado de producción de órdenes de laboratorio de la óptica que escribe. Con numero_orden devuelve esa orden; sin él devuelve las órdenes más recientes de la óptica.",
    input_schema: {
      type: "object",
      properties: { numero_orden: { type: "string", description: "Número de orden del laboratorio" } },
    },
  },
  {
    name: "escalar_a_humano",
    description: "Transfiere la conversación al equipo de servicio al cliente y crea un caso en el CRM. Después de usarla, despedite indicando que una persona continuará la atención.",
    input_schema: {
      type: "object",
      properties: {
        nivel: { type: "string", enum: ["N2", "N3"], description: "N2 = necesita persona; N3 = reclamo, garantía, reproceso o facturación" },
        motivo: { type: "string", enum: [...MOTIVOS_ESCALAMIENTO] },
        resumen: { type: "string", description: "Resumen en 2-4 líneas: qué pidió la óptica, qué se consultó y qué falta resolver" },
      },
      required: ["nivel", "motivo", "resumen"],
    },
  },
];

/** Herramientas que se ofrecen al modelo: sin óptica identificada, solo escalar. */
export function toolsPara(identificado: boolean): Anthropic.Messages.Tool[] {
  return identificado ? TOOLS : TOOLS.filter((t) => t.name === "escalar_a_humano");
}

const SIN_IDENTIDAD = { ok: false, data: { error: "No disponible: quien escribe no es una óptica cliente identificada. Ofrecé pasar la consulta a una persona del equipo." } };

/* ───────────── Ejecución ───────────── */

const precioInput = z.object({
  consulta: z.string(), tipo: z.string().optional(), marca: z.string().optional(), material: z.string().optional(),
  indice: z.number().optional(), tratamiento: z.string().optional(), color: z.string().optional(),
  esfera: z.number().optional(), cilindro: z.number().optional(),
});
const ordenInput = z.object({ numero_orden: z.string().optional() });
const escalarInput = z.object({
  nivel: z.enum(["N2", "N3"]), motivo: z.enum(MOTIVOS_ESCALAMIENTO), resumen: z.string().min(5),
});

export interface ToolResult { ok: boolean; data: unknown; escalado?: boolean }

export async function ejecutarTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
  switch (name) {
    case "buscar_precio": {
      // Defensa en profundidad: aunque el modelo invente la llamada, sin identidad no hay datos.
      if (!ctx.optica) return SIN_IDENTIDAD;
      const q = precioInput.parse(input);
      const resultados = await ctx.prices.buscar(q, 8);
      return { ok: true, data: resultados.length
        ? { resultados, nota: "Precios en colones por par (ver `unidad`). Si hay varias opciones parecidas, preguntá lo mínimo para elegir. Si un resultado trae `aviso`, decíselo a la óptica." }
        : { resultados: [], nota: "Sin coincidencias en la lista de precios. Probá con menos filtros o una consulta más general antes de decir que no existe." } };
    }

    case "estado_orden": {
      if (!ctx.optica) return SIN_IDENTIDAD;
      const optica = ctx.optica;
      const codigo = optica.codigoLensware;
      // Óptica identificada pero todavía sin código de LensWare: no hay forma segura de saber cuáles órdenes son suyas
      if (!codigo) return { ok: true, data: { encontrada: false, nota: "Esta óptica todavía no está vinculada con el sistema de órdenes. No inventes estados: ofrecé pasar la consulta a una persona del equipo (escalar_a_humano, N2, motivo otro)." } };
      const { numero_orden } = ordenInput.parse(input);
      const vista = (o: EstadoOrden) => {
        const def = traducirEstado(o.estadoCodigo);
        const atrasada = estaAtrasada(o.fechaEstimada, o.estadoCodigo, ctx.ahora);
        return {
          numero_orden: o.numeroOrden, estado: o.estado, estacion: o.estacion,
          fecha_ingreso: o.fechaIngreso, fecha_estimada: o.fechaEstimada, referencia: o.referencia,
          atrasada, requiere_escalamiento: atrasada || !!def.alerta,
        };
      };
      if (numero_orden) {
        const o = await ctx.orders.obtener(numero_orden);
        // Seguridad: una óptica solo ve sus órdenes. Mismo mensaje si no existe o es de otro cliente.
        if (!o || o.codigoCliente !== codigo) {
          return { ok: true, data: { encontrada: false, nota: "No se encontró esa orden para esta óptica." } };
        }
        return { ok: true, data: { encontrada: true, orden: vista(o) } };
      }
      const recientes = await ctx.orders.recientes(codigo, 5);
      return { ok: true, data: { ordenes: recientes.map(vista) } };
    }

    case "escalar_a_humano": {
      const e = escalarInput.parse(input);
      await ctx.escalar(e);
      return { ok: true, data: { escalado: true }, escalado: true };
    }

    default:
      return { ok: false, data: { error: `Herramienta desconocida: ${name}` } };
  }
}
