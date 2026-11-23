import { describe, expect, it, vi } from "vitest";

// Repo en memoria: solo lo que procesarMensaje usa
const estado = { mensajes: [] as any[], casos: [] as any[], eventos: [] as any[], clientes: [] as any[], convEstado: "bot" as string };
vi.mock("../src/services/repo", () => ({
  identificar: vi.fn(async () => null),
  upsertConversacion: vi.fn(async () => ({ id: "conv1", estado: "bot" })),
  guardarMensaje: vi.fn(async (_db: unknown, m: any) => { const id = `id${estado.mensajes.length}`; estado.mensajes.push({ ...m, id }); return id; }),
  registrarEvento: vi.fn(async (_db: unknown, e: any) => { estado.eventos.push(e); }),
  historial: vi.fn(async () => [{ rol: "cliente", contenido: "hola, ¿cuánto cuesta un chatbot?" }]),
  crearCaso: vi.fn(async (_db: unknown, c: any) => { estado.casos.push(c); return c; }),
  leerConfig: vi.fn(async () => null),
  ultimoMensajeCliente: vi.fn(async () => estado.mensajes.filter((m) => m.rol === "cliente").at(-1)?.id ?? null),
  textoPendiente: vi.fn(async () => {
    const p: string[] = [];
    for (const m of [...estado.mensajes].reverse()) { if (m.rol !== "cliente") break; p.unshift(m.contenido); }
    return p.join("\n");
  }),
  estadoConversacion: vi.fn(async () => estado.convEstado),
  asegurarCliente: vi.fn(async (_db: unknown, _conv: unknown, p: any) => { estado.clientes.push(p); return "cli1"; }),
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

describe("ráfaga de mensajes seguidos", () => {
  const msj = (texto: string, i: number) => ({ ...dm, texto, mensajeExtId: `r${i}` });

  it("tres mensajes seguidos → una sola respuesta que ve los tres", async () => {
    estado.mensajes = []; estado.casos = []; estado.convEstado = "bot";
    const create = vi.fn(async () => ({ stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "Con gusto, le cuento." }] }));
    const enviar = vi.fn(async () => {});
    const d = { ...deps(enviar, create), esperaMs: 40 };
    // llegan con 10 ms de diferencia, como un webhook por mensaje
    const p1 = procesarMensaje(d as any, msj("hola", 1), { modo: "abierto", prompt: null });
    await new Promise((r) => setTimeout(r, 10));
    const p2 = procesarMensaje(d as any, msj("quiero info", 2), { modo: "abierto", prompt: null });
    await new Promise((r) => setTimeout(r, 10));
    const p3 = procesarMensaje(d as any, msj("¿cuánto cuesta?", 3), { modo: "abierto", prompt: null });
    await Promise.all([p1, p2, p3]);
    expect(create).toHaveBeenCalledOnce();
    expect(enviar).toHaveBeenCalledOnce();
  });

  it("si apagan el agente durante la espera, no responde", async () => {
    estado.mensajes = []; estado.convEstado = "bot";
    const create = vi.fn();
    const enviar = vi.fn(async () => {});
    const p = procesarMensaje({ ...deps(enviar, create), esperaMs: 30 } as any, msj("hola", 9), { modo: "abierto", prompt: null });
    estado.convEstado = "humano";
    await p;
    expect(create).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
  });

  it("detecta 'quiero hablar con una persona' aunque venga en medio de la ráfaga", async () => {
    estado.mensajes = []; estado.casos = []; estado.convEstado = "bot";
    const create = vi.fn();
    const d = { ...deps(vi.fn(async () => {}), create), esperaMs: 30 };
    const a = procesarMensaje(d as any, msj("quiero hablar con una persona", 11), { modo: "abierto", prompt: null });
    await new Promise((r) => setTimeout(r, 5));
    const b = procesarMensaje(d as any, msj("es urgente", 12), { modo: "abierto", prompt: null });
    await Promise.all([a, b]);
    expect(create).not.toHaveBeenCalled();
    expect(estado.casos).toHaveLength(1);
    expect(estado.casos[0].motivo).toBe("pide_humano");
  });
});

describe("perfil de cliente", () => {
  it("un DM de Instagram crea/usa un cliente 'persona' con su nombre de perfil", async () => {
    estado.mensajes = []; estado.clientes = []; estado.convEstado = "bot";
    await procesarMensaje(deps(vi.fn(async () => {})) as any, { ...dm, mensajeExtId: "pc1" }, { modo: "abierto", prompt: null });
    expect(estado.clientes[0]).toEqual({ optica: null, nombre: "@cliente", telefono: null, plataforma: "instagram" });
  });
});
