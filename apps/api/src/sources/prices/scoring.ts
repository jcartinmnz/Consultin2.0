import type { BusquedaPrecio, ProductoCotizado } from "../types";

export interface ProductoRow {
  sku: string;
  nombre: string;
  tipo: string;
  material: string;
  indice: number | null;
  tratamiento: string | null;
  esferaMin: number | null;
  esferaMax: number | null;
  cilindroMax: number | null;
  precio: number;
  moneda: string;
  alias: string | null;
}

export const normalizar = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.\s]/g, " ");

/** Sinónimos frecuentes de cómo escriben las ópticas → término canónico */
const SINONIMOS: Record<string, string> = {
  multifocal: "progresivo", varilux: "progresivo", progre: "progresivo",
  antirreflejo: "ar", antireflejo: "ar", anti: "ar",
  poli: "policarbonato", transitions: "fotocromatico", "luz azul": "blue",
};

const STOPWORDS = new Set([
  "de", "del", "con", "sin", "un", "una", "unos", "el", "la", "los", "las", "para", "por", "en", "y", "o",
  "lente", "lentes", "cuanto", "cuesta", "sale", "precio", "vale", "me", "un", "que", "hay", "tienen",
]);

export function tokens(texto: string): string[] {
  let t = ` ${normalizar(texto)} `;
  for (const [k, v] of Object.entries(SINONIMOS)) t = t.replaceAll(` ${k} `, ` ${v} `);
  return t.split(/\s+/).filter((x) => x.length > 1 && !STOPWORDS.has(x));
}

/** Coincidencia por palabra completa; prefijo solo para términos de 4+ letras ("progre" → "progresivo"). */
function coincide(tk: string, palabras: Set<string>): boolean {
  if (palabras.has(tk)) return true;
  if (tk.length < 4) return false;
  for (const p of palabras) if (p.startsWith(tk)) return true;
  return false;
}

/** Puntúa qué tan bien un producto calza con la búsqueda. -Infinity = descartado. */
export function puntuar(p: ProductoRow, q: BusquedaPrecio): number {
  if (q.tipo && normalizar(p.tipo) !== normalizar(q.tipo)) return -Infinity;
  if (q.indice && p.indice && Math.abs(p.indice - q.indice) > 0.001) return -Infinity;
  if (q.esfera !== undefined && p.esferaMin !== null && p.esferaMax !== null &&
      (q.esfera < p.esferaMin || q.esfera > p.esferaMax)) return -Infinity;
  if (q.cilindro !== undefined && p.cilindroMax !== null && q.cilindro < p.cilindroMax) return -Infinity;

  const haystack = normalizar(`${p.nombre} ${p.tipo} ${p.material} ${p.indice ?? ""} ${p.tratamiento ?? ""} ${p.alias ?? ""}`);
  const palabras = new Set(haystack.split(/\s+/).filter(Boolean));
  let score = 0;
  for (const tk of tokens(q.consulta)) if (coincide(tk, palabras)) score += 1;
  if (q.material && haystack.includes(normalizar(q.material))) score += 2;
  if (q.tratamiento && normalizar(p.tratamiento ?? "") === normalizar(q.tratamiento)) score += 2;
  return score;
}

export function ranking(rows: ProductoRow[], q: BusquedaPrecio, limite = 5): ProductoCotizado[] {
  return rows
    .map((p) => ({ p, s: puntuar(p, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.precio - b.p.precio)
    .slice(0, limite)
    .map(({ p }) => ({
      sku: p.sku, nombre: p.nombre, tipo: p.tipo, material: p.material, indice: p.indice,
      tratamiento: p.tratamiento, precio: p.precio, moneda: p.moneda,
      rango: p.esferaMin !== null && p.esferaMax !== null
        ? `Esf ${p.esferaMin.toFixed(2)} a +${p.esferaMax.toFixed(2)}${p.cilindroMax !== null ? ` / Cil hasta ${p.cilindroMax.toFixed(2)}` : ""}`
        : null,
    }));
}
