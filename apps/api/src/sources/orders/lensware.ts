import { createConnection, type RowDataPacket } from "mysql2/promise";
import type { EstadoOrden, OrderSource } from "../types";
import { traducirEstado } from "./estados";

/**
 * Lee órdenes del MySQL de LensWare (on-prem en Topex) vía Cloudflare Tunnel + Hyperdrive.
 *
 * ⚠️ PENDIENTE (Fase 0): el esquema de LensWare no es público. Pedir al lab una VISTA
 * de solo lectura con exactamente estas columnas y este nombre. Así este archivo no cambia
 * aunque LensWare actualice sus tablas internas:
 *
 *   CREATE VIEW v_consultin_ordenes AS
 *   SELECT  <col_orden>       AS numero_orden,
 *           <col_cliente>     AS codigo_cliente,
 *           <col_estado>      AS estado_codigo,
 *           <col_estacion>    AS estacion,
 *           <col_fecha_in>    AS fecha_ingreso,
 *           <col_fecha_est>   AS fecha_estimada,
 *           <col_ref_optica>  AS referencia
 *   FROM    <tablas de LensWare> ...;
 *   -- SIN receta, SIN nombre de paciente.
 *
 *   GRANT SELECT ON lensware.v_consultin_ordenes TO 'consultin_ro'@'%';
 */
const VISTA = "v_consultin_ordenes";

export class LensWareOrderSource implements OrderSource {
  readonly nombre = "lensware";
  constructor(private hyperdrive: Hyperdrive) {}

  private async conn() {
    return createConnection({
      host: this.hyperdrive.host,
      user: this.hyperdrive.user,
      password: this.hyperdrive.password,
      database: this.hyperdrive.database,
      port: this.hyperdrive.port,
      disableEval: true, // requerido en Workers
    });
  }

  private map(r: RowDataPacket): EstadoOrden {
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
    return {
      numeroOrden: String(r.numero_orden),
      codigoCliente: String(r.codigo_cliente),
      estadoCodigo: String(r.estado_codigo),
      estado: traducirEstado(String(r.estado_codigo)).label,
      estacion: r.estacion ?? null,
      fechaIngreso: iso(r.fecha_ingreso),
      fechaEstimada: iso(r.fecha_estimada),
      referencia: r.referencia ?? null,
    };
  }

  async obtener(numeroOrden: string) {
    const c = await this.conn();
    try {
      const [rows] = await c.query<RowDataPacket[]>(
        `SELECT * FROM ${VISTA} WHERE numero_orden = ? LIMIT 1`, [numeroOrden.trim()]);
      return rows[0] ? this.map(rows[0]) : null;
    } finally {
      await c.end();
    }
  }

  async recientes(codigoCliente: string, limite = 5) {
    const c = await this.conn();
    try {
      const [rows] = await c.query<RowDataPacket[]>(
        `SELECT * FROM ${VISTA} WHERE codigo_cliente = ? ORDER BY fecha_ingreso DESC LIMIT ?`,
        [codigoCliente, limite]);
      return rows.map((r) => this.map(r));
    } finally {
      await c.end();
    }
  }
}
