import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../env";

/** Bearer token simple para CRM/dashboard. Cambiar por Cloudflare Access cuando haya usuarios del lab. */
export const requireKey = (pick: (env: AppBindings["Bindings"]) => string | undefined): MiddlewareHandler<AppBindings> =>
  async (c, next) => {
    const esperado = pick(c.env);
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!esperado || token !== esperado) return c.json({ error: "No autorizado" }, 401);
    await next();
  };
