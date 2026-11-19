import { describe, expect, it } from "vitest";
import { ANCLA, MockOrderSource } from "../src/sources/orders/mock";
import { estaAtrasada } from "../src/sources/orders/estados";
import { devConversacionId } from "../src/channels/dev";

describe("órdenes mock relativas a hoy", () => {
  it("sin fecha usa los datos tal cual", async () => {
    const o = await new MockOrderSource().obtener("48213");
    expect(o!.fechaEstimada).toBe("2026-11-17T16:00:00-06:00");
  });

  it("con fecha desplaza todo, así la demo se ve igual cualquier día", async () => {
    const hoy = new Date(ANCLA.getTime() + 30 * 86_400_000); // 30 días después
    const src = new MockOrderSource(hoy);
    const enTiempo = await src.obtener("48213");
    const atrasada = await src.obtener("48105");
    const hold = await src.obtener("48220");
    expect(estaAtrasada(enTiempo!.fechaEstimada, enTiempo!.estadoCodigo, hoy)).toBe(false);
    expect(estaAtrasada(atrasada!.fechaEstimada, atrasada!.estadoCodigo, hoy)).toBe(true);
    expect(hold!.fechaEstimada).toBeNull();
    // El orden de "recientes" no cambia
    expect((await src.recientes("OPT001")).map((o) => o.numeroOrden)).toEqual(["48213", "48214", "48190"]);
  });
});

describe("devConversacionId", () => {
  it("separa sesiones del simulador y limpia la entrada", () => {
    expect(devConversacionId("+506 8888-0001")).toBe("dev-50688880001");
    expect(devConversacionId("50688880001", "abc123")).toBe("dev-50688880001-abc123");
    expect(devConversacionId("50688880001", "../../x")).toBe("dev-50688880001");
  });
});
