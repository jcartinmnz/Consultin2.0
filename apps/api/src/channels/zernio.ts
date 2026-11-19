import type { ChannelAdapter, InboundMessage } from "./types";
import { hmacHex, igualesSeguro } from "../lib/seguridad";

/**
 * Adaptador de Zernio (WhatsApp Cloud API de Meta).
 * Referencia: https://docs.zernio.com/webhooks.mdx · https://zernio.com/openapi.yaml
 *
 * - Webhook: Zernio hace POST con el evento `message.received`, firmado con
 *   `X-Zernio-Signature` = HMAC-SHA256 del cuerpo crudo, en hex minúscula.
 * - Respuesta: POST /v1/inbox/conversations/{conversationId}/messages con { accountId, message }.
 *   Como Zernio exige el accountId para responder, el id externo de la conversación
 *   se guarda como "<accountId>:<conversationId>".
 */
const BASE_URL = "https://zernio.com/api/v1";
const SIGNATURE_HEADER = "x-zernio-signature";
const SEP = ":";

export class ZernioChannel implements ChannelAdapter {
  readonly nombre = "zernio";

  /**
   * @param cuentas ids de cuentas de Zernio aceptadas (ZERNIO_ACCOUNT_IDS). Vacío = cualquier
   *                cuenta de WhatsApp. Evita que otra cuenta conectada al mismo Zernio
   *                (p. ej. otro número) termine hablando con el agente.
   */
  constructor(private apiKey: string, private webhookSecret: string, private cuentas: string[] = []) {
    // La identidad de la óptica sale del teléfono del payload: sin firma, cualquiera podría suplantarla.
    if (!webhookSecret) throw new Error("ZernioChannel requiere ZERNIO_WEBHOOK_SECRET");
  }

  async parseWebhook(req: Request): Promise<InboundMessage[]> {
    const raw = await req.text();
    const ok = await verificarHmac(raw, req.headers.get(SIGNATURE_HEADER), this.webhookSecret);
    if (!ok) throw new Error("Firma de webhook inválida");
    return interpretarEvento(JSON.parse(raw), this.cuentas);
  }

  async enviar(conversacionExtId: string, texto: string) {
    const { accountId, conversationId } = separarConversacionId(conversacionExtId);
    const res = await fetch(`${BASE_URL}/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, message: texto }),
    });
    if (!res.ok) throw new Error(`Zernio ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
}

/** Convierte un evento de Zernio en mensajes para el agente. [] = ignorar (no es texto entrante de WhatsApp). */
export function interpretarEvento(body: any, cuentas: string[] = []): InboundMessage[] {
  if (body?.event !== "message.received" || body.test) return [];
  const m = body.message;
  const accountId: string | undefined = body.account?.accountId ?? body.account?.id;
  if (!m || m.platform !== "whatsapp" || m.direction !== "incoming" || !accountId) return [];
  if (cuentas.length && !cuentas.includes(accountId)) return [];

  const texto = typeof m.text === "string" ? m.text.trim() : "";
  if (!texto) return []; // audios, imágenes y stickers: fuera de alcance v1

  // phoneNumber viene en E.164 con "+"; sender.id es el número sin "+" (o un BSUID si el usuario lo oculta)
  const telefono = String(m.sender?.phoneNumber ?? (/^\d+$/.test(m.sender?.id ?? "") ? m.sender.id : "")).replace(/\D/g, "");

  return [{
    canal: "whatsapp",
    conversacionExtId: unirConversacionId(accountId, m.conversationId),
    telefono,
    nombrePerfil: m.sender?.name ?? body.conversation?.participantName ?? null,
    texto,
    mensajeExtId: String(m.id ?? m.platformMessageId ?? body.id),
  }];
}

export const unirConversacionId = (accountId: string, conversationId: string) => `${accountId}${SEP}${conversationId}`;

export function separarConversacionId(ext: string) {
  const i = ext.indexOf(SEP);
  if (i <= 0) throw new Error(`Id de conversación de Zernio inválido: ${ext}`);
  return { accountId: ext.slice(0, i), conversationId: ext.slice(i + 1) };
}

export async function verificarHmac(body: string, firma: string | null, secret: string) {
  if (!firma) return false;
  const esperado = await hmacHex(secret, body);
  return igualesSeguro(esperado, firma.trim().replace(/^sha256=/, "").toLowerCase());
}
