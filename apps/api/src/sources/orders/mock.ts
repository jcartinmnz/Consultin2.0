import data from "../../data/mock-ordenes.json";
import type { EstadoOrden, OrderSource } from "../types";
import { traducirEstado } from "./estados";

type Raw = Omit<EstadoOrden, "estado">;

export class MockOrderSource implements OrderSource {
  readonly nombre = "mock";
  private rows = (data as Raw[]).map((r) => ({ ...r, estado: traducirEstado(r.estadoCodigo).label }));

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
