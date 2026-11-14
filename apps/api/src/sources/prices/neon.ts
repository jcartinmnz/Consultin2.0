import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { productos } from "../../db/schema";
import type { BusquedaPrecio, PriceSource } from "../types";
import { ranking, type ProductoRow } from "./scoring";

/**
 * Lee la lista de precios importada en Neon (tabla `productos`).
 * Con ~1,400–2,000 SKUs es más simple y exacto traer los candidatos filtrados por tipo
 * y puntuar en memoria. Si crece mucho: agregar pg_trgm o embeddings (pgvector) aquí,
 * sin tocar al agente.
 */
export class NeonPriceSource implements PriceSource {
  readonly nombre = "neon";
  constructor(private db: Db) {}

  async buscar(q: BusquedaPrecio, limite = 5) {
    const filtros = [eq(productos.activo, true)];
    if (q.tipo) filtros.push(eq(productos.tipo, q.tipo.toLowerCase()));

    const rows = await this.db.select().from(productos).where(and(...filtros));
    const num = (v: string | null) => (v === null ? null : Number(v));
    const candidatos: ProductoRow[] = rows.map((r) => ({
      sku: r.sku, nombre: r.nombre, tipo: r.tipo, material: r.material,
      indice: num(r.indice), tratamiento: r.tratamiento,
      esferaMin: num(r.esferaMin), esferaMax: num(r.esferaMax), cilindroMax: num(r.cilindroMax),
      precio: Number(r.precio), moneda: r.moneda, alias: r.alias,
    }));
    return ranking(candidatos, q, limite);
  }
}
