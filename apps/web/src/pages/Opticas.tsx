import { useState } from "react";
import { api, type Caso, type Optica } from "../api";
import { useApi } from "../useApi";

interface Contacto { id: string; nombre: string | null; telefono: string; autorizado: boolean }
interface FichaOptica { optica: Optica; contactos: Contacto[]; casos: Caso[]; conversaciones: { id: string; telefono: string; estado: string; lastMessageAt: string }[] }

export function Opticas() {
  const lista = useApi<Optica[]>("/crm/opticas");
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const n = (t: string | null | undefined) => (t ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const filtradas = lista.data?.filter((o) => !q || [o.nombre, o.razonSocial, o.codigoSap, o.codigoMac, o.ruta, o.codigoLensware].some((x) => n(x).includes(n(q))));

  const crear = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await api("/crm/opticas", { method: "POST", body: JSON.stringify({ nombre: f.get("nombre"), codigoLensware: f.get("codigo") || null }) });
    e.currentTarget.reset(); lista.recargar();
  };

  return (
    <div className={`casos ${sel ? "con-detalle" : ""}`}>
      <div className="lista">
        <header className="top"><h2>Ópticas</h2></header>
        <form className="mini" onSubmit={crear}>
          <input name="nombre" placeholder="Nombre de la óptica" required />
          <input name="codigo" placeholder="Código en LensWare (opcional)" />
          <button>Agregar</button>
        </form>
        <input className="buscar" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar entre ${lista.data?.length ?? 0} ópticas (nombre, SAP, MAC, ruta)`} />
        {filtradas?.slice(0, 200).map((o) => (
          <button key={o.id} className={`item ${sel === o.id ? "on" : ""}`} onClick={() => setSel(o.id)}>
            <strong>{o.nombre}</strong>
            <small>{[o.ruta, o.codigoSap && `SAP ${o.codigoSap}`, o.codigoMac && `MAC ${o.codigoMac}`, o.codigoLensware ? `LensWare ${o.codigoLensware}` : "sin LensWare"].filter(Boolean).join(" · ")}</small>
          </button>
        ))}
        {(filtradas?.length ?? 0) > 200 && <p className="vacio">Mostrando 200 de {filtradas!.length}. Afine la búsqueda.</p>}
      </div>
      <div className="detalle">
        {sel && <button className="volver" onClick={() => setSel(null)}>← Ópticas</button>}
        {sel ? <Ficha id={sel} /> : <p className="vacio">Seleccione una óptica.</p>}
      </div>
    </div>
  );
}

function Ficha({ id }: { id: string }) {
  const { data, recargar } = useApi<FichaOptica>(`/crm/opticas/${id}`);
  if (!data) return <p>Cargando…</p>;

  const agregar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await api(`/crm/opticas/${id}/contactos`, { method: "POST", body: JSON.stringify({ nombre: f.get("nombre") || undefined, telefono: f.get("tel") }) });
    e.currentTarget.reset(); recargar();
  };
  const toggle = async (c: Contacto) => {
    await api(`/crm/contactos/${c.id}`, { method: "PATCH", body: JSON.stringify({ autorizado: !c.autorizado }) });
    recargar();
  };

  return (
    <>
      <header className="top"><h2>{data.optica.nombre}</h2><span className="tag">{data.optica.codigoLensware ? `LensWare ${data.optica.codigoLensware}` : "Sin código LensWare"}</span></header>
      {(data.optica.razonSocial || data.optica.codigoSap || data.optica.ruta) && (
        <p className="vacio">{[data.optica.razonSocial, data.optica.codigoSap && `SAP ${data.optica.codigoSap}`, data.optica.codigoMac && `MAC ${data.optica.codigoMac}`, data.optica.ruta].filter(Boolean).join(" · ")}</p>
      )}
      <section className="panel">
        <h3>Números autorizados</h3>
        <table><tbody>
          {data.contactos.map((c) => (
            <tr key={c.id}><td>{c.nombre ?? "—"}</td><td>+{c.telefono}</td>
              <td className="num"><button onClick={() => toggle(c)}>{c.autorizado ? "Autorizado" : "Bloqueado"}</button></td></tr>
          ))}
        </tbody></table>
        <form className="mini" onSubmit={agregar}>
          <input name="nombre" placeholder="Nombre" />
          <input name="tel" placeholder="Teléfono (506...)" required />
          <button>Agregar</button>
        </form>
      </section>
      <section className="panel">
        <h3>Casos recientes</h3>
        <table><tbody>{data.casos.map((c) => <tr key={c.id}><td>{c.nivel} · {c.motivo.replaceAll("_", " ")}</td><td className="num">{c.estado}</td></tr>)}</tbody></table>
        {!data.casos.length && <p className="vacio">Sin casos.</p>}
      </section>
    </>
  );
}
