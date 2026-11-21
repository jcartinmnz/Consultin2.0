/**
 * Importa/actualiza la lista de precios de Topex desde un CSV (upsert por SKU).
 *
 *   DATABASE_URL=... pnpm --filter api exec tsx scripts/import-precios.ts ./lista-precios-topex.csv [--reemplazar]
 *
 * --reemplazar: desactiva (activo=false) los productos que no vengan en el archivo.
 *
 * Columnas (encabezado en la primera fila, separador coma, comillas dobles si el texto trae comas):
 *   sku,familia,nombre,diseno,tipo,nivel,uso,tratamiento,material,indice,color,
 *   esfera_min,esfera_max,cilindro_max,precio,moneda,unidad,consultar,notas,alias,codigo
 * Obligatorias: sku, nombre, tipo, precio. `consultar` = si/no.
 *
 * ⚠️ El repo es público: el CSV con precios NO se sube a git (ver .gitignore). Lo guarda Expertia.
 */
import { readFileSync } from "node:fs";
import { notInArray, sql } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { productos } from "../src/db/schema";

type Insert = typeof productos.$inferInsert;

const COLUMNAS: Record<string, keyof Insert> = {
  sku: "sku", codigo: "codigo", familia: "familia", nombre: "nombre", diseno: "diseno", tipo: "tipo",
  nivel: "nivel", uso: "uso", tratamiento: "tratamiento", material: "material", indice: "indice", color: "color",
  esfera_min: "esferaMin", esfera_max: "esferaMax", cilindro_max: "cilindroMax", precio: "precio",
  moneda: "moneda", unidad: "unidad", consultar: "consultar", notas: "notas", alias: "alias",
};

/** CSV con comillas dobles (RFC 4180). */
export function parseCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [], campo = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (fila.some((x) => x !== "")) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x !== "")) filas.push(fila);
  return filas;
}

/** Convierte las filas del CSV en registros válidos para `productos`. Lanza error con el número de línea si algo no cuadra. */
export function aProductos(filas: string[][]): Insert[] {
  const [encabezado, ...datos] = filas;
  if (!encabezado) throw new Error("CSV vacío");
  const cols = encabezado.map((h) => h.trim().toLowerCase());
  for (const req of ["sku", "nombre", "tipo", "precio"]) if (!cols.includes(req)) throw new Error(`Falta la columna "${req}"`);

  const num = (v: string | undefined) => {
    if (v === undefined || v.trim() === "") return null;
    const n = Number(v.trim().replace(/\s/g, ""));
    if (!Number.isFinite(n)) throw new Error(`Número inválido: "${v}"`);
    return String(n);
  };
  const vistos = new Set<string>();
  return datos.map((vals, i) => {
    try { return fila(vals, i + 2); }
    catch (e) { throw new Error(`Línea ${i + 2}: ${(e as Error).message.replace(/^Línea \d+: /, "")}`); }
  });

  function fila(vals: string[], linea: number): Insert {
    const r: Record<string, string> = {};
    cols.forEach((c, j) => { r[c] = (vals[j] ?? "").trim(); });
    if (!r.sku || !r.nombre || !r.tipo) throw new Error(`Línea ${linea}: sku, nombre y tipo son obligatorios`);
    if (vistos.has(r.sku)) throw new Error(`Línea ${linea}: SKU repetido ${r.sku}`);
    vistos.add(r.sku);
    const precio = num(r.precio);
    if (!precio || Number(precio) <= 0) throw new Error(`Línea ${linea} (${r.sku}): precio inválido "${r.precio}"`);
    const registro: Insert = { sku: r.sku, nombre: r.nombre, tipo: r.tipo.toLowerCase(), precio, activo: true };
    for (const [col, campo] of Object.entries(COLUMNAS)) {
      if (!(col in r) || ["sku", "nombre", "tipo", "precio"].includes(col)) continue;
      const v = r[col]!;
      if (["indice", "esfera_min", "esfera_max", "cilindro_max"].includes(col)) (registro as any)[campo] = num(v);
      else if (col === "consultar") registro.consultar = /^(si|sí|true|1|x)$/i.test(v);
      else (registro as any)[campo] = v === "" ? (col === "moneda" ? "CRC" : col === "unidad" ? "par" : null) : v;
    }
    return registro;
  }
}

async function main() {
  const archivo = process.argv[2];
  const reemplazar = process.argv.includes("--reemplazar");
  if (!archivo) throw new Error("Uso: tsx scripts/import-precios.ts <archivo.csv> [--reemplazar]");
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL");

  const lista = aProductos(parseCsv(readFileSync(archivo, "utf8")));
  const db = getDb(process.env.DATABASE_URL);
  for (const fila of lista) {
    const { sku, ...resto } = fila;
    await db.insert(productos).values(fila).onConflictDoUpdate({ target: productos.sku, set: { ...resto, updatedAt: sql`now()` } });
  }
  let desactivados = 0;
  if (reemplazar) {
    const r = await db.update(productos).set({ activo: false, updatedAt: sql`now()` })
      .where(notInArray(productos.sku, lista.map((f) => f.sku))).returning({ sku: productos.sku });
    desactivados = r.length;
  }
  console.log(`Importados ${lista.length} productos${reemplazar ? `; desactivados ${desactivados} que no estaban en el archivo` : ""}.`);
}

// Solo corre como script (los tests importan parseCsv/aProductos)
if (process.argv[1]?.endsWith("import-precios.ts")) await main();
