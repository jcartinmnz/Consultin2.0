import { useEffect, useState } from "react";
import { api, PLATAFORMAS } from "../api";
import { useApi } from "../useApi";
import { mensajeError } from "./Chats";

interface PromptConfig { prompt: string; personalizado: boolean; porDefecto: string; reglasFijas: string }
interface ConexionGuardada { cuentaId: string; plataforma: string; nombre: string; modo: "opticas" | "abierto" | "precios"; prompt: string | null; activa: boolean }
interface Cuenta {
  id: string; plataforma: string; usuario: string | null; nombre: string | null; foto: string | null;
  activa: boolean; necesitaReconexion: boolean; conexion: ConexionGuardada | null;
}

const MODOS = {
  opticas: "Solo ópticas registradas (los demás reciben aviso y pasan a una persona)",
  precios: "Todos, con precios (no registrados pueden cotizar; órdenes solo ópticas)",
  abierto: "Todos, sin precios (no registrados solo pueden pasar a una persona)",
};

export function Configuracion() {
  return (
    <>
      <header className="top"><h2>Ajustes</h2></header>
      <Espera />
      <PromptBase />
      <Conexiones />
    </>
  );
}

function Espera() {
  const { data, recargar } = useApi<{ segundos: number; max: number; porDefecto: number }>("/crm/config/espera");
  const [valor, setValor] = useState<number | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  useEffect(() => { if (data) setValor(data.segundos); }, [data]);
  if (!data || valor === null) return <section className="panel"><p>Cargando…</p></section>;

  const guardar = async () => {
    setEstado(null);
    try { await api("/crm/config/espera", { method: "PUT", body: JSON.stringify({ segundos: valor }) }); await recargar(); setEstado("Guardado."); }
    catch (e) { setEstado(mensajeError(e)); }
  };

  return (
    <section className="panel">
      <h3>Mensajes seguidos</h3>
      <p className="vacio">Cuando alguien manda varios mensajes seguidos, el agente espera este tiempo y responde una sola vez a todos. 0 = responde cada mensaje apenas llega.</p>
      <div className="acciones espera">
        <input type="range" min={0} max={data.max} step={1} value={valor} onChange={(e) => setValor(Number(e.target.value))} aria-label="Segundos de espera" />
        <strong>{valor} s</strong>
        <button className="primario" onClick={guardar} disabled={valor === data.segundos}>Guardar</button>
      </div>
      {estado && <p className="vacio">{estado}</p>}
    </section>
  );
}

function PromptBase() {
  const { data, recargar } = useApi<PromptConfig>("/crm/config/prompt");
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<string | null>(null);
  const [verReglas, setVerReglas] = useState(false);
  useEffect(() => { if (data) setTexto(data.prompt); }, [data]);
  if (!data) return <section className="panel"><p>Cargando…</p></section>;
  const cambiado = texto !== data.prompt;

  const guardar = async () => {
    setEstado(null);
    try { await api("/crm/config/prompt", { method: "PUT", body: JSON.stringify({ prompt: texto }) }); await recargar(); setEstado("Guardado. Aplica desde el próximo mensaje."); }
    catch (e) { setEstado(mensajeError(e)); }
  };
  const restaurar = async () => {
    if (!confirm("¿Volver al prompt por defecto? Se pierde el texto actual.")) return;
    await api("/crm/config/prompt", { method: "DELETE" }); await recargar(); setEstado("Se restauró el prompt por defecto.");
  };

  return (
    <section className="panel">
      <h3>Prompt base</h3>
      <p className="vacio">Instrucciones del agente: quién es, qué hace y cómo habla. Lo usan todas las conexiones que no tengan un prompt propio. <code>{"{lab}"}</code> se reemplaza por el nombre del laboratorio.</p>
      <textarea className="prompt" value={texto} onChange={(e) => setTexto(e.target.value)} spellCheck={false} />
      <div className="acciones">
        <button className="primario" onClick={guardar} disabled={!cambiado}>Guardar</button>
        {cambiado && <button className="secundario" onClick={() => setTexto(data.prompt)}>Descartar cambios</button>}
        {data.personalizado && <button className="secundario" onClick={restaurar}>Restaurar por defecto</button>}
        <button className="enlace" onClick={() => setVerReglas(!verReglas)}>{verReglas ? "Ocultar" : "Ver"} reglas fijas</button>
      </div>
      {estado && <p className="vacio">{estado}</p>}
      {verReglas && (
        <div className="reglas">
          <p className="vacio">Estas reglas se agregan siempre al final, junto con la fecha, el canal y quién escribe. No se pueden editar desde aquí.</p>
          <pre>{data.reglasFijas}</pre>
        </div>
      )}
    </section>
  );
}

