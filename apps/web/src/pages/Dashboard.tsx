import { useState } from "react";
import { useApi } from "../useApi";

interface Resumen {
  totales: {
    conversaciones: number; mensajes_entrantes: number; escalamientos: number;
    latencia_promedio_ms: number | null; tasa_resolucion_automatica: number | null;
  };
  porDia: { dia: string; mensajes: number; precios: number; ordenes: number; escalamientos: number }[];
  motivos: { motivo: string; nivel: string; total: number }[];
  consultasPrecio: { consulta: string; total: number }[];
  opticasActivas: { nombre: string; conversaciones: number }[];
}

const MOTIVOS: Record<string, string> = {
  pide_humano: "Pidió una persona", producto_fuera_de_lista: "Producto fuera de lista",
  orden_atrasada: "Orden atrasada", orden_con_alerta: "Orden con alerta", reclamo: "Reclamo",
  garantia: "Garantía", reproceso: "Reproceso", facturacion: "Facturación",
  no_entendido: "No se entendió", numero_no_registrado: "Número no registrado", otro: "Otro",
};

export function Dashboard() {
  const [dias, setDias] = useState(30);
  const { data, error } = useApi<Resumen>(`/metrics/resumen?dias=${dias}`);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Cargando…</p>;
  const t = data.totales;
  const max = Math.max(1, ...data.porDia.map((d) => d.mensajes));

  return (
    <>
      <header className="top">
        <h2>Dashboard</h2>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
          <option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option>
        </select>
      </header>

      <div className="kpis">
        <Kpi label="Resolución automática" valor={t.tasa_resolucion_automatica === null ? "—" : `${Math.round(t.tasa_resolucion_automatica * 100)}%`} destacado />
        <Kpi label="Conversaciones" valor={t.conversaciones} />
        <Kpi label="Mensajes recibidos" valor={t.mensajes_entrantes} />
        <Kpi label="Escalamientos" valor={t.escalamientos} />
        <Kpi label="Tiempo de respuesta" valor={t.latencia_promedio_ms ? `${(t.latencia_promedio_ms / 1000).toFixed(1)} s` : "—"} />
      </div>

      <section className="panel">
        <h3>Mensajes por día</h3>
        <div className="barras">
          {data.porDia.map((d) => (
            <div key={d.dia} className="barra" title={`${d.dia}: ${d.mensajes} mensajes · ${d.precios} precios · ${d.ordenes} órdenes`}>
              <div style={{ height: `${(d.mensajes / max) * 100}%` }} />
              <span>{d.dia.slice(8)}</span>
            </div>
          ))}
          {!data.porDia.length && <p className="vacio">Sin datos en el periodo.</p>}
        </div>
      </section>

      <div className="grid2">
        <Tabla titulo="Motivos de escalamiento" filas={data.motivos.map((m) => [`${MOTIVOS[m.motivo] ?? m.motivo} · ${m.nivel}`, m.total])} />
        <Tabla titulo="Ópticas más activas" filas={data.opticasActivas.map((o) => [o.nombre, o.conversaciones])} />
        <Tabla titulo="Consultas de precio frecuentes" filas={data.consultasPrecio.map((c) => [c.consulta, c.total])} />
      </div>
    </>
  );
}

function Kpi({ label, valor, destacado }: { label: string; valor: string | number; destacado?: boolean }) {
  return <div className={`kpi ${destacado ? "dest" : ""}`}><div className="v">{valor}</div><div className="l">{label}</div></div>;
}

function Tabla({ titulo, filas }: { titulo: string; filas: [string, number][] }) {
  return (
    <section className="panel">
      <h3>{titulo}</h3>
      {filas.length ? (
        <table><tbody>{filas.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>)}</tbody></table>
      ) : <p className="vacio">Sin datos.</p>}
    </section>
  );
}
