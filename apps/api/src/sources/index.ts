import type { Env } from "../env";
import type { Db } from "../db/client";
import type { OrderSource, PriceSource } from "./types";
import { MockPriceSource } from "./prices/mock";
import { NeonPriceSource } from "./prices/neon";
import { MockOrderSource } from "./orders/mock";
import { LensWareOrderSource } from "./orders/lensware";

/** Único lugar donde se decide qué fuente real o mock se usa. */
export function getSources(env: Env, db: Db): { prices: PriceSource; orders: OrderSource } {
  const prices = env.PRICES_SOURCE === "neon" ? new NeonPriceSource(db) : new MockPriceSource();

  let orders: OrderSource;
  if (env.ORDERS_SOURCE === "lensware") {
    if (!env.LENSWARE_DB) throw new Error("ORDERS_SOURCE=lensware pero falta el binding LENSWARE_DB (Hyperdrive)");
    orders = new LensWareOrderSource(env.LENSWARE_DB);
  } else {
    orders = new MockOrderSource();
  }
  return { prices, orders };
}

export type { OrderSource, PriceSource } from "./types";
