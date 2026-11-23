/** Teléfonos en E.164 sin "+" (convención del proyecto). Costa Rica por defecto: 8 dígitos → 506XXXXXXXX. */
const CR = /^[245678]\d{7}$/; // fijos 2/4, celulares 5/6/7/8; ninguno empieza con 0, 1, 3 o 9

export function normalizarTelefono(entrada: string): string | null {
  const d = entrada.replace(/\D/g, "");
  if (d.length === 8) return CR.test(d) ? `506${d}` : null;
  if (d.length === 11 && d.startsWith("506")) return CR.test(d.slice(3)) ? d : null;
  if (d.length >= 10 && d.length <= 15 && !d.startsWith("0") && !d.startsWith("506")) return d; // otro país, ya con código
  return null;
}
