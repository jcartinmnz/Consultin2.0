import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import type { Env } from "../src/env";
import { interpretarEvento, separarConversacionId, ZernioChannel } from "../src/channels/zernio";

/** Forma real de `message.received` según https://zernio.com/openapi.yaml (WebhookPayloadMessage). */
const evento = (over: Record<string, any> = {}, msg: Record<string, any> = {}) => ({
  id: "6f1c2b9e-evt", event: "message.received",
  message: {
    id: "msg_1", conversationId: "conv_1", platform: "whatsapp", platformMessageId: "wamid.X",
    direction: "incoming", text: "¿Cómo va la orden 48213?", attachments: [],
    sender: { id: "50688880001", name: "María", phoneNumber: "+50688880001" },
    sentAt: "2026-11-19T15:00:00Z", isRead: false, ...msg,
  },
  conversation: { id: "conv_1", platformConversationId: "p_1", participantName: "María Óptica", status: "active" },
  account: { id: "acc_wa", accountId: "acc_wa", platform: "whatsapp", username: "topex" },
  ...over,
});

describe("interpretarEvento (Zernio → mensaje del agente)", () => {
  it("convierte un mensaje entrante de WhatsApp", () => {
    const [m] = interpretarEvento(evento());
    expect(m).toEqual({
      canal: "whatsapp", conversacionExtId: "acc_wa:conv_1", telefono: "50688880001", cuentaId: "acc_wa",
      nombrePerfil: "María", texto: "¿Cómo va la orden 48213?", mensajeExtId: "msg_1",
    });
  });

  it("ignora otros eventos, pruebas, mensajes salientes y plataformas no soportadas", () => {
    expect(interpretarEvento(evento({ event: "message.sent" }))).toEqual([]);
    expect(interpretarEvento(evento({ test: true }))).toEqual([]);
    expect(interpretarEvento(evento({}, { direction: "outgoing" }))).toEqual([]);
    expect(interpretarEvento(evento({}, { platform: "tiktok" }))).toEqual([]);
    expect(interpretarEvento({ event: "webhook.test" })).toEqual([]);
  });

  it("ignora mensajes sin texto (audio, imagen)", () => {
    expect(interpretarEvento(evento({}, { text: null, attachments: [{ type: "audio", url: "x" }] }))).toEqual([]);
  });

  it("acepta DMs de Instagram: sin teléfono (la identidad nunca sale del texto ni del nombre)", () => {
    const [m] = interpretarEvento(evento({ account: { id: "acc_ig", accountId: "acc_ig", platform: "instagram", username: "expertiacr" } },
      { platform: "instagram", sender: { id: "17841400000000000", username: "optica_falsa", name: "Óptica Demo Central", phoneNumber: "+50688880001" } }));
    expect(m).toMatchObject({ canal: "instagram", conversacionExtId: "acc_ig:conv_1", telefono: "", cuentaId: "acc_ig", nombrePerfil: "Óptica Demo Central" });
  });

  it("usa sender.id si no viene phoneNumber, y deja vacío un BSUID (no es teléfono)", () => {
    expect(interpretarEvento(evento({}, { sender: { id: "50688880002" } }))[0]!.telefono).toBe("50688880002");
    expect(interpretarEvento(evento({}, { sender: { id: "CR.bsuid.abc" } }))[0]!.telefono).toBe("");
  });
});

describe("ZernioChannel.enviar", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("responde en la conversación con { accountId, message }", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await new ZernioChannel("sk_test", "secreto").enviar("acc_wa:conv_1", "Su orden *48213* está en tallado.");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://zernio.com/api/v1/inbox/conversations/conv_1/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test");
    expect(JSON.parse(init.body as string)).toEqual({ accountId: "acc_wa", message: "Su orden *48213* está en tallado." });
  });

  it("lanza error si Zernio responde con error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ventana de 24 h cerrada", { status: 400 })));
    await expect(new ZernioChannel("k", "s").enviar("a:c", "hola")).rejects.toThrow(/Zernio 400/);
  });

  it("rechaza ids de conversación sin accountId", () => {
    expect(() => separarConversacionId("conv_1")).toThrow();
  });
});

describe("webhook /webhooks/zernio", () => {
  const env = (over: Partial<Env> = {}): Env => ({
    PRICES_SOURCE: "mock", ORDERS_SOURCE: "mock", CHANNEL: "dev", ANTHROPIC_MODEL: "x", LAB_NAME: "Lab",
    DATABASE_URL: "postgresql://u:p@localhost/db", ANTHROPIC_API_KEY: "x", ADMIN_API_KEY: "k", ...over,
  });
  const ctx = { waitUntil() {}, passThroughOnException() {} } as any;

  it("está apagado si CHANNEL no es zernio (no acepta mensajes sin firma vía el canal dev)", async () => {
    const r = await app.request("/webhooks/zernio", {
      method: "POST", body: JSON.stringify({ telefono: "50688880001", texto: "hola" }),
    }, env(), ctx);
    expect(r.status).toBe(404);
  });
});
