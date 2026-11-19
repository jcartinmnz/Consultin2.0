import type { Env } from "../env";
import type { ChannelAdapter } from "./types";
import { PLATAFORMAS, ZernioChannel } from "./zernio";
import { DevChannel } from "./dev";

export function getChannel(env: Env): ChannelAdapter {
  if (env.CHANNEL === "zernio") return zernio(env);
  return new DevChannel();
}

function zernio(env: Env) {
  if (!env.ZERNIO_API_KEY) throw new Error("Falta ZERNIO_API_KEY");
  if (!env.ZERNIO_WEBHOOK_SECRET) throw new Error("Falta ZERNIO_WEBHOOK_SECRET");
  return new ZernioChannel(env.ZERNIO_API_KEY, env.ZERNIO_WEBHOOK_SECRET);
}

/**
 * Canal por el que se responde a una conversación ya existente (panel → cliente).
 * Depende del canal por el que entró la conversación, no del CHANNEL configurado.
 * Devuelve null si ese canal no admite respuestas salientes (ej. "forja").
 */
export function canalDeConversacion(env: Env, canal: string): ChannelAdapter | null {
  if (PLATAFORMAS.has(canal)) return env.ZERNIO_API_KEY && env.ZERNIO_WEBHOOK_SECRET ? zernio(env) : null;
  if (canal === "dev") return new DevChannel();
  return null;
}

export type { ChannelAdapter, InboundMessage } from "./types";
