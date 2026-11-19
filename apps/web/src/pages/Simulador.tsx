import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Mensaje } from "../api";
import { useApi } from "../useApi";
import { Formato } from "../Formato";

interface Contacto { telefono: string; nombre: string | null; optica: string }
interface Conversacion { estado: "bot" | "humano" | "cerrada"; mensajes: Mensaje[] }
type Burbuja = Pick<Mensaje, "rol" | "contenido" | "autor"> & { id: string; createdAt: string; pendiente?: boolean };

const SUGERENCIAS = [
  "¿Cuánto sale un progresivo 1.67 con antirreflejo?",
  "¿Cómo va la orden 48213?",
  "¿Cómo van mis órdenes?",
  "Quiero hablar con una persona",
];
const NO_REGISTRADO = "50600000000";

const nuevaSesion = () => Math.random().toString(36).slice(2, 10);

/**
 * Simula el WhatsApp de una óptica contra el agente real (POST /dev/chat).
 * Cada "Nueva conversación" es una sesión aparte, así la demo puede repetirse.
 */
export function Simulador() {
  const contactos = useApi<Contacto[]>("/dev/contactos");
  const [telefono, setTelefono] = useState<string | null>(null);
  const [sesion, setSesion] = useState(nuevaSesion);
  const [burbujas, setBurbujas] = useState<Burbuja[]>([]);
  const [estado, setEstado] = useState<Conversacion["estado"]>("bot");
  const [texto, setTexto] = useState("");
  const [escribiendo, setEscribiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement>(null);

  const tel = telefono ?? contactos.data?.[0]?.telefono ?? null;
  const contacto = contactos.data?.find((c) => c.telefono === tel);

  const cargar = useCallback(async () => {
    if (!tel) return;
    const c = await api<Conversacion>(`/dev/conversacion?telefono=${tel}&sesion=${sesion}`);
    setBurbujas(c.mensajes);
    setEstado(c.estado);
  }, [tel, sesion]);

  useEffect(() => { void cargar().catch((e) => setError(String(e))); }, [cargar]);

  // Mientras una persona atiende, revisar cada 4 s si respondió desde Casos
  useEffect(() => {
    if (estado !== "humano") return;
    const t = setInterval(() => void cargar().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [estado, cargar]);

  useEffect(() => { fin.current?.scrollIntoView({ behavior: "smooth" }); }, [burbujas, escribiendo]);

  const enviar = async (t: string) => {
    const msg = t.trim();
    if (!msg || !tel || escribiendo) return;
    setTexto(""); setError(null); setEscribiendo(true);
    setBurbujas((b) => [...b, { id: `tmp-${Date.now()}`, rol: "cliente", contenido: msg, autor: null, createdAt: new Date().toISOString(), pendiente: true }]);
    try {
      await api("/dev/chat", { method: "POST", body: JSON.stringify({ telefono: tel, texto: msg, sesion, nombre: contacto?.nombre ?? undefined }) });
      await cargar();
    } catch (e) {
      setError("No se pudo enviar el mensaje. Intente de nuevo.");
      console.error(e);
    } finally {
      setEscribiendo(false);
    }
  };

  const reiniciar = (nuevoTel?: string) => {
    if (nuevoTel) setTelefono(nuevoTel);
    setSesion(nuevaSesion()); setBurbujas([]); setEstado("bot"); setError(null);
  };

  return (
    <div className="sim">
      <div className="sim-config">
        <h2>Simulador de WhatsApp</h2>
        <p className="vacio">Escriba como si fuera una óptica. Consultin responde con datos de prueba.</p>
        <label>
          Escribir como
          <select value={tel ?? ""} onChange={(e) => reiniciar(e.target.value)}>
            {contactos.data?.map((c) => <option key={c.telefono} value={c.telefono}>{c.optica} · {c.nombre ?? c.telefono}</option>)}
            <option value={NO_REGISTRADO}>Número no registrado</option>
          </select>
        </label>
        <button className="secundario" onClick={() => reiniciar()}>Nueva conversación</button>
      </div>

      <div className="tel">
        <header className="tel-top">
          <div className="avatar">C</div>
          <div>
            <strong>Consultin · Topex</strong>
            <small>{escribiendo ? "escribiendo…" : estado === "humano" ? "atendido por una persona" : "en línea"}</small>
          </div>
        </header>

        <div className="tel-chat">
          {contactos.error && <p className="tel-aviso">No se pudo conectar con Consultin. Revise la conexión y recargue.</p>}
          {!burbujas.length && !escribiendo && (
            <p className="tel-vacio">Escriba un mensaje o use una sugerencia para empezar.</p>
          )}
          {burbujas.map((b) => (
            <div key={b.id} className={`burbuja ${b.rol === "cliente" ? "yo" : b.rol}`}>
              {b.rol === "agente" && <small>{b.autor ?? "Servicio al cliente"}</small>}
              <p><Formato texto={b.contenido} /></p>
              <time>{new Date(b.createdAt).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })}{b.rol === "cliente" && (b.pendiente ? " ✓" : " ✓✓")}</time>
            </div>
          ))}
          {escribiendo && <div className="burbuja bot puntos"><span /><span /><span /></div>}
          {estado === "humano" && !escribiendo && (
            <p className="tel-aviso">Una persona del equipo tomó esta conversación. Respóndale desde <b>Casos</b>.</p>
          )}
          <div ref={fin} />
        </div>

        {error && <p className="error tel-error">{error}</p>}
        <div className="chips">
          {SUGERENCIAS.map((s) => <button key={s} onClick={() => enviar(s)} disabled={escribiendo || !tel}>{s}</button>)}
        </div>
        <form className="tel-input" onSubmit={(e) => { e.preventDefault(); void enviar(texto); }}>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={tel ? "Mensaje" : "Cargando…"} disabled={!tel} enterKeyHint="send" />
          <button aria-label="Enviar" disabled={escribiendo || !tel || !texto.trim()}>➤</button>
        </form>
      </div>
    </div>
  );
}