function Conexiones() {
  const { data, error, recargar } = useApi<{ cuentas: Cuenta[]; error: string | null }>("/crm/conexiones");
  const [aviso, setAviso] = useState<string | null>(null);

  const conectar = async (plataforma: string) => {
    setAviso(null);
    try {
      const { url } = await api<{ url: string }>(`/crm/conexiones/conectar/${plataforma}`);
      window.open(url, "_blank", "noopener");
      setAviso("Termine la conexión en la ventana que se abrió y luego toque “Actualizar”. La cuenta nueva aparecerá en la lista para activarla.");
    } catch (e) { setAviso(mensajeError(e)); }
  };

  return (
    <section className="panel">
      <h3>Conexiones</h3>
      <p className="vacio">Cuentas de Zernio. Consultin solo atiende las que estén conectadas aquí; las demás se ignoran.</p>
      {(error || data?.error) && <p className="error">No se pudo leer Zernio: {error ?? data?.error}</p>}
      <div className="conexiones">
        {data?.cuentas.map((c) => <FilaConexion key={c.id} cuenta={c} onCambio={recargar} />)}
        {data?.cuentas.length === 0 && <p className="vacio">No hay cuentas en Zernio todavía.</p>}
      </div>
      <div className="acciones">
        <span className="vacio">Agregar cuenta:</span>
        {(["instagram", "whatsapp", "facebook"] as const).map((p) => (
          <button key={p} className="secundario" onClick={() => conectar(p)}>+ {PLATAFORMAS[p]}</button>
        ))}
        <button className="enlace" onClick={() => recargar()}>Actualizar</button>
      </div>
      {aviso && <p className="vacio">{aviso}</p>}
    </section>
  );
}

function FilaConexion({ cuenta: c, onCambio }: { cuenta: Cuenta; onCambio: () => void }) {
  const cx = c.conexion;
  const [modo, setModo] = useState<ConexionGuardada["modo"]>(cx?.modo ?? (c.plataforma === "whatsapp" ? "opticas" : "abierto"));
  const [prompt, setPrompt] = useState(cx?.prompt ?? "");
  const [abierta, setAbierta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinFoto, setSinFoto] = useState(false);
  const nombre = c.usuario ? (c.plataforma === "whatsapp" ? c.usuario : `@${c.usuario}`) : c.id;

  const guardar = async (cambios: Partial<{ activa: boolean; modo: string; prompt: string | null }> = {}) => {
    setError(null);
    try {
      await api(`/crm/conexiones/${c.id}`, { method: "PUT", body: JSON.stringify({
        plataforma: c.plataforma, nombre, modo, prompt: prompt.trim() || null, activa: cx?.activa ?? true, ...cambios,
      }) });
      onCambio();
    } catch (e) { setError(mensajeError(e)); }
  };
  const quitar = async () => {
    if (!confirm(`¿Quitar ${nombre}? Consultin deja de atender esta cuenta (no se desconecta de Zernio).`)) return;
    await api(`/crm/conexiones/${c.id}`, { method: "DELETE" }); onCambio();
  };

  return (
    <div className={`conexion ${cx ? "" : "sin"}`}>
      <div className="cx-cabeza">
        {c.foto && !sinFoto
          ? <img src={c.foto} alt="" referrerPolicy="no-referrer" onError={() => setSinFoto(true)} />
          : <span className={`plat ${c.plataforma}`}>{(PLATAFORMAS[c.plataforma] ?? c.plataforma).slice(0, 2)}</span>}
        <div className="cx-nombre">
          <strong>{nombre}</strong>
          <small>{PLATAFORMAS[c.plataforma] ?? c.plataforma}{c.nombre ? ` · ${c.nombre}` : ""}{c.necesitaReconexion ? " · requiere reconexión en Zernio" : ""}</small>
        </div>
        {cx ? (
          <label className={`switch ${cx.activa ? "on" : ""}`}>
            <input type="checkbox" checked={cx.activa} onChange={() => guardar({ activa: !cx.activa })} />
            <span className="riel"><span className="bola" /></span>
            <span>{cx.activa ? "Atendiendo" : "En pausa"}</span>
          </label>
        ) : (
          <button className="primario" onClick={() => guardar({ activa: true })}>Conectar a Consultin</button>
        )}
      </div>
      {cx && (
        <>
          <button className="enlace" onClick={() => setAbierta(!abierta)}>{abierta ? "Ocultar ajustes" : `Ajustes · ${{ opticas: "solo ópticas", precios: "todos con precios", abierto: "todos sin precios" }[cx.modo] ?? cx.modo}${cx.prompt ? " · prompt propio" : ""}`}</button>
          {abierta && (
            <div className="cx-ajustes">
              <label>Si escribe alguien que no es óptica registrada
                <select value={modo} onChange={(e) => setModo(e.target.value as ConexionGuardada["modo"])}>
                  {Object.entries(MODOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label>Prompt propio (opcional, reemplaza al prompt base en esta cuenta)
                <textarea className="prompt corto" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Vacío = usa el prompt base" spellCheck={false} />
              </label>
              <div className="acciones">
                <button className="primario" onClick={() => guardar()}>Guardar ajustes</button>
                <button className="peligro" onClick={quitar}>Quitar conexión</button>
              </div>
            </div>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
