import { useMemo, useState } from "react";
import { api, type Optica } from "../api";
import { useApi } from "../useApi";
import { mensajeError } from "./Chats";

type Tipo = "optica" | "persona";
const VACIO = {
  nombre: "", razonSocial: "", codigoSap: "", codigoMac: "", ruta: "", codigoLensware: "",
  telefono: "", email: "", direccion: "", horario: "", contacto: "", empresa: "", notas: "",
};

/** Alta manual de clientes: ópticas (con sus números de WhatsApp autorizados) o personas. */
export function AgregarCliente({ onCreado }: { onCreado: (clienteId: string) => void }) {
  const [tipo, setTipo] = useState<Tipo>("optica");
  const [f, setF] = useState(VACIO);
  const [numeros, setNumeros] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const opticas = useApi<Optica[]>("/crm/opticas");
  const rutas = useMemo(() => [...new Set((opticas.data ?? []).map((o) => o.ruta).filter(Boolean) as string[])].sort(), [opticas.data]);

  const campo = (k: keyof typeof VACIO, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label>{label}<input value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value }); setDuplicado(false); }} {...props} /></label>
  );

  const guardar = async (e: React.FormEvent, forzar = false) => {
    e.preventDefault(); setError(null); setGuardando(true);
    const cuerpo = tipo === "optica"
      ? { tipo, nombre: f.nombre, razonSocial: f.razonSocial, codigoSap: f.codigoSap, codigoMac: f.codigoMac, ruta: f.ruta,
          codigoLensware: f.codigoLensware, whatsapp: numeros.filter((n) => n.trim()), telefono: f.telefono, email: f.email,
          direccion: f.direccion, horario: f.horario, contacto: f.contacto, notas: f.notas, forzar }
      : { tipo, nombre: f.nombre, empresa: f.empresa, email: f.email, telefono: f.telefono, direccion: f.direccion, notas: f.notas, forzar };
    try {
      const { clienteId } = await api<{ clienteId: string }>("/crm/clientes", { method: "POST", body: JSON.stringify(cuerpo) });
      setF(VACIO); setNumeros([""]); setDuplicado(false);
      onCreado(clienteId);
    } catch (err) {
      const m = mensajeError(err);
      setError(m);
      setDuplicado(/Ya existe/.test(m)); // nombre repetido: se puede crear igual
    } finally { setGuardando(false); }
  };

  return (
    <>
      <header className="top"><h2>Agregar cliente</h2></header>
      <div className="tabs pestanas">
        <button className={tipo === "optica" ? "on" : ""} onClick={() => { setTipo("optica"); setError(null); }}>Óptica</button>
        <button className={tipo === "persona" ? "on" : ""} onClick={() => { setTipo("persona"); setError(null); }}>Persona / prospecto</button>
      </div>

      <form className="panel form-perfil" onSubmit={(e) => guardar(e)}>
        {tipo === "optica" ? (
          <>
            <h3>Datos de la óptica</h3>
            <div className="campos">
              {campo("nombre", "Nombre comercial *", { required: true, placeholder: "Ej: Óptica Vargas Central" })}
              {campo("razonSocial", "Razón social")}
              {campo("codigoSap", "Código SAP")}
              {campo("codigoMac", "Código MAC")}
              {campo("codigoLensware", "Código LensWare", { placeholder: "Para consultar órdenes" })}
              <label>Ruta
                <input list="rutas" value={f.ruta} onChange={(e) => setF({ ...f, ruta: e.target.value })} placeholder="Elegir o escribir" />
                <datalist id="rutas">{rutas.map((r) => <option key={r} value={r} />)}</datalist>
              </label>
            </div>

            <h3>WhatsApp autorizados</h3>
            <p className="vacio">Desde estos números el agente reconoce a la óptica y le da precios y el estado de sus órdenes.</p>
            <div className="numeros">
              {numeros.map((n, i) => (
                <div key={i} className="numero">
                  <span className="prefijo">+506</span>
                  <input value={n} inputMode="tel" placeholder="8888 8888" onChange={(e) => setNumeros(numeros.map((x, j) => (j === i ? e.target.value : x)))} />
                  {numeros.length > 1 && <button type="button" className="enlace peligro-txt" onClick={() => setNumeros(numeros.filter((_, j) => j !== i))} aria-label="Quitar número">Quitar</button>}
                </div>
              ))}
              <button type="button" className="enlace" onClick={() => setNumeros([...numeros, ""])}>+ Otro número</button>
            </div>

            <h3>Contacto y ubicación</h3>
            <div className="campos">
              {campo("contacto", "Persona de contacto")}
              {campo("telefono", "Otros teléfonos", { placeholder: "Fijos u otros, informativo" })}
              {campo("email", "Correo", { type: "email" })}
              {campo("horario", "Horario de atención")}
              <label className="ancho">Ubicación exacta<input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></label>
            </div>
          </>
        ) : (
          <>
            <h3>Datos de la persona</h3>
            <p className="vacio">Para prospectos o clientes que no son óptica. Si luego escribe por WhatsApp desde este teléfono, la conversación se liga a este perfil (sin acceso a precios ni órdenes).</p>
            <div className="campos">
              {campo("nombre", "Nombre *", { required: true })}
              {campo("empresa", "Empresa")}
              {campo("telefono", "Teléfono / WhatsApp", { inputMode: "tel", placeholder: "8888 8888" })}
              {campo("email", "Correo", { type: "email" })}
              <label className="ancho">Dirección<input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></label>
            </div>
          </>
        )}
        <label>Notas internas<textarea value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} placeholder="No anotar datos clínicos ni de pacientes" /></label>
        {error && <p className="error">{error}</p>}
        <div className="acciones">
          <button className="primario" disabled={guardando || f.nombre.trim().length < 2}>{guardando ? "Guardando…" : `Agregar ${tipo === "optica" ? "óptica" : "persona"}`}</button>
          {duplicado && <button type="button" className="secundario" onClick={(e) => guardar(e, true)}>Crear de todas formas</button>}
        </div>
      </form>
    </>
  );
}
