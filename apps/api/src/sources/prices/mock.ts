import data from "../../data/mock-productos.json";
import type { BusquedaPrecio, PriceSource } from "../types";
import { ranking, type ProductoRow } from "./scoring";

export class MockPriceSource implements PriceSource {
  readonly nombre = "mock";
  private rows = data as ProductoRow[];

  async buscar(q: BusquedaPrecio, limite = 5) {
    return ranking(this.rows, q, limite);
  }
}
