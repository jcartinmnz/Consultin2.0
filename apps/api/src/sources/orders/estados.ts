/**
 * Traducción de códigos de estado de LensWare → lenguaje humano.
 * ⚠️ PLACEHOLDER: reemplazar con la tabla real que entregue Topex en la Fase 0.
 * `final` = la orden ya salió del laboratorio. `alerta` = el agente debe escalar.
 */
export interface DefEstado {
  label: string;
  final?: boolean;
  alerta?: boolean;
}

export const ESTADOS_LENSWARE: Record<string, DefEstado> = {
  RECV: { label: "Recibida en el laboratorio" },
  HOLD: { label: "En espera — requiere revisión", alerta: true },
  PICK: { label: "Preparando material" },
  SURF: { label: "En tallado" },
  COAT: { label: "En tratamiento (antirreflejo / filtros)" },
  EDGE: { label: "En biselado y montaje" },
  QC:   { label: "En control de calidad" },
  SHIP: { label: "Lista / despachada", final: true },
  RMK:  { label: "En reproceso", alerta: true },
};

export function traducirEstado(codigo: string): DefEstado {
  return ESTADOS_LENSWARE[codigo.toUpperCase()] ?? { label: `Estado ${codigo}`, alerta: true };
}

/** Una orden está atrasada si su fecha estimada ya pasó y no está en estado final. */
export function estaAtrasada(fechaEstimada: string | null, codigo: string, ahora = new Date()): boolean {
  if (!fechaEstimada) return false;
  return !traducirEstado(codigo).final && new Date(fechaEstimada).getTime() < ahora.getTime();
}
