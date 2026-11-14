const enc = new TextEncoder();

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/**
 * Compara dos secretos en tiempo constante. Se comparan los hashes para que
 * ni el contenido ni la longitud del secreto se filtren por tiempo de respuesta.
 */
export async function igualesSeguro(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let r = 0;
  for (let i = 0; i < ha.length; i++) r |= ha[i]! ^ hb[i]!;
  return r === 0;
}

/** HMAC-SHA256 en hex. */
export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
