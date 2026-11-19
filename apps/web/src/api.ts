const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export const getKey = () => localStorage.getItem("consultin_key") ?? "";
export const setKey = (k: string) => localStorage.setItem("consultin_key", k);

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getKey()}`, ...init.headers },
  });
  if (res.status === 401) {
    // Clave vencida o incorrecta: volver al login
    setKey("");
    location.reload();
    throw new Error("401");
  }
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/* Tipos mínimos de la API */
export type EstadoCaso = "nuevo" | "en_atencion" | "en_espera" | "resuelto";
export interface Caso {
  id: string; conversacionId: string; opticaId: string | null; nivel: "N2" | "N3";
  motivo: string; resumen: string; estado: EstadoCaso; asignadoA: string | null; createdAt: string;
}
export interface Mensaje { id: string; rol: "cliente" | "bot" | "agente"; contenido: string; autor: string | null; createdAt: string }
export interface Nota { id: string; autor: string; texto: string; createdAt: string }
export interface Optica { id: string; nombre: string; codigoLensware: string; activa: boolean }
