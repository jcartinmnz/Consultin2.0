import { useEffect, useState } from "react";
import { api, PLATAFORMAS } from "../api";
import { useApi } from "../useApi";
import { mensajeError } from "./Chats";

interface FilaCliente {
  id: string; tipo: "optica" | "persona"; nombre: string; empresa: string | null; origen: string | null;
  conversaciones: number; consultas: number; compras: number; totalCompras: number; ultimaActividad: string | null;
}
interface Compra { id: string; fecha: string; sku: string | null; descripcion: string; cantidad: number; precioUnitario: number; total: number; notas: string | null; autor: string | null }
interface Consulta { id: string; tipo: "precio" | "orden"; fecha: string; ok: boolean | null; conversacionId: string; consulta: string | null; resultado: { sku?: string; nombre?: string; precio?: number; numero_orden?: string; estado?: string }[] | null }
interface Orden { numeroOrden: string; estado: string; estacion: string | null; fechaIngreso: string | null; fechaEstimada: string | null; referencia: string | null }
interface Perfil {
  cliente: { id: string; tipo: "optica" | "persona"; nombre: string; empresa: string | null; email: string | null; telefono: string | null; direccion: string | null; origen: string | null; notas: string | null; createdAt: string };
  optica: { id: string; nombre: string; codigoLensware: string | null; codigoSap: string | null; codigoMac: string | null; ruta: string | null } | null;
  contactos: { id: string; nombre: string | null; telefono: string; autorizado: boolean }[];
  conversaciones: { id: string; plataforma: string; estado: string; lastMessageAt: string; createdAt: string }[];
  consultas: Consulta[]; compras: Compra[];
  casos: { id: string; nivel: string; motivo: string; estado: string; createdAt: string }[];
  ordenes: Orden[]; ordenesError: string | null;
  metricas: {
    totalCompras: number; numCompras: number; ticketPromedio: number | null; ultimaCompra: string | null;
    conversaciones: number; mensajes: number; respuestasBot: number; consultasPrecio: number; consultasOrden: number;
    escalamientos: number; resolucionBot: number | null; primeraInteraccion: string | null; ultimaInteraccion: string | null;
    productosConsultados: { nombre: string; veces: number }[];
  };
}

