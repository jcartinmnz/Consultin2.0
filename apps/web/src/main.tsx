import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { getKey, setKey } from "./api";
import { Dashboard } from "./pages/Dashboard";
import { Casos } from "./pages/Casos";
import { Opticas } from "./pages/Opticas";
import { Chats } from "./pages/Chats";
import { Configuracion } from "./pages/Configuracion";
import { Clientes } from "./pages/Clientes";
import { AgregarCliente } from "./pages/AgregarCliente";

type Vista = "chats" | "clientes" | "agregar" | "casos" | "dashboard" | "opticas" | "config";
const VISTAS: Record<Vista, string> = { chats: "Chats", clientes: "Clientes", agregar: "Agregar cliente", casos: "Casos", dashboard: "Dashboard", opticas: "Ópticas", config: "Ajustes" };

/**
 * Acceso rápido por enlace: https://<panel>/#clave=XXXX guarda la clave y la quita de la URL.
 * El fragmento (#) nunca se envía al servidor.
 */
function claveDesdeEnlace() {
  const m = location.hash.match(/clave=([^&]+)/);
  if (m) {
    setKey(decodeURIComponent(m[1]!));
    history.replaceState(null, "", location.pathname + location.search);
  }
}
claveDesdeEnlace();

function App() {
  const [vista, setVista] = useState<Vista>("chats");
  // Saltar de un chat al perfil del cliente y viceversa
  const [destino, setDestino] = useState<{ id: string; n: number } | null>(null);
  const ir = (v: Vista, id: string) => { setDestino({ id, n: Date.now() }); setVista(v); };
  const [key, setK] = useState(getKey());

  if (!key) {
    return (
      <div className="login">
        <h1>Consultin<span>2.0</span></h1>
        <form onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get("k")).trim(); setKey(v); setK(v); }}>
          <input name="k" type="password" placeholder="Clave de acceso" autoFocus autoComplete="current-password" />
          <button>Entrar</button>
        </form>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside>
        <div className="logo">Consultin<span>2.0</span></div>
        <nav>
          {(Object.keys(VISTAS) as Vista[]).map((v) => (
            <button key={v} className={vista === v ? "on" : ""} onClick={() => { setDestino(null); setVista(v); }}>{VISTAS[v]}</button>
          ))}
        </nav>
        <button className="salir" onClick={() => { setKey(""); setK(""); }}>Salir</button>
      </aside>
      <main className={`vista-${vista}`}>
        {vista === "chats" && <Chats key={destino?.n} inicial={destino?.id} onAbrirCliente={(id) => ir("clientes", id)} />}
        {vista === "clientes" && <Clientes key={destino?.n} inicial={destino?.id} onAbrirChat={(id) => ir("chats", id)} />}
        {vista === "agregar" && <AgregarCliente onCreado={(id) => ir("clientes", id)} />}
        {vista === "config" && <Configuracion />}
        {vista === "dashboard" && <Dashboard />}
        {vista === "casos" && <Casos />}
        {vista === "opticas" && <Opticas />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
