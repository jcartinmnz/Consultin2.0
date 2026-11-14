import { normalizar } from "../sources/prices/scoring";

/**
 * Reglas deterministas que se evalúan ANTES del modelo.
 * Son baratas, predecibles y no dependen de que el LLM "decida" bien.
 */

const PIDE_HUMANO = [
  /\b(hablar|comunicar(me)?|pasar(me)?|contactar)\b.*\b(persona|humano|alguien|asesor|agente|ejecutiv[oa])\b/,
  /\b(persona real|un humano|servicio al cliente)\b/,
  /^(asesor|humano|agente)$/,
];

export function pideHumano(texto: string): boolean {
  const t = normalizar(texto).trim();
  return PIDE_HUMANO.some((re) => re.test(t));
}

export const MENSAJES = {
  noRegistrado: (lab: string) =>
    `Hola, gracias por escribir a ${lab}. Este número no está registrado como óptica cliente. Ya le pasé su mensaje al equipo de servicio al cliente para que le contacte.`,
  handoff: "Con gusto. Ya le pasé la conversación a una persona del equipo de servicio al cliente; le responderá por este mismo chat.",
  errorGeneral: "Disculpe, tuve un problema para procesar su consulta. Ya avisé a una persona del equipo para que le ayude.",
};

/** Resumen simple para escalamientos deterministas (sin pasar por el modelo). */
export function resumenDesdeHistorial(turnos: { rol: string; contenido: string }[], max = 6): string {
  return turnos.slice(-max).map((t) => `${t.rol}: ${t.contenido}`).join("\n").slice(0, 1500);
}
