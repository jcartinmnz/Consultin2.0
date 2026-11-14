/**
 * Datos de prueba en Neon: 2 ópticas, 2 contactos y la lista de precios mock.
 *   DATABASE_URL=... pnpm --filter api db:seed
 */
import { getDb } from "../src/db/client";
import { contactos, opticas, productos } from "../src/db/schema";
import data from "../src/data/mock-productos.json";

const db = getDb(process.env.DATABASE_URL!);

const [o1] = await db.insert(opticas).values({ nombre: "Óptica Demo Central", codigoLensware: "OPT001" }).onConflictDoNothing().returning();
const [o2] = await db.insert(opticas).values({ nombre: "Óptica Demo Norte", codigoLensware: "OPT002" }).onConflictDoNothing().returning();
if (o1) await db.insert(contactos).values({ opticaId: o1.id, nombre: "María (demo)", telefono: "50688880001" }).onConflictDoNothing();
if (o2) await db.insert(contactos).values({ opticaId: o2.id, nombre: "Carlos (demo)", telefono: "50688880002" }).onConflictDoNothing();

const s = (n: number | null) => (n === null ? null : String(n));
for (const p of data as any[]) {
  await db.insert(productos).values({
    ...p, indice: s(p.indice), esferaMin: s(p.esferaMin), esferaMax: s(p.esferaMax),
    cilindroMax: s(p.cilindroMax), precio: String(p.precio),
  }).onConflictDoNothing();
}
console.log("Seed listo: ópticas OPT001/OPT002, teléfonos 50688880001/50688880002,", data.length, "productos");
