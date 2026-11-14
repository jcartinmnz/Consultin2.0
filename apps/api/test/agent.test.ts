import { describe, expect, it, vi } from "vitest";
import { aMensajes, correrAgente, type LlmClient } from "../src/agent/run";
import { MockPriceSource } from "../src/sources/prices/mock";
import { MockOrderSource } from "../src/sources/orders/mock";
import { pideHumano } from "../src/services/reglas";

const usage = { input_tokens: 10, output_tokens: 5 } as any;

describe("correrAgente", () => {
  it("ejecuta tool_use y devuelve el texto final", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        stop_reason: "tool_use", usage,
        content: [{ type: "tool_use", id: "t1", name: "estado_orden", input: { numero_orden: "48213" } }],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn", usage,
        content: [{ type: "text", text: "Su orden *48213* está en tallado." }],
      });
    const llm: LlmClient = { messages: { create } };

    const r = await correrAgente({
      llm, model: "test", system: "s",
      historial: [{ rol: "cliente", contenido: "cómo va la 48213?" }],
      ctx: {
        prices: new MockPriceSource(), orders: new MockOrderSource(),
        optica: { id: "o1", nombre: "Demo", codigoLensware: "OPT001" }, escalar: async () => {},
      },
    });

    expect(r.texto).toContain("48213");
    expect(r.toolCalls).toEqual([expect.objectContaining({ tool: "estado_orden", ok: true })]);
    const segundaLlamada = create.mock.calls[1]![0];
    const toolResult = segundaLlamada.messages.at(-1).content[0];
    expect(JSON.parse(toolResult.content).orden.estado).toBe("En tallado");
  });
});

describe("aMensajes", () => {
  it("fusiona turnos del mismo rol y empieza con user", () => {
    const m = aMensajes([
      { rol: "bot", contenido: "hola" },
      { rol: "cliente", contenido: "precio" },
      { rol: "cliente", contenido: "progresivo" },
      { rol: "agente", contenido: "le ayudo" },
    ]);
    expect(m[0]).toEqual({ role: "user", content: "precio\nprogresivo" });
    expect(m[1]!.role).toBe("assistant");
  });
});

describe("pideHumano", () => {
  it.each([
    ["quiero hablar con una persona", true],
    ["me puede comunicar con un asesor?", true],
    ["asesor", true],
    ["cuánto sale un progresivo", false],
  ])("%s → %s", (t, esperado) => expect(pideHumano(t)).toBe(esperado));
});
