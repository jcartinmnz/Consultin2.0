/**
 * Empaqueta el build del panel (dist/) dentro de un Worker que sirve los archivos
 * desde memoria. Sirve para publicar sin la subida de assets de Pages
 * (útil en entornos donde esa subida está bloqueada).
 *
 *   VITE_API_URL=https://consultin-api.<cuenta>.workers.dev pnpm --filter web deploy:worker
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const raiz = new URL("..", import.meta.url).pathname;
const dist = join(raiz, "dist");
const salida = join(raiz, ".wrangler", "panel");

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json",
};

const archivos = {};
const recorrer = (dir) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { recorrer(p); continue; }
    const ruta = "/" + relative(dist, p).split("\\").join("/");
    archivos[ruta] = { tipo: TIPOS[extname(n)] ?? "application/octet-stream", b64: readFileSync(p).toString("base64") };
  }
};
recorrer(dist);
if (!archivos["/index.html"]) throw new Error("Falta dist/index.html: correr vite build primero");

const worker = `const ARCHIVOS = ${JSON.stringify(archivos)};
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export default {
  fetch(req) {
    const { pathname } = new URL(req.url);
    const f = ARCHIVOS[pathname] ?? ARCHIVOS["/index.html"]; // SPA: cualquier otra ruta sirve el panel
    const inmutable = pathname.startsWith("/assets/");
    return new Response(bytes(f.b64), { headers: {
      "content-type": f.tipo,
      "cache-control": inmutable ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    } });
  },
};
`;
mkdirSync(salida, { recursive: true });
writeFileSync(join(salida, "worker.js"), worker);
console.log(`Panel empaquetado: ${Object.keys(archivos).length} archivos → .wrangler/panel/worker.js`);
