import type { BusquedaPrecio, ProductoCotizado } from "../types";

export interface ProductoRow {
  sku: string;
  nombre: string;
  tipo: string;
  material: string | null;
  indice: number | null;
  tratamiento: string | null;
  esferaMin: number | null;
  esferaMax: number | null;
  cilindroMax: number | null;
  precio: number;
  moneda: string;
  alias: string | null;
  familia?: string | null;
  diseno?: string | null;
  nivel?: string | null;
  uso?: string | null;
  color?: string | null;
  notas?: string | null;
  consultar?: boolean;
  unidad?: string;
}

export const normalizar = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.\s]/g, " ");

/** Cómo escriben las ópticas → término que aparece en la lista */
const SINONIMOS: Record<string, string> = {
  multifocal: "progresivo", multifocales: "progresivo", varilux: "progresivo", progre: "progresivo",
  sencillo: "sencilla", "vision simple": "vision sencilla", monofocales: "monofocal",
  antirreflejo: "antireflejo", antireflejante: "antireflejo", antirreflejante: "antireflejo",
  poli: "policarbonato", "cr 39": "cr39", trivex: "trilogy",
  transiciones: "transitions", transition: "transitions", fotosensible: "fotocromatico", fotocromaticos: "fotocromatico",
  "luz azul": "blue", "filtro azul": "blue", bluecut: "blue", "blue cut": "blue",
  oficina: "ocupacional", computadora: "ocupacional", lectura: "ocupacional",
  miopia: "myo", polarizados: "polarizado", "de sol": "polarizado", manejar: "drivewear", conducir: "drivewear",
};

const STOPWORDS = new Set([
  "de", "del", "con", "sin", "un", "una", "unos", "unas", "el", "la", "los", "las", "para", "por", "en", "y", "o", "a", "al",
  "lente", "lentes", "mica", "micas", "cuanto", "cuesta", "cuestan", "sale", "salen", "precio", "precios", "vale", "valen",
  "me", "que", "hay", "tienen", "tiene", "quiero", "necesito", "cotizar", "cotizacion", "cotiza", "favor", "par", "pares",
  "material", "tratamiento", "color", "como", "cual", "cuales", "ese", "esa", "este", "esta",
]);

export function tokens(texto: string): string[] {
  let t = ` ${normalizar(texto)} `;
  for (const [k, v] of Object.entries(SINONIMOS)) t = t.replaceAll(` ${k} `, ` ${v} `);
  return t.split(/\s+/).filter((x) => x.length > 1 && !STOPWORDS.has(x));
}

/** Palabra completa; prefijo para términos de 4+ letras ("progre" → "progresivo"); plural simple ("polarizados"). */
function coincide(tk: string, palabras: Set<string>): boolean {
  const variantes = tk.length > 4 && tk.endsWith("s") ? [tk, tk.slice(0, -1)] : [tk];
  for (const v of variantes) {
    if (palabras.has(v)) return true;
    if (v.length < 4) continue;
    for (const p of palabras) if (p.startsWith(v)) return true;
  }
  return false;
}

const sinEspacios = (s: string) => normalizar(s).replace(/\s+/g, "");

/** La lista mezcla colores en inglés (Gray/Brown) y en español (GRIS-CAFÉ): se indexan ambos. */
const COLORES: Record<string, string> = {
  gray: "gris", grey: "gris", gris: "gray", brown: "cafe", cafe: "brown", green: "verde", verde: "green",
  sapphire: "zafiro azul", amethyst: "amatista morado", emerald: "esmeralda", amber: "ambar", ruby: "rubi rojo",
};

function texto(p: ProductoRow) {
  const base = normalizar([p.nombre, p.familia, p.diseno, p.tipo, p.nivel, p.uso, p.material, p.indice, p.tratamiento, p.alias].filter(Boolean).join(" "));
  const color = normalizar(p.color ?? "").split(/\s+/).filter(Boolean).map((c) => `${c} ${COLORES[c] ?? ""}`).join(" ");
  return `${base} ${color}`;
}

/** Puntúa qué tan bien un producto calza con la búsqueda. -Infinity = descartado. */
export function puntuar(p: ProductoRow, q: BusquedaPrecio): number {
  if (q.tipo && normalizar(p.tipo) !== normalizar(q.tipo)) return -Infinity;
  if (q.indice && p.indice && Math.abs(p.indice - q.indice) > 0.015) return -Infinity;
  if (q.esfera !== undefined && p.esferaMin !== null && p.esferaMax !== null &&
      (q.esfera < p.esferaMin || q.esfera > p.esferaMax)) return -Infinity;
  if (q.cilindro !== undefined && p.cilindroMax !== null && q.cilindro < p.cilindroMax) return -Infinity;

  const haystack = texto(p);
  const plano = haystack.replace(/\s+/g, "");
  if (q.marca && !plano.includes(sinEspacios(q.marca))) return -Infinity;

  const palabras = new Set(haystack.split(/\s+/).filter(Boolean));
  // Filtros explícitos que calzaron ya cuentan, para que "progresivo índice 1.67" devuelva algo sin texto libre
  let score = (q.tipo ? 0.5 : 0) + (q.indice && p.indice ? 0.5 : 0) + (q.marca ? 1 : 0);
  for (const tk of tokens(q.consulta)) if (coincide(tk, palabras)) score += 1;
  if (q.material && tokens(q.material).every((t) => coincide(t, palabras))) score += 2;
  if (q.tratamiento && tokens(q.tratamiento).every((t) => coincide(t, palabras))) score += 2;
  if (q.color && tokens(q.color).some((t) => coincide(t, palabras))) score += 1;
  return score;
}

/** Solo se devuelven resultados cercanos al mejor: evita mezclar "progresivo CR39 claro" cuando pidieron "1.67 Transitions". */
const RELEVANCIA_MINIMA = 0.6;

export function ranking(rows: ProductoRow[], q: BusquedaPrecio, limite = 8): ProductoCotizado[] {
  const puntuados = rows.map((p) => ({ p, s: puntuar(p, q) })).filter((x) => x.s > 0);
  const mejor = Math.max(0, ...puntuados.map((x) => x.s));
  return puntuados
    .filter((x) => x.s >= mejor * RELEVANCIA_MINIMA)
    .sort((a, b) => b.s - a.s || a.p.precio - b.p.precio)
    .slice(0, limite)
    .map(({ p }) => ({
      sku: p.sku, nombre: p.nombre, familia: p.familia ?? null, diseno: p.diseno ?? null, tipo: p.tipo,
      material: p.material, indice: p.indice, tratamiento: p.tratamiento, color: p.color ?? null,
      precio: p.precio, moneda: p.moneda, unidad: p.unidad ?? "par",
      rango: rangoTexto(p), notas: p.notas ?? null,
      ...(p.consultar ? { consultar: true, aviso: "Precio de referencia marcado 'CONSULTAR' en la lista: confirmarlo con el laboratorio." } : {}),
    }));
}

function rangoTexto(p: ProductoRow): string | null {
  if (p.esferaMin === null || p.esferaMax === null) return null;
  const f = (n: number) => (n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2));
  return `Esf ${f(p.esferaMin)} a ${f(p.esferaMax)}${p.cilindroMax !== null ? ` / Cil hasta ${p.cilindroMax.toFixed(2)}` : ""}`;
}
