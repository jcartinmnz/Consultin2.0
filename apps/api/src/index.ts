import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { AppBindings } from "./env";
import { requireKey } from "./middleware/auth";
import { webhooks } from "./routes/webhooks";
import { dev } from "./routes/dev";
import { crm } from "./routes/crm";
import { metrics } from "./routes/metrics";
import { tools } from "./routes/tools";

const app = new Hono<AppBindings>();

app.use("*", logger());
app.use("/crm/*", cors());
app.use("/metrics/*", cors());

app.get("/", (c) => c.json({
  servicio: "consultin-api",
  lab: c.env.LAB_NAME,
  fuentes: { precios: c.env.PRICES_SOURCE, ordenes: c.env.ORDERS_SOURCE, canal: c.env.CHANNEL },
}));

app.route("/webhooks", webhooks);

// /dev/chat acepta cualquier teléfono: sin clave permitiría suplantar ópticas.
app.use("/dev/*", cors());
app.use("/dev/*", requireKey((e) => e.ADMIN_API_KEY));
app.route("/dev", dev);

app.use("/crm/*", requireKey((e) => e.ADMIN_API_KEY));
app.use("/metrics/*", requireKey((e) => e.ADMIN_API_KEY));
app.use("/tools/*", requireKey((e) => e.TOOLS_API_KEY));
app.route("/crm", crm);
app.route("/metrics", metrics);
app.route("/tools", tools);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export default app;
