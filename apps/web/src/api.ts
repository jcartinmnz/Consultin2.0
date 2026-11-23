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
export interface Optica { id: string; nombre: string; codigoLensware: string | null; codigoSap: string | null; codigoMac: string | null; razonSocial: string | null; ruta: string | null; activa: boolean }

export type Plataforma = "whatsapp" | "instagram" | "facebook" | string;
export interface FilaChat {
  id: string; canal: string; plataforma: Plataforma | null; estado: "bot" | "humano" | "cerrada";
  telefono: string | null; participanteNombre: string | null; optica: string | null; cuenta: string | null;
  lastMessageAt: string; ultimo: string | null; ultimoRol: Mensaje["rol"] | null; casoAbierto: boolean;
}
export interface DetalleChat {
  conversacion: { id: string; canal: string; plataforma: string | null; estado: FilaChat["estado"]; telefono: string | null; participanteNombre: string | null; clienteId: string | null };
  optica: Optica | null; mensajes: Mensaje[]; caso: Caso | null;
}

/** Nombre a mostrar de quien escribe: óptica, nombre/@usuario de Instagram o teléfono. */
export const nombreChat = (c: { optica?: string | null; participanteNombre?: string | null; telefono?: string | null }) =>
  c.optica ?? c.participanteNombre ?? (c.telefono ? `+${c.telefono}` : "Sin nombre");

export const PLATAFORMAS: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger", forja: "Forja" };
