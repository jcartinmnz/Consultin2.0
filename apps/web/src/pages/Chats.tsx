import { useEffect, useRef, useState } from "react";
import { api, nombreChat, PLATAFORMAS, type DetalleChat, type FilaChat } from "../api";
import { useApi } from "../useApi";
import { Formato } from "../Formato";

/** Bandeja de conversaciones reales (WhatsApp, Instagram…): lo que entra y lo que responde el agente. */
export function Chats({ inicial, onAbrirCliente }: { inicial?: string | null; onAbrirCliente: (clienteId: string) => void }) {
  const [sel, setSel] = useState<string | null>(inicial ?? null);
  const [filtro, setFiltro] = useState<"" | "bot" | "humano">("");
  const lista = useApi<FilaChat[]>("/crm/conversaciones");
  usePolling(lista.recargar, 5000);
  const filas = lista.data?.filter((c) => !filtro || c.estado === filtro);

  return (
    <div className={`casos ${sel ? "con-detalle" : ""}`}>
      <div className="lista">
        <header className="top">
          <h2>Chats</h2>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
            <option value="">Todos</option>
            <option value="bot">Agente activo</option>
            <option value="humano">Agente apagado</option>
          </select>
        </header>
        {lista.error && <p className="error">{lista.error}</p>}
        {filas?.map((c) => (
          <button key={c.id} className={`item chat-item ${sel === c.id ? "on" : ""}`} onClick={() => setSel(c.id)}>
            <span className={`plat ${c.plataforma ?? c.canal}`}>{(PLATAFORMAS[c.plataforma ?? c.canal] ?? c.canal).slice(0, 2)}</span>
            <strong>{nombreChat(c)}</strong>
            <small className="preview">{c.ultimoRol === "cliente" ? "" : c.ultimoRol === "bot" ? "Consultin: " : "Equipo: "}{c.ultimo ?? "—"}</small>
            <small className="meta">
              <span className={`punto ${c.estado}`} />{c.estado === "bot" ? "Agente activo" : "Agente apagado"}
              {c.casoAbierto && <span className="tag mini-tag">Caso abierto</span>}
              <span className="hora">{hora(c.lastMessageAt)}</span>
            </small>
          </button>
        ))}
        {filas?.length === 0 && <p className="vacio">Todavía no hay conversaciones. Los mensajes que lleguen a las cuentas conectadas aparecen aquí.</p>}
      </div>
      <div className="detalle">
        {sel && <button className="volver" onClick={() => setSel(null)}>← Chats</button>}
        {sel ? <Conversacion id={sel} onCambio={lista.recargar} onAbrirCliente={onAbrirCliente} /> : <p className="vacio">Seleccione una conversación.</p>}
      </div>
    </div>
  );
}

function Conversacion({ id, onCambio, onAbrirCliente }: { id: string; onCambio: () => void; onAbrirCliente: (clienteId: string) => void }) {
  const { data, recargar } = useApi<DetalleChat>(`/crm/conversaciones/${id}`);
  usePolling(recargar, 4000);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  const cantidad = data?.mensajes.length ?? 0;
  useEffect(() => { fin.current?.scrollIntoView({ block: "end" }); }, [cantidad, id]);

  if (!data) return <p>Cargando…</p>;
  const { conversacion: cv } = data;
  const activo = cv.estado === "bot";
  const autor = localStorage.getItem("consultin_autor") ?? "Equipo Expertia";

  const alternar = async () => {
    setOcupado(true); setError(null);
    try { await api(`/crm/conversaciones/${id}`, { method: "PATCH", body: JSON.stringify({ agenteActivo: !activo }) }); await recargar(); onCambio(); }
    catch (e) { setError(mensajeError(e)); }
    finally { setOcupado(false); }
  };
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!texto.trim() || ocupado) return;
    setOcupado(true); setError(null);
    try { await api(`/crm/conversaciones/${id}/mensajes`, { method: "POST", body: JSON.stringify({ autor, texto }) }); setTexto(""); await recargar(); onCambio(); }
    catch (e) { setError(mensajeError(e)); }
    finally { setOcupado(false); }
  };

  return (
    <>
      <header className="top chat-top">
        <div>
          <h2>{nombreChat({ optica: data.optica?.nombre, participanteNombre: cv.participanteNombre, telefono: cv.telefono })}</h2>
          <small className="vacio">{PLATAFORMAS[cv.plataforma ?? cv.canal] ?? cv.canal}{data.optica ? " · óptica identificada" : ""}
            {cv.clienteId && <> · <button className="enlace" onClick={() => onAbrirCliente(cv.clienteId!)}>Ver perfil del cliente</button></>}</small>
        </div>
        <label className={`switch ${activo ? "on" : ""}`} title="Encender o apagar el agente en esta conversación">
          <input type="checkbox" checked={activo} onChange={alternar} disabled={ocupado} />
          <span className="riel"><span className="bola" /></span>
          <span>{activo ? "Agente activo" : "Agente apagado"}</span>
        </label>
      </header>
      {data.caso && <div className="resumen"><strong>Caso abierto · {data.caso.nivel} · {data.caso.motivo.replaceAll("_", " ")}</strong><p><Formato texto={data.caso.resumen} /></p></div>}

      <div className="chat">
        {data.mensajes.map((m) => (
          <div key={m.id} className={`msg ${m.rol}`}>
            <small>{m.rol === "agente" ? m.autor ?? "Equipo" : m.rol === "bot" ? "Consultin" : nombreChat({ optica: data.optica?.nombre, participanteNombre: cv.participanteNombre, telefono: cv.telefono })} · {hora(m.createdAt)}</small>
            <p><Formato texto={m.contenido} /></p>
          </div>
        ))}
        <div ref={fin} />
      </div>

      <form className="composer" onSubmit={enviar}>
        {!activo && <p className="vacio aviso-humano">El agente está apagado: solo responde el equipo desde aquí.</p>}
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={`Escribir como ${autor}…`} />
        {error && <p className="error">{error}</p>}
        <button className="primario" disabled={ocupado || !texto.trim()}>Enviar</button>
      </form>
    </>
  );
}

function usePolling(fn: () => unknown, ms: number) {
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") void fn(); }, ms);
    return () => clearInterval(t);
  }, [fn, ms]);
}

const hora = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-CR", { day: "numeric", month: "short" });
};

export function mensajeError(e: unknown) {
  const m = String((e as Error).message);
  try { return JSON.parse(m.slice(m.indexOf(":") + 1)).error ?? m; } catch { return m; }
}
