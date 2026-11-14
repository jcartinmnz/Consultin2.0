import { describe, expect, it, vi } from "vitest";
import { MockPriceSource } from "../src/sources/prices/mock";
import { MockOrderSource } from "../src/sources/orders/mock";
import { ejecutarTool, type ToolContext } from "../src/agent/tools";

const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
  prices: new MockPriceSource(),
  orders: new MockOrderSource(),
  optica: { id: "o1", nombre: "Óptica Demo Central", codigoLensware: "OPT001" },
  escalar: vi.fn(async () => {}),
  ahora: new Date("2026-11-15T10:00:00-06:00"),
  ...over,
});

describe("buscar_precio", () => {
  it("encuentra progresivo 1.67 con antirreflejo usando sinónimos", async () => {
    const r = await ejecutarTool("buscar_precio", { consulta: "multifocal 1.67 antirreflejo", tipo: "progresivo", indice: 1.67 }, ctx());
    const data = r.data as any;
    expect(data.resultados[0].sku).toBe("PG-DIG-167-AR");
    expect(data.resultados[0].precio).toBe(68000);
  });

  it("descarta productos fuera del rango de graduación", async () => {
    const r = await ejecutarTool("buscar_precio", { consulta: "monofocal CR-39", tipo: "monofocal", esfera: -9 }, ctx());
    const skus = (r.data as any).resultados.map((p: any) => p.sku);
    expect(skus).not.toContain("MF-CR39-150");
  });

  it("devuelve lista vacía con nota si no hay coincidencias", async () => {
    const r = await ejecutarTool("buscar_precio", { consulta: "lente de contacto tórico" }, ctx());
    expect((r.data as any).resultados).toHaveLength(0);
  });
});

describe("estado_orden", () => {
  it("devuelve la orden propia traducida", async () => {
    const r = await ejecutarTool("estado_orden", { numero_orden: "48213" }, ctx());
    expect((r.data as any).orden.estado).toBe("En tallado");
    expect((r.data as any).orden.requiere_escalamiento).toBe(false);
  });

  it("NO revela órdenes de otra óptica", async () => {
    const r = await ejecutarTool("estado_orden", { numero_orden: "48220" }, ctx()); // es de OPT002
    expect((r.data as any).encontrada).toBe(false);
  });

  it("marca orden atrasada para escalar", async () => {
    const r = await ejecutarTool("estado_orden", { numero_orden: "48105" },
      ctx({ optica: { id: "o2", nombre: "Norte", codigoLensware: "OPT002" } }));
    expect((r.data as any).orden.atrasada).toBe(true);
    expect((r.data as any).orden.requiere_escalamiento).toBe(true);
  });

  it("sin número devuelve las recientes de la óptica", async () => {
    const r = await ejecutarTool("estado_orden", {}, ctx());
    const nums = (r.data as any).ordenes.map((o: any) => o.numero_orden);
    expect(nums).toEqual(["48213", "48214", "48190"]);
  });
});

describe("escalar_a_humano", () => {
  it("llama al callback y marca escalado", async () => {
    const c = ctx();
    const r = await ejecutarTool("escalar_a_humano", { nivel: "N3", motivo: "garantia", resumen: "Óptica reporta lente rayado en orden 48190." }, c);
    expect(r.escalado).toBe(true);
    expect(c.escalar).toHaveBeenCalledOnce();
  });
});
