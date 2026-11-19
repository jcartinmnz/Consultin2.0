import data from "../../data/mock-ordenes.json";
import type { EstadoOrden, OrderSource } from "../types";
import { traducirEstado } from "./estados";

type Raw = Omit<EstadoOrden, "estado">;

/**
 * Las fechas de mock-ordenes.json están escritas como si "hoy" fuera ANCLA.
 * Con `hoy` se desplazan para que la demo siempre se vea igual
 * (48213 en tiempo, 48105 atrasada, etc.) sin importar el día en que se corra.
 * Sin `hoy` (tests) se usan tal cual.
 */
export const ANCLA = new Date("2026-11-15T10:00:00-06:00");

export class MockOrderSource implements OrderSource {
  readonly nombre = "mock";
  private rows: EstadoOrden[];

  constructor(hoy?: Date) {
    const delta = hoy ? hoy.getTime() - ANCLA.getTime() : 0;
    const mover = (f: string | null) => (f && delta ? new Date(new Date(f).getTime() + delta).toISOString() : f);
    this.rows = (data as Raw[]).map((r) => ({
      ...r,
      fechaIngreso: mover(r.fechaIngreso),
      fechaEstimada: mover(r.fechaEstimada),
      estado: traducirEstado(r.estadoCodigo).label,
    }));
  }

  async obtener(numeroOrden: string) {
    return this.rows.find((r) => r.numeroOrden === numeroOrden.trim()) ?? null;
  }

  async recientes(codigoCliente: string, limite = 5) {
    return this.rows
      .filter((r) => r.codigoCliente === codigoCliente)
      .sort((a, b) => (b.fechaIngreso ?? "").localeCompare(a.fechaIngreso ?? ""))
      .slice(0, limite);
  }
}
