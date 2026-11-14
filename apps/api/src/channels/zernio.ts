import type { ChannelAdapter, InboundMessage } from "./types";
import { hmacHex, igualesSeguro } from "../lib/seguridad";

/**
 * Adaptador de Zernio (WhatsApp Cloud API de Meta).
 * Docs: https://docs.zernio.com/platforms/whatsapp  ·  SDK: @zernio/node
 *
 * ⚠️ VERIFICAR CONTRA LA DOCUMENTACIÓN DE ZERNIO antes de producción
 * (secciones "Inbox" y "Webhooks"). Los tres puntos marcados con TODO dependen
 * del formato exacto de su API, que hay que confirmar en el dashboard de Zernio:
 *   1. Nombre del header de firma y algoritmo.
 *   2. Nombre del evento de mensaje entrante y forma del payload.
 *   3. Endpoint para responder dentro de una conversación existente.
 * Todo lo demás del sistema no depende de este archivo.
 */
const BASE_URL = "https://zernio.com/api/v1";
const SIGNATURE_HEADER = "x-zernio-signature"; // TODO(1)
const INBOUND_EVENTS = new Set(["message.received", "inbox.message.received"]); // TODO(2)

export class ZernioChannel implements ChannelAdapter {
  readonly nombre = "zernio";
  constructor(private apiKey: string, private webhookSecret: string) {
    // La identidad de la óptica sale del teléfono del payload: sin firma, cualquiera podría suplantarla.
    if (!webhookSecret) throw new Error("ZernioChannel requiere ZERNIO_WEBHOOK_SECRET");
  }

  async parseWebhook(req: Request): Promise<InboundMessage[]> {
    const raw = await req.text();
    const ok = await verificarHmac(raw, req.headers.get(SIGNATURE_HEADER), this.webhookSecret);
    if (!ok) throw new Error("Firma de webhook inválida");

    const body = JSON.parse(raw) as Record<string, any>;
    if (!INBOUND_EVENTS.has(body.event ?? body.type)) return [];

    // TODO(2): ajustar rutas del payload al formato real de Zernio.
    const d = body.data ?? body;
    const texto: string | undefined = d.message?.text ?? d.text ?? d.message;
    if (!texto || typeof texto !== "string") return []; // audios/imágenes: fuera de alcance v1

    return [{
      canal: "whatsapp",
      conversacionExtId: String(d.conversationId ?? d.conversation?.id),
      telefono: String(d.from ?? d.contact?.phone ?? "").replace(/\D/g, ""),
      nombrePerfil: d.contact?.name ?? d.profileName ?? null,
      texto,
      mensajeExtId: String(d.messageId ?? d.id),
    }];
  }

  async enviar(conversacionExtId: string, texto: string) {
    // TODO(3): confirmar endpoint de respuesta en "Inbox API reference".
    const res = await fetch(`${BASE_URL}/inbox/conversations/${conversacionExtId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: texto }),
    });
    if (!res.ok) throw new Error(`Zernio ${res.status}: ${await res.text()}`);
  }
}

export async function verificarHmac(body: string, firma: string | null, secret: string) {
  if (!firma) return false;
  const esperado = await hmacHex(secret, body);
  return igualesSeguro(esperado, firma.trim().replace(/^sha256=/, "").toLowerCase());
}
