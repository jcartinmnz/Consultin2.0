/**
 * Importa/actualiza la lista de precios real de Topex desde un CSV (upsert por SKU).
 *   DATABASE_URL=... pnpm --filter api exec tsx scripts/import-precios.ts ./precios.csv
 *
 * Columnas esperadas (encabezado en la primera fila, separador coma):
 *   sku,nombre,tipo,material,indice,tratamiento,esfera_min,esfera_max,cilindro_max,precio,moneda,alias
 *
 * Si Topex entrega el Excel con otras columnas, ajustar solo MAPEO.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { productos } from "../src/db/schema";

const MAPEO: Record<string, keyof typeof productos.$inferInsert> = {
  sku: "sku", nombre: "nombre", tipo: "tipo", material: "material", indice: "indice",
  tratamiento: "tratamiento", esfera_min: "esferaMin", esfera_max: "esferaMax",
  cilindro_max: "cilindroMax", precio: "precio", moneda: "moneda", alias: "alias",
};

const file = process.argv[2];
if (!file) throw new Error("Uso: tsx scripts/import-precios.ts <archivo.csv>");

const [header, ...lines] = readFileSync(file, "utf8").trim().split(/\r?\n/);
const cols = header!.split(",").map((h) => h.trim().toLowerCase());
const db = getDb(process.env.DATABASE_URL!);

let n = 0;
for (const line of lines) {
  const vals = line.split(",").map((v) => v.trim());
  const row: Record<string, string | null> = {};
  cols.forEach((col, i) => { const k = MAPEO[col]; if (k) row[k] = vals[i] || null; });
  if (!row.sku || !row.precio) continue;
  row.tipo = (row.tipo ?? "").toLowerCase();
  await db.insert(productos).values(row as any).onConflictDoUpdate({
    target: productos.sku,
    set: { ...(row as any), updatedAt: sql`now()` },
  });
  n++;
}
console.log(`Importados/actualizados ${n} productos`);
