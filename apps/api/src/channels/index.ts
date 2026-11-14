import type { Env } from "../env";
import type { ChannelAdapter } from "./types";
import { ZernioChannel } from "./zernio";
import { DevChannel } from "./dev";

export function getChannel(env: Env): ChannelAdapter {
  if (env.CHANNEL === "zernio") {
    if (!env.ZERNIO_API_KEY) throw new Error("CHANNEL=zernio pero falta ZERNIO_API_KEY");
    return new ZernioChannel(env.ZERNIO_API_KEY, env.ZERNIO_WEBHOOK_SECRET);
  }
  return new DevChannel();
}

export type { ChannelAdapter, InboundMessage } from "./types";
