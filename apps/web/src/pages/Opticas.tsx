import { useState } from "react";
import { api, type Caso, type Optica } from "../api";
import { useApi } from "../useApi";

interface Contacto { id: string; nombre: string | null; telefono: string; autorizado: boolean }
interface FichaOptica { optica: Optica; contactos: Contacto[]; casos: Caso[]; conversaciones: { id: string; telefono: string; estado: string; lastMessageAt: string }[] }

export function Opticas() {
  const lista = useApi<Optica[]>("/crm/opticas");
  const [sel, setSel] = useState<string | null>(null);

  const crear = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await api("/crm/opticas", { method: "POST", body: JSON.stringify({ nombre: f.get("nombre"), codigoLensware: f.get("codigo") }) });
    e.currentTarget.reset(); lista.recargar();
  };

  return (
    <div className={`casos ${sel ? "con-detalle" : ""}`}>
      <div className="lista">
        <header className="top"><h2>Ópticas</h2></header>
        <form className="mini" onSubmit={crear}>
          <input name="nombre" placeholder="Nombre de la óptica" required />
          <input name="codigo" placeholder="Código en LensWare" required />
          <button>Agregar</button>
        </form>
        {lista.data?.map((o) => (
          <button key={o.id} className={`item ${sel === o.id ? "on" : ""}`} onClick={() => setSel(o.id)}>
            <strong>{o.nombre}</strong><small>{o.codigoLensware}</small>
          </button>
        ))}
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
      <header className="top"><h2>{data.optica.nombre}</h2><span className="tag">{data.optica.codigoLensware}</span></header>
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
