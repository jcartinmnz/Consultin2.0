import { useState } from "react";
import { api, type Caso, type EstadoCaso, type Mensaje, type Nota } from "../api";
import { useApi } from "../useApi";
import { Formato } from "../Formato";

interface FilaCaso { caso: Caso; optica: string | null; telefono: string }
interface Detalle { caso: Caso; mensajes: Mensaje[]; notas: Nota[] }

const ESTADOS: EstadoCaso[] = ["nuevo", "en_atencion", "en_espera", "resuelto"];
const LABEL: Record<EstadoCaso, string> = { nuevo: "Nuevo", en_atencion: "En atención", en_espera: "En espera", resuelto: "Resuelto" };

export function Casos() {
  const [filtro, setFiltro] = useState<EstadoCaso | "">("nuevo");
  const [sel, setSel] = useState<string | null>(null);
  const lista = useApi<FilaCaso[]>(`/crm/casos${filtro ? `?estado=${filtro}` : ""}`);

  return (
    <div className={`casos ${sel ? "con-detalle" : ""}`}>
      <div className="lista">
        <header className="top">
          <h2>Casos</h2>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as EstadoCaso | "")}>
            <option value="">Todos</option>
            {ESTADOS.map((e) => <option key={e} value={e}>{LABEL[e]}</option>)}
          </select>
        </header>
        {lista.error && <p className="error">{lista.error}</p>}
        {lista.data?.map(({ caso, optica, telefono }) => (
          <button key={caso.id} className={`item ${sel === caso.id ? "on" : ""}`} onClick={() => setSel(caso.id)}>
            <span className={`nivel ${caso.nivel}`}>{caso.nivel}</span>
            <strong>{optica ?? telefono}</strong>
            <small>{caso.motivo.replaceAll("_", " ")} · {new Date(caso.createdAt).toLocaleString("es-CR")}</small>
          </button>
        ))}
        {lista.data?.length === 0 && <p className="vacio">No hay casos en este estado.</p>}
      </div>
      <div className="detalle">
        {sel && <button className="volver" onClick={() => setSel(null)}>← Casos</button>}
        {sel ? <DetalleCaso id={sel} onCambio={lista.recargar} /> : <p className="vacio">Seleccione un caso.</p>}
      </div>
    </div>
  );
}

function DetalleCaso({ id, onCambio }: { id: string; onCambio: () => void }) {
  const { data, recargar } = useApi<Detalle>(`/crm/casos/${id}`);
  const [texto, setTexto] = useState("");
  const [modo, setModo] = useState<"responder" | "nota">("responder");
  const [error, setError] = useState<string | null>(null);
  const autor = localStorage.getItem("consultin_autor") ?? "Servicio al cliente";

  if (!data) return <p>Cargando…</p>;
  const { caso } = data;

  const cambiarEstado = async (estado: EstadoCaso) => {
    await api(`/crm/casos/${id}`, { method: "PATCH", body: JSON.stringify({ estado }) });
    await recargar(); onCambio();
  };
  const enviar = async () => {
    if (!texto.trim()) return;
    const path = modo === "responder" ? `/crm/casos/${id}/responder` : `/crm/casos/${id}/notas`;
    setError(null);
    try {
      await api(path, { method: "POST", body: JSON.stringify({ autor, texto }) });
    } catch (e) {
      // El texto se conserva para poder reintentar
      const m = String((e as Error).message);
      try { setError(JSON.parse(m.slice(m.indexOf(":") + 1)).error); } catch { setError(m); }
      return;
    }
    setTexto(""); await recargar(); onCambio();
  };

  return (
    <>
      <header className="top">
        <h2><span className={`nivel ${caso.nivel}`}>{caso.nivel}</span> {caso.motivo.replaceAll("_", " ")}</h2>
        <select value={caso.estado} onChange={(e) => cambiarEstado(e.target.value as EstadoCaso)}>
          {ESTADOS.map((e) => <option key={e} value={e}>{LABEL[e]}</option>)}
        </select>
      </header>
      <div className="resumen"><strong>Resumen de Consultin</strong><p><Formato texto={caso.resumen} /></p></div>

      <div className="chat">
        {data.mensajes.map((m) => (
          <div key={m.id} className={`msg ${m.rol}`}>
            <small>{m.rol === "agente" ? m.autor : m.rol === "bot" ? "Consultin" : "Óptica"} · {new Date(m.createdAt).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })}</small>
            <p><Formato texto={m.contenido} /></p>
          </div>
        ))}
        {data.notas.map((n) => (
          <div key={n.id} className="msg nota"><small>Nota interna · {n.autor}</small><p>{n.texto}</p></div>
        ))}
      </div>

      <div className="composer">
        <div className="tabs">
          <button className={modo === "responder" ? "on" : ""} onClick={() => setModo("responder")}>Responder por WhatsApp</button>
          <button className={modo === "nota" ? "on" : ""} onClick={() => setModo("nota")}>Nota interna</button>
        </div>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={modo === "responder" ? "Mensaje para la óptica…" : "Solo visible para el equipo…"} />
        {error && <p className="error">{error}</p>}
        <button className="primario" onClick={enviar}>{modo === "responder" ? "Enviar" : "Guardar nota"}</button>
      </div>
    </>
  );
}
