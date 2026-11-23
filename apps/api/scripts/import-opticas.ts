/**
 * Importa/actualiza la base de ópticas de Topex desde un CSV (upsert por `clave`).
 *
 *   DATABASE_URL=... pnpm --filter api exec tsx scripts/import-opticas.ts ./opticas-topex.csv
 *
 * Columnas: clave,nombre,razon_social,codigo_sap,codigo_mac,ruta,whatsapp,telefonos,correo,horario,ubicacion,contacto,notas
 *   - whatsapp: números que identifican a la óptica (E.164 sin "+", separados por "|"). Se registran como autorizados.
 *   - telefonos: otros números (fijos), solo informativos.
 * Por óptica: crea/actualiza la óptica, su perfil de cliente (solo completa campos vacíos: no pisa lo editado en el
 * panel) y sus números autorizados. Un número que ya pertenece a otra óptica NO se mueve: se reporta.
 * El código de LensWare no viene en la base: se completa aparte cuando se conecte LensWare.
 *
 * ⚠️ El repo es público: el CSV trae teléfonos, correos y nombres. NO se sube a git.
 */
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { clientes, contactos, opticas } from "../src/db/schema";
import { clienteDeOptica } from "../src/services/repo";
import { parseCsv } from "./import-precios";

export interface OpticaImport {
  clave: string; nombre: string; razonSocial: string | null; codigoSap: string | null; codigoMac: string | null; ruta: string | null;
  whatsapp: string[]; telefonos: string[]; correo: string | null; horario: string | null; ubicacion: string | null;
  contacto: string | null; notas: string | null;
}

const TELEFONO = /^506\d{8}$/;

export function aOpticas(filas: string[][]): OpticaImport[] {
  const [encabezado, ...datos] = filas;
  if (!encabezado) throw new Error("CSV vacío");
  const cols = encabezado.map((h) => h.trim().toLowerCase());
  for (const req of ["clave", "nombre", "whatsapp"]) if (!cols.includes(req)) throw new Error(`Falta la columna "${req}"`);
  const vistos = new Set<string>();
  return datos.map((vals, i) => {
    const linea = i + 2;
    const r: Record<string, string> = {};
    cols.forEach((c, j) => { r[c] = (vals[j] ?? "").trim(); });
    const v = (k: string) => r[k] || null;
    if (!r.clave || !r.nombre) throw new Error(`Línea ${linea}: clave y nombre son obligatorios`);
    if (vistos.has(r.clave)) throw new Error(`Línea ${linea}: clave repetida ${r.clave}`);
    vistos.add(r.clave);
    const lista = (k: string) => (r[k] ?? "").split("|").map((t) => t.replace(/\D/g, "")).filter(Boolean);
    const whatsapp = lista("whatsapp");
    const malo = whatsapp.find((t) => !TELEFONO.test(t));
    if (malo) throw new Error(`Línea ${linea} (${r.nombre}): número inválido "${malo}" (formato 506XXXXXXXX)`);
    const correo = v("correo");
    return {
      clave: r.clave, nombre: r.nombre, razonSocial: v("razon_social"), codigoSap: v("codigo_sap"), codigoMac: v("codigo_mac"),
      ruta: v("ruta"), whatsapp, telefonos: lista("telefonos"), correo: correo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo) ? correo : null,
      horario: v("horario"), ubicacion: v("ubicacion"), contacto: v("contacto"), notas: v("notas"),
    };
  });
}

/** Notas del perfil armadas con lo que trae la base (ruta, horario, contacto, códigos). */
export function notasPerfil(o: OpticaImport): string {
  return [
    o.ruta && `Ruta: ${o.ruta}`, o.horario && `Horario: ${o.horario}`, o.contacto && `Contacto: ${o.contacto}`,
    (o.codigoSap || o.codigoMac) && `Código SAP: ${o.codigoSap ?? "—"} · MAC: ${o.codigoMac ?? "—"}`, o.notas,
  ].filter(Boolean).join("\n");
}

async function main() {
  const archivo = process.argv[2];
  if (!archivo) throw new Error("Uso: tsx scripts/import-opticas.ts <archivo.csv>");
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL");
  const lista = aOpticas(parseCsv(readFileSync(archivo, "utf8")));
  const db = getDb(process.env.DATABASE_URL);
  const r = { opticas: 0, numerosNuevos: 0, conflictos: [] as string[] };

  for (const o of lista) {
    const datos = { nombre: o.nombre, razonSocial: o.razonSocial, codigoSap: o.codigoSap, codigoMac: o.codigoMac, ruta: o.ruta, activa: true };
    const [optica] = await db.insert(opticas).values({ clave: o.clave, ...datos })
      .onConflictDoUpdate({ target: opticas.clave, set: datos }).returning();
    r.opticas++;

    const clienteId = await clienteDeOptica(db, optica!);
    const telefonos = [...o.whatsapp, ...o.telefonos].map((t) => `+${t}`).join(" / ") || null;
    // Solo completa lo vacío: lo que el equipo editó en el panel se respeta
    await db.update(clientes).set({
      nombre: o.nombre,
      empresa: sql`coalesce(${clientes.empresa}, ${o.razonSocial})`,
      email: sql`coalesce(${clientes.email}, ${o.correo})`,
      telefono: sql`coalesce(${clientes.telefono}, ${telefonos})`,
      direccion: sql`coalesce(${clientes.direccion}, ${o.ubicacion})`,
      notas: sql`coalesce(${clientes.notas}, ${notasPerfil(o) || null})`,
    }).where(eq(clientes.id, clienteId));

    for (const tel of o.whatsapp) {
      const nuevo = await db.insert(contactos).values({ opticaId: optica!.id, telefono: tel, nombre: o.contacto ?? "WhatsApp" })
        .onConflictDoNothing({ target: contactos.telefono }).returning({ id: contactos.id });
      if (nuevo.length) { r.numerosNuevos++; continue; }
      const [dueno] = await db.select({ opticaId: contactos.opticaId }).from(contactos).where(eq(contactos.telefono, tel));
      if (dueno && dueno.opticaId !== optica!.id) r.conflictos.push(`+${tel} (${o.nombre}) ya pertenece a otra óptica`);
    }
  }
  console.log(`Ópticas importadas/actualizadas: ${r.opticas}. Números autorizados nuevos: ${r.numerosNuevos}.`);
  if (r.conflictos.length) console.log(`No se movieron ${r.conflictos.length} números:\n  ${r.conflictos.join("\n  ")}`);
}

if (process.argv[1]?.endsWith("import-opticas.ts")) await main();
