import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";
import { getDb } from "./db/client";
import { getSources } from "./sources";
import { getChannel } from "./channels";
import type { ChannelAdapter } from "./channels/types";
import type { Deps } from "./services/procesar";

export function buildDeps(env: Env, channel?: ChannelAdapter): Deps {
  const db = getDb(env.DATABASE_URL);
  return {
    env,
    db,
    channel: channel ?? getChannel(env),
    llm: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
    sources: getSources(env, db),
  };
}
