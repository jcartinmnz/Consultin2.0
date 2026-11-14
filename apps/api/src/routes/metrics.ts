import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { AppBindings } from "../env";
import { getDb } from "../db/client";

export const metrics = new Hono<AppBindings>();

/** Entero entre 1 y 365; cualquier valor inválido cae en 30. */
export function parseDias(v: string | undefined): number {
  const n = Math.trunc(Number(v ?? 30));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 365) : 30;
}

/**
 * GET /metrics/resumen?dias=30
 * Todo sale de las tablas conversaciones / casos / eventos.
 */
metrics.get("/resumen", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const dias = parseDias(c.req.query("dias"));
  const desde = sql`now() - (${dias} || ' days')::interval`;

  const [totales] = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM conversaciones WHERE created_at >= ${desde})::int AS conversaciones,
      (SELECT count(*) FROM eventos WHERE tipo = 'mensaje_entrante' AND created_at >= ${desde})::int AS mensajes_entrantes,
      (SELECT count(*) FROM casos WHERE created_at >= ${desde})::int AS escalamientos,
      (SELECT round(avg(latencia_ms))::int FROM eventos WHERE tipo = 'respuesta' AND created_at >= ${desde}) AS latencia_promedio_ms,
      (SELECT count(*) FROM conversaciones cv WHERE cv.created_at >= ${desde}
         AND NOT EXISTS (SELECT 1 FROM casos cs WHERE cs.conversacion_id = cv.id))::int AS resueltas_por_bot
  `)).rows as any[];

  const porDia = (await db.execute(sql`
    SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'America/Costa_Rica'), 'YYYY-MM-DD') AS dia,
           count(*) FILTER (WHERE tipo = 'mensaje_entrante')::int AS mensajes,
           count(*) FILTER (WHERE tipo = 'tool_call' AND tool = 'buscar_precio')::int AS precios,
           count(*) FILTER (WHERE tipo = 'tool_call' AND tool = 'estado_orden')::int AS ordenes,
           count(*) FILTER (WHERE tipo = 'escalamiento')::int AS escalamientos
    FROM eventos WHERE created_at >= ${desde}
    GROUP BY 1 ORDER BY 1
  `)).rows;

  const motivos = (await db.execute(sql`
    SELECT motivo, nivel, count(*)::int AS total FROM casos WHERE created_at >= ${desde}
    GROUP BY motivo, nivel ORDER BY total DESC
  `)).rows;

  const consultasPrecio = (await db.execute(sql`
    SELECT lower(metadata->'input'->>'consulta') AS consulta, count(*)::int AS total
    FROM eventos WHERE tipo = 'tool_call' AND tool = 'buscar_precio' AND created_at >= ${desde}
    GROUP BY 1 ORDER BY total DESC LIMIT 10
  `)).rows;

  const opticasActivas = (await db.execute(sql`
    SELECT o.nombre, count(DISTINCT cv.id)::int AS conversaciones
    FROM conversaciones cv JOIN opticas o ON o.id = cv.optica_id
    WHERE cv.created_at >= ${desde} GROUP BY o.nombre ORDER BY conversaciones DESC LIMIT 10
  `)).rows;

  const t = totales ?? {};
  return c.json({
    dias,
    totales: {
      ...t,
      tasa_resolucion_automatica: t.conversaciones ? Number((t.resueltas_por_bot / t.conversaciones).toFixed(3)) : null,
    },
    porDia, motivos, consultasPrecio, opticasActivas,
  });
});
