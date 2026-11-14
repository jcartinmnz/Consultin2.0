import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const recargar = useCallback(async () => {
    if (!path) return;
    setCargando(true);
    try { setData(await api<T>(path)); setError(null); }
    catch (e) { setError(String(e)); }
    finally { setCargando(false); }
  }, [path]);

  useEffect(() => { void recargar(); }, [recargar]);
  return { data, error, cargando, recargar };
}
