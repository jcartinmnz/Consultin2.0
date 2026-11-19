import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Env } from "../src/env";
import { igualesSeguro, hmacHex } from "../src/lib/seguridad";
import { ZernioChannel } from "../src/channels/zernio";
import { canalDeConversacion, getChannel } from "../src/channels";
import { parseDias } from "../src/routes/metrics";

const env = (over: Partial<Env> = {}): Env => ({
  PRICES_SOURCE: "mock", ORDERS_SOURCE: "mock", CHANNEL: "dev", ANTHROPIC_MODEL: "test", LAB_NAME: "Lab",
  DATABASE_URL: "postgresql://u:p@localhost/db", ANTHROPIC_API_KEY: "x", ADMIN_API_KEY: "clave-admin",
  ...over,
});

const pedir = (path: string, e: Env, init: RequestInit = {}) =>
  app.request(path, init, e, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

describe("autenticación por clave", () => {
  it("/dev/chat exige ADMIN_API_KEY (no se puede suplantar una óptica sin clave)", async () => {
    const r = await pedir("/dev/chat", env(), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ telefono: "50688880001", texto: "cómo va la 48213?" }),
    });
    expect(r.status).toBe(401);
  });

  it("/crm rechaza clave incorrecta", async () => {
    const r = await pedir("/crm/casos", env(), { headers: { authorization: "Bearer otra" } });
    expect(r.status).toBe(401);
  });

  it("si no hay clave configurada el endpoint queda cerrado", async () => {
    const r = await pedir("/tools", env({ TOOLS_API_KEY: undefined }), { headers: { authorization: "Bearer " } });
    expect(r.status).toBe(401);
  });

  it("acepta la clave correcta", async () => {
    const r = await pedir("/tools", env({ TOOLS_API_KEY: "clave-tools" }), { headers: { authorization: "Bearer clave-tools" } });
    expect(r.status).toBe(200);
  });

  it("igualesSeguro compara bien, incluso con longitudes distintas", async () => {
    expect(await igualesSeguro("abc", "abc")).toBe(true);
    expect(await igualesSeguro("abc", "abd")).toBe(false);
    expect(await igualesSeguro("abc", "abcd")).toBe(false);
    expect(await igualesSeguro("", "abc")).toBe(false);
  });
});

describe("webhook de Zernio", () => {
  const body = JSON.stringify({
    id: "evt-1", event: "message.received",
    message: { id: "m1", conversationId: "c1", platform: "whatsapp", direction: "incoming", text: "hola",
      sender: { id: "50688880001", phoneNumber: "+50688880001" } },
    account: { id: "acc1", accountId: "acc1", platform: "whatsapp", username: "topex" },
    conversation: { id: "c1", platformConversationId: "p1", status: "active" },
  });
  const req = (firma?: string) => new Request("https://x/webhooks/zernio", {
    method: "POST", body, headers: firma ? { "x-zernio-signature": firma } : {},
  });

  it("no se puede crear sin secreto de webhook", () => {
    expect(() => new ZernioChannel("k", "")).toThrow();
    expect(() => getChannel(env({ CHANNEL: "zernio", ZERNIO_API_KEY: "k" }))).toThrow(/ZERNIO_WEBHOOK_SECRET/);
  });

  it("rechaza mensajes sin firma o con firma inválida", async () => {
    const ch = new ZernioChannel("k", "secreto");
    await expect(ch.parseWebhook(req())).rejects.toThrow(/Firma/);
    await expect(ch.parseWebhook(req("sha256=" + "0".repeat(64)))).rejects.toThrow(/Firma/);
  });

  it("acepta mensajes con firma válida", async () => {
    const ch = new ZernioChannel("k", "secreto");
    const [m] = await ch.parseWebhook(req("sha256=" + (await hmacHex("secreto", body))));
    expect(m!.telefono).toBe("50688880001");
  });

  it("el endpoint responde 401 ante firma inválida", async () => {
    const r = await pedir("/webhooks/zernio", env({ CHANNEL: "zernio", ZERNIO_API_KEY: "k", ZERNIO_WEBHOOK_SECRET: "secreto" }),
      { method: "POST", body, headers: { "x-zernio-signature": "malo" } });
    expect(r.status).toBe(401);
  });
});

describe("canal para responder desde el CRM", () => {
  it("usa el canal por el que entró la conversación", () => {
    const z = env({ CHANNEL: "zernio", ZERNIO_API_KEY: "k", ZERNIO_WEBHOOK_SECRET: "s" });
    expect(canalDeConversacion(z, "whatsapp")?.nombre).toBe("zernio");
    expect(canalDeConversacion(z, "dev")?.nombre).toBe("dev");
    expect(canalDeConversacion(z, "forja")).toBeNull();
    // Conversación de WhatsApp pero el worker no está en modo zernio: no hay cómo enviar
    expect(canalDeConversacion(env(), "whatsapp")).toBeNull();
  });
});

describe("parseDias", () => {
  it("normaliza valores inválidos", () => {
    expect(parseDias(undefined)).toBe(30);
    expect(parseDias("abc")).toBe(30);
    expect(parseDias("0")).toBe(30);
    expect(parseDias("-5")).toBe(30);
    expect(parseDias("7.9")).toBe(7);
    expect(parseDias("9999")).toBe(365);
  });
});
