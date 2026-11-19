import { describe, expect, it, vi } from "vitest";

// Repo en memoria: solo lo que procesarMensaje usa
const estado = { mensajes: [] as any[], casos: [] as any[], eventos: [] as any[] };
vi.mock("../src/services/repo", () => ({
  identificar: vi.fn(async () => null),
  upsertConversacion: vi.fn(async () => ({ id: "conv1", estado: "bot" })),
  guardarMensaje: vi.fn(async (_db: unknown, m: any) => { estado.mensajes.push(m); return true; }),
  registrarEvento: vi.fn(async (_db: unknown, e: any) => { estado.eventos.push(e); }),
  historial: vi.fn(async () => [{ rol: "cliente", contenido: "hola, ¿cuánto cuesta un chatbot?" }]),
  crearCaso: vi.fn(async (_db: unknown, c: any) => { estado.casos.push(c); return c; }),
  leerConfig: vi.fn(async () => null),
}));

const { procesarMensaje } = await import("../src/services/procesar");
const { MockPriceSource } = await import("../src/sources/prices/mock");
const { MockOrderSource } = await import("../src/sources/orders/mock");

const deps = (enviar: (c: string, t: string) => Promise<void>, create = vi.fn(async () => ({ stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "¡Hola! ¿Me indica su nombre?" }] }))) => ({
  env: { ANTHROPIC_MODEL: "x", LAB_NAME: "Topex" } as any, db: {} as any,
  channel: { nombre: "t", parseWebhook: async () => [], enviar },
  llm: { messages: { create } } as any,
  sources: { prices: new MockPriceSource(), orders: new MockOrderSource() },
});
const dm = { canal: "instagram", conversacionExtId: "acc:c1", telefono: "", cuentaId: "acc", nombrePerfil: "@cliente", texto: "hola, ¿cuánto cuesta un chatbot?", mensajeExtId: "m1" };

describe("procesarMensaje en modo abierto (Instagram)", () => {
  it("responde con el agente sin óptica identificada y solo ofrece escalar", async () => {
    estado.mensajes = []; estado.casos = [];
    const create = vi.fn(async () => ({ stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "¡Hola! ¿Me indica su nombre?" }] }));
    const enviar = vi.fn(async () => {});
    await procesarMensaje(deps(enviar, create) as any, dm, { modo: "abierto", prompt: "Sos el asistente de Expertia." });
    expect(enviar).toHaveBeenCalledWith("acc:c1", "¡Hola! ¿Me indica su nombre?");
    const p = (create.mock.calls[0] as any)[0];
    expect(p.system.startsWith("Sos el asistente de Expertia.")).toBe(true);
    expect(p.tools.map((t: any) => t.name)).toEqual(["escalar_a_humano"]);
    expect(estado.casos).toHaveLength(0);
  });

  it("en modo ópticas, un remitente sin teléfono registrado no pasa por el modelo", async () => {
    estado.casos = [];
    const create = vi.fn();
    await procesarMensaje(deps(vi.fn(async () => {}), create) as any, dm, { modo: "opticas", prompt: null });
    expect(create).not.toHaveBeenCalled();
    expect(estado.casos[0]).toMatchObject({ motivo: "numero_no_registrado" });
  });

  it("si el envío falla, no guarda la respuesta como enviada y abre un caso con el texto", async () => {
    estado.mensajes = []; estado.casos = [];
    const enviar = vi.fn(async () => { throw new Error("Zernio 400: ventana de 24 h cerrada"); });
    await procesarMensaje(deps(enviar) as any, dm, { modo: "abierto", prompt: null });
    expect(enviar).toHaveBeenCalledOnce();
    expect(estado.mensajes.filter((m) => m.rol === "bot")).toHaveLength(0);
    expect(estado.casos[0].resumen).toContain("No se pudo enviar");
    expect(estado.casos[0].resumen).toContain("¿Me indica su nombre?");
  });
});