const colones = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `₡${Math.round(n).toLocaleString("es-CR")}`);
const fecha = (iso: string | null | undefined, conHora = false) =>
  !iso ? "—" : new Date(iso).toLocaleString("es-CR", conHora ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
const origenTxt = (c: { tipo: string; origen: string | null }) => (c.tipo === "optica" ? "Óptica" : PLATAFORMAS[c.origen ?? ""] ?? c.origen ?? "Persona");

export function Clientes({ inicial, onAbrirChat }: { inicial?: string | null; onAbrirChat: (conversacionId: string) => void }) {
  const [sel, setSel] = useState<string | null>(inicial ?? null);
  const [q, setQ] = useState("");
  const [buscar, setBuscar] = useState("");
  const [tipo, setTipo] = useState<"" | "optica" | "persona">("");
  useEffect(() => { const t = setTimeout(() => setBuscar(q), 300); return () => clearTimeout(t); }, [q]);
  const lista = useApi<FilaCliente[]>(`/crm/clientes?q=${encodeURIComponent(buscar)}&tipo=${tipo}`);

  return (
    <div className={`casos ${sel ? "con-detalle" : ""}`}>
      <div className="lista">
        <header className="top">
          <h2>Clientes</h2>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            <option value="">Todos</option><option value="optica">Ópticas</option><option value="persona">Personas</option>
          </select>
        </header>
        <input className="buscar" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, empresa, correo o teléfono" />
        {lista.error && <p className="error">{lista.error}</p>}
        {lista.data?.map((c) => (
          <button key={c.id} className={`item chat-item ${sel === c.id ? "on" : ""}`} onClick={() => setSel(c.id)}>
            <span className={`plat ${c.tipo === "optica" ? "optica" : c.origen ?? ""}`}>{c.tipo === "optica" ? "OP" : (PLATAFORMAS[c.origen ?? ""] ?? "PE").slice(0, 2)}</span>
            <strong>{c.nombre}</strong>
            <small className="preview">{origenTxt(c)}{c.empresa ? ` · ${c.empresa}` : ""}</small>
            <small className="meta">
              {c.compras > 0 && <span className="tag mini-tag">{colones(c.totalCompras)}</span>}
              <span>{c.consultas} consulta{c.consultas === 1 ? "" : "s"}</span>
              <span className="hora">{c.ultimaActividad ? fecha(c.ultimaActividad) : "sin chats"}</span>
            </small>
          </button>
        ))}
        {lista.data?.length === 0 && <p className="vacio">{buscar || tipo ? "Sin resultados." : "Todavía no hay clientes. Se crean solos cuando alguien escribe."}</p>}
      </div>
      <div className="detalle detalle-scroll">
        {sel && <button className="volver" onClick={() => setSel(null)}>← Clientes</button>}
        {sel ? <FichaCliente key={sel} id={sel} onCambio={lista.recargar} onAbrirChat={onAbrirChat} /> : <p className="vacio">Seleccione un cliente.</p>}
      </div>
    </div>
  );
}

type Pestana = "resumen" | "compras" | "consultas" | "ordenes" | "datos";

function FichaCliente({ id, onCambio, onAbrirChat }: { id: string; onCambio: () => void; onAbrirChat: (c: string) => void }) {
  const { data, error, recargar } = useApi<Perfil>(`/crm/clientes/${id}`);
  const [pestana, setPestana] = useState<Pestana>("resumen");
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Cargando…</p>;
  const { cliente: cl, metricas: m } = data;
  const pestanas: [Pestana, string][] = [
    ["resumen", "Resumen"], ["compras", `Compras (${m.numCompras})`], ["consultas", `Consultas (${data.consultas.length})`],
    ...(data.optica ? [["ordenes", "Órdenes"] as [Pestana, string]] : []), ["datos", "Datos"],
  ];
  const refrescar = async () => { await recargar(); onCambio(); };

  return (
    <>
      <header className="top">
        <div>
          <h2>{cl.nombre}</h2>
          <small className="vacio">{origenTxt(cl)}{data.optica ? [data.optica.ruta, data.optica.codigoSap && `SAP ${data.optica.codigoSap}`, data.optica.codigoLensware ? `LensWare ${data.optica.codigoLensware}` : "sin LensWare"].filter(Boolean).map((x) => ` · ${x}`).join("") : ""} · cliente desde {fecha(cl.createdAt)}</small>
        </div>
      </header>
      <div className="tabs pestanas">
        {pestanas.map(([k, t]) => <button key={k} className={pestana === k ? "on" : ""} onClick={() => setPestana(k)}>{t}</button>)}
      </div>

      {pestana === "resumen" && (
        <>
          <div className="kpis kpis-cliente">
            <Kpi l="Total comprado" v={colones(m.totalCompras)} dest />
            <Kpi l="Compras" v={m.numCompras} />
            <Kpi l="Ticket promedio" v={colones(m.ticketPromedio)} />
            <Kpi l="Última compra" v={fecha(m.ultimaCompra)} />
            <Kpi l="Conversaciones" v={m.conversaciones} />
            <Kpi l="Mensajes recibidos" v={m.mensajes} />
            <Kpi l="Consultas de precio" v={m.consultasPrecio} />
            <Kpi l="Consultas de órdenes" v={m.consultasOrden} />
            <Kpi l="Pasó a una persona" v={m.escalamientos} />
            <Kpi l="Resuelto por el agente" v={m.resolucionBot === null ? "—" : `${Math.round(m.resolucionBot * 100)}%`} />
          </div>
          <div className="grid2">
            <section className="panel">
              <h3>Actividad</h3>
              <table><tbody>
                <tr><td>Primera interacción</td><td className="num">{fecha(m.primeraInteraccion)}</td></tr>
                <tr><td>Última interacción</td><td className="num">{fecha(m.ultimaInteraccion, true)}</td></tr>
                <tr><td>Respuestas del agente</td><td className="num">{m.respuestasBot}</td></tr>
              </tbody></table>
            </section>
            <section className="panel">
              <h3>Productos más consultados</h3>
              {m.productosConsultados.length
                ? <table><tbody>{m.productosConsultados.map((p) => <tr key={p.nombre}><td>{p.nombre}</td><td className="num">{p.veces}</td></tr>)}</tbody></table>
                : <p className="vacio">Sin consultas de precio todavía.</p>}
            </section>
            <section className="panel">
              <h3>Conversaciones</h3>
              {data.conversaciones.length ? data.conversaciones.map((c) => (
                <button key={c.id} className="fila-enlace" onClick={() => onAbrirChat(c.id)}>
                  <span>{PLATAFORMAS[c.plataforma] ?? c.plataforma} · {c.estado === "bot" ? "agente activo" : "agente apagado"}</span>
                  <small>{fecha(c.lastMessageAt, true)} →</small>
                </button>
              )) : <p className="vacio">Sin conversaciones.</p>}
              {data.casos.length > 0 && <p className="vacio">{data.casos.filter((x) => x.estado !== "resuelto").length} caso(s) abierto(s) de {data.casos.length}.</p>}
            </section>
          </div>
        </>
      )}

      {pestana === "compras" && <Compras id={id} compras={data.compras} onCambio={refrescar} />}

      {pestana === "consultas" && (
        <section className="panel">
          <h3>Lo que le preguntó al agente</h3>
          {data.consultas.length ? data.consultas.map((c) => (
            <div key={c.id} className="consulta">
              <div className="consulta-cab">
                <span className={`tag mini-tag ${c.tipo}`}>{c.tipo === "precio" ? "Precio" : "Orden"}</span>
                <strong>{c.consulta ?? "—"}</strong>
                <small className="hora">{fecha(c.fecha, true)}</small>
              </div>
              {c.resultado?.length ? (
                <ul>{c.resultado.map((r, i) => <li key={i}>{r.nombre ? `${r.nombre} · ${colones(r.precio)}` : `Orden ${r.numero_orden}: ${r.estado}`}</li>)}</ul>
              ) : <small className="vacio">{c.ok === false ? "La consulta falló." : "Sin resultados."}</small>}
              <button className="enlace" onClick={() => onAbrirChat(c.conversacionId)}>Ver en el chat →</button>
            </div>
          )) : <p className="vacio">Todavía no consultó precios ni órdenes.</p>}
        </section>
      )}

      {pestana === "ordenes" && (
        <section className="panel">
          <h3>Órdenes en el laboratorio</h3>
          <p className="vacio">{data.optica?.codigoLensware ? "Datos de prueba hasta que se conecte LensWare." : "Se mostrarán cuando LensWare esté conectado y la óptica tenga su código."}</p>
          {data.ordenesError && <p className="error">{data.ordenesError}</p>}
          {data.ordenes.length ? (
            <div className="tabla-scroll"><table>
              <thead><tr><th>Orden</th><th>Estado</th><th>Ingreso</th><th>Entrega estimada</th><th>Referencia</th></tr></thead>
              <tbody>{data.ordenes.map((o) => (
                <tr key={o.numeroOrden}><td>{o.numeroOrden}</td><td>{o.estado}{o.estacion ? ` · ${o.estacion}` : ""}</td>
                  <td>{fecha(o.fechaIngreso)}</td><td>{fecha(o.fechaEstimada)}</td><td>{o.referencia ?? "—"}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <p className="vacio">Sin órdenes.</p>}
        </section>
      )}

      {pestana === "datos" && <Datos perfil={data} onCambio={refrescar} />}
    </>
  );
}

function Kpi({ l, v, dest }: { l: string; v: string | number; dest?: boolean }) {
  return <div className={`kpi ${dest ? "dest" : ""}`}><div className="v">{v}</div><div className="l">{l}</div></div>;
}

function Datos({ perfil, onCambio }: { perfil: Perfil; onCambio: () => Promise<void> }) {
  const cl = perfil.cliente;
  const [f, setF] = useState({ nombre: cl.nombre, empresa: cl.empresa ?? "", email: cl.email ?? "", telefono: cl.telefono ?? "", direccion: cl.direccion ?? "", notas: cl.notas ?? "" });
  const [estado, setEstado] = useState<string | null>(null);
  const campo = (k: keyof typeof f, label: string, tipo = "text") => (
    <label>{label}<input type={tipo} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault(); setEstado(null);
    try { await api(`/crm/clientes/${cl.id}`, { method: "PATCH", body: JSON.stringify(f) }); await onCambio(); setEstado("Guardado."); }
    catch (err) { setEstado(mensajeError(err)); }
  };
  return (
    <>
      <form className="panel form-perfil" onSubmit={guardar}>
        <h3>Datos de perfil</h3>
        <div className="campos">
          {campo("nombre", "Nombre")}{campo("empresa", "Empresa")}{campo("email", "Correo", "email")}
          {campo("telefono", "Teléfono", "tel")}{campo("direccion", "Dirección")}
        </div>
        <label>Notas internas<textarea value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} placeholder="Preferencias, acuerdos, cómo contactarle… (no anotar datos clínicos ni de pacientes)" /></label>
        <div className="acciones"><button className="primario">Guardar</button>{estado && <span className="vacio">{estado}</span>}</div>
      </form>
      {perfil.optica && (
        <section className="panel">
          <h3>Números autorizados de la óptica</h3>
          <table><tbody>{perfil.contactos.map((c) => <tr key={c.id}><td>{c.nombre ?? "—"}</td><td>+{c.telefono}</td><td className="num">{c.autorizado ? "Autorizado" : "Bloqueado"}</td></tr>)}</tbody></table>
          <p className="vacio">Se administran en la pestaña Ópticas.</p>
        </section>
      )}
    </>
  );
}

interface Producto { sku: string; nombre: string; precio: number; unidad: string }

function Compras({ id, compras, onCambio }: { id: string; compras: Compra[]; onCambio: () => Promise<void> }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ descripcion: "", sku: null as string | null, cantidad: 1, precio: "", fecha: hoy, notas: "" });
  const [busqueda, setBusqueda] = useState("");
  const [opciones, setOpciones] = useState<Producto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (busqueda.trim().length < 2) { setOpciones([]); return; }
    const t = setTimeout(() => { api<Producto[]>(`/crm/productos?q=${encodeURIComponent(busqueda)}`).then(setOpciones).catch(() => setOpciones([])); }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const elegir = (p: Producto) => { setF({ ...f, descripcion: p.nombre, sku: p.sku, precio: String(p.precio) }); setBusqueda(""); setOpciones([]); };
  const precio = Number(f.precio);
  const valido = f.descripcion.trim() && f.precio !== "" && Number.isFinite(precio) && precio >= 0 && f.cantidad >= 1;

  const registrar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!valido) return; setError(null);
    try {
      await api(`/crm/clientes/${id}/compras`, { method: "POST", body: JSON.stringify({
        descripcion: f.descripcion, sku: f.sku, cantidad: f.cantidad, precioUnitario: precio,
        fecha: new Date(`${f.fecha}T12:00:00-06:00`).toISOString(), notas: f.notas || null,
        autor: localStorage.getItem("consultin_autor") ?? "Equipo Expertia",
      }) });
      setF({ descripcion: "", sku: null, cantidad: 1, precio: "", fecha: hoy, notas: "" }); setAbierto(false); await onCambio();
    } catch (err) { setError(mensajeError(err)); }
  };
  const borrar = async (c: Compra) => {
    if (!confirm(`¿Borrar la compra "${c.descripcion}" de ${colones(c.total)}?`)) return;
    await api(`/crm/compras/${c.id}`, { method: "DELETE" }); await onCambio();
  };

  return (
    <section className="panel">
      <div className="top"><h3>Compras</h3>{!abierto && <button className="primario" onClick={() => setAbierto(true)}>+ Registrar compra</button>}</div>
      {abierto && (
        <form className="form-compra" onSubmit={registrar}>
          <label>Buscar en la lista de precios (opcional)
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Ej: autograph 1.67 transitions, montaje al aire" />
          </label>
          {opciones.length > 0 && (
            <div className="opciones">{opciones.map((p) => (
              <button type="button" key={p.sku} onClick={() => elegir(p)}><span>{p.nombre}</span><strong>{colones(p.precio)}</strong></button>
            ))}</div>
          )}
          <div className="campos">
            <label className="ancho">Descripción<input value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value, sku: null })} required /></label>
            <label>Cantidad (pares)<input type="number" min={1} value={f.cantidad} onChange={(e) => setF({ ...f, cantidad: Math.max(1, Number(e.target.value) || 1) })} /></label>
            <label>Precio unitario (₡)<input type="number" min={0} step="1" value={f.precio} onChange={(e) => setF({ ...f, precio: e.target.value })} required /></label>
            <label>Fecha<input type="date" value={f.fecha} max={hoy} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
          </div>
          <label>Notas<input value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} placeholder="Factura, descuento, forma de pago…" /></label>
          <div className="acciones">
            <strong>Total: {valido ? colones(precio * f.cantidad) : "—"}</strong>
            <button className="primario" disabled={!valido}>Guardar compra</button>
            <button type="button" className="secundario" onClick={() => setAbierto(false)}>Cancelar</button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      )}
      {compras.length ? (
        <div className="tabla-scroll"><table>
          <thead><tr><th>Fecha</th><th>Producto</th><th>Cant.</th><th className="num">Total</th><th /></tr></thead>
          <tbody>{compras.map((c) => (
            <tr key={c.id}>
              <td>{fecha(c.fecha)}</td>
              <td>{c.descripcion}{c.notas ? <small className="vacio"> · {c.notas}</small> : null}</td>
              <td>{c.cantidad} × {colones(c.precioUnitario)}</td>
              <td className="num">{colones(c.total)}</td>
              <td className="num"><button className="enlace peligro-txt" onClick={() => borrar(c)} aria-label="Borrar compra">Borrar</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : !abierto && <p className="vacio">Sin compras registradas.</p>}
    </section>
  );
}
