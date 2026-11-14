import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { getKey, setKey } from "./api";
import { Dashboard } from "./pages/Dashboard";
import { Casos } from "./pages/Casos";
import { Opticas } from "./pages/Opticas";

type Vista = "dashboard" | "casos" | "opticas";

function App() {
  const [vista, setVista] = useState<Vista>("casos");
  const [key, setK] = useState(getKey());

  if (!key) {
    return (
      <div className="login">
        <h1>Consultin<span>2.0</span></h1>
        <form onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get("k") as string; setKey(v); setK(v); }}>
          <input name="k" type="password" placeholder="Clave de acceso" autoFocus />
          <button>Entrar</button>
        </form>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside>
        <div className="logo">Consultin<span>2.0</span></div>
        {(["casos", "dashboard", "opticas"] as Vista[]).map((v) => (
          <button key={v} className={vista === v ? "on" : ""} onClick={() => setVista(v)}>
            {{ casos: "Casos", dashboard: "Dashboard", opticas: "Ópticas" }[v]}
          </button>
        ))}
        <button className="salir" onClick={() => { setKey(""); setK(""); }}>Salir</button>
      </aside>
      <main>
        {vista === "dashboard" && <Dashboard />}
        {vista === "casos" && <Casos />}
        {vista === "opticas" && <Opticas />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
