/** Llamadas de administración a la API de Zernio (cuentas conectadas, enlaces de conexión). */
const BASE = "https://zernio.com/api/v1";

export interface CuentaZernio {
  id: string; plataforma: string; usuario: string | null; nombre: string | null;
  foto: string | null; activa: boolean; necesitaReconexion: boolean;
}

async function zget<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`Zernio ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

export async function listarCuentas(apiKey: string): Promise<CuentaZernio[]> {
  const [{ accounts }, numeros] = await Promise.all([
    zget<{ accounts: any[] }>(apiKey, "/accounts"),
    zget<{ sandbox?: { accountId: string; phoneNumber: string } }>(apiKey, "/phone-numbers").catch(() => ({ sandbox: undefined })),
  ]);
  const cuentas: CuentaZernio[] = accounts.map((a) => ({
    id: a._id, plataforma: a.platform, usuario: a.username ?? null, nombre: a.displayName ?? null,
    foto: a.profilePicture ?? null, activa: !!a.isActive && a.enabled !== false, necesitaReconexion: !!a.needsReconnection,
  }));
  // El sandbox de WhatsApp de Zernio no aparece en /accounts
  if (numeros.sandbox && !cuentas.some((c) => c.id === numeros.sandbox!.accountId)) {
    cuentas.push({
      id: numeros.sandbox.accountId, plataforma: "whatsapp", usuario: numeros.sandbox.phoneNumber,
      nombre: "Sandbox de WhatsApp (Zernio, pruebas)", foto: null, activa: true, necesitaReconexion: false,
    });
  }
  return cuentas;
}

/** URL de OAuth para conectar una cuenta nueva a Zernio; al terminar vuelve a `volverA`. */
export async function urlConectar(apiKey: string, plataforma: string, volverA: string): Promise<string> {
  const { profiles } = await zget<{ profiles: { _id: string }[] }>(apiKey, "/profiles");
  if (!profiles?.length) throw new Error("La cuenta de Zernio no tiene perfiles");
  const q = new URLSearchParams({ profileId: profiles[0]!._id, redirect_url: volverA });
  const { authUrl } = await zget<{ authUrl: string }>(apiKey, `/connect/${encodeURIComponent(plataforma)}?${q}`);
  return authUrl;
}
