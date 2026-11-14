import type { Env } from "../env";
import type { ChannelAdapter } from "./types";
import { ZernioChannel } from "./zernio";
import { DevChannel } from "./dev";

export function getChannel(env: Env): ChannelAdapter {
  if (env.CHANNEL === "zernio") {
    if (!env.ZERNIO_API_KEY) throw new Error("CHANNEL=zernio pero falta ZERNIO_API_KEY");
    if (!env.ZERNIO_WEBHOOK_SECRET) throw new Error("CHANNEL=zernio pero falta ZERNIO_WEBHOOK_SECRET");
    return new ZernioChannel(env.ZERNIO_API_KEY, env.ZERNIO_WEBHOOK_SECRET);
  }
  return new DevChannel();
}

/**
 * Canal por el que se responde a una conversación ya existente (CRM → cliente).
 * Depende del canal por el que entró la conversación, no del CHANNEL configurado.
 * Devuelve null si ese canal no admite respuestas salientes (ej. "forja").
 */
export function canalDeConversacion(env: Env, canal: string): ChannelAdapter | null {
  switch (canal) {
    case "whatsapp": return env.CHANNEL === "zernio" ? getChannel(env) : null;
    case "dev": return new DevChannel();
    default: return null;
  }
}

export type { ChannelAdapter, InboundMessage } from "./types";
