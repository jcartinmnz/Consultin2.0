import { Hono } from "hono";
import type { AppBindings } from "../env";
import { getDb } from "../db/client";
import { getSources } from "../sources";
import { ejecutarTool, TOOLS } from "../agent/tools";
import * as repo from "../services/repo";

/**
 * Herramientas expuestas por HTTP para que Forja (u otro orquestador) las llame
 * como "custom tools / webhooks". Mismas reglas de seguridad que el agente interno:
 * la óptica se identifica por el teléfono, nunca por lo que diga el modelo.
 *
 *   GET  /tools            → definiciones (JSON Schema) para registrar en Forja
 *   POST /tools/:name      → body: { telefono, input }
 */
export const tools = new Hono<AppBindings>();

tools.get("/", (c) => c.json(TOOLS));

tools.post("/:name", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const { telefono, input, conversacionExtId } = await c.req.json<{ telefono: string; input: unknown; conversacionExtId?: string }>();
  const ident = await repo.identificar(db, String(telefono).replace(/\D/g, ""));
  if (!ident) return c.json({ ok: false, data: { error: "Número no registrado como óptica cliente" } }, 403);

  const t0 = Date.now();
  const r = await ejecutarTool(c.req.param("name"), input, {
    ...getSources(c.env, db),
    optica: ident.optica,
    escalar: async (e) => {
      const conv = await repo.upsertConversacion(db, {
        canal: "forja", externalId: conversacionExtId ?? `forja-${ident.contacto.telefono}`,
        telefono: ident.contacto.telefono, opticaId: ident.optica.id,
      });
      await repo.crearCaso(db, { conversacionId: conv.id, opticaId: ident.optica.id, ...e });
    },
  });
  await repo.registrarEvento(db, { tipo: "tool_call", tool: c.req.param("name"), ok: r.ok, latenciaMs: Date.now() - t0, metadata: { input, via: "http" } });
  return c.json(r);
});
