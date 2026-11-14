# Consultin 2.0

Agente de IA en WhatsApp para **Laboratorio Óptico Topex**: cotizaciones, seguimiento de órdenes de LensWare, CRM de servicio al cliente y dashboard. Hecho por Expertia.

```
WhatsApp ─▶ Zernio ─▶ /webhooks/zernio ─▶ procesarMensaje ─▶ Agente (Claude + tools)
                                                         ├─▶ PriceSource  (mock │ Neon)
                                                         ├─▶ OrderSource  (mock │ LensWare MySQL)
                                                         └─▶ casos / eventos (Neon) ─▶ Panel web (CRM + dashboard)
```

## Arranque rápido (todo en mock)

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # completar DATABASE_URL y ANTHROPIC_API_KEY
pnpm --filter api db:generate && pnpm --filter api db:migrate && pnpm --filter api db:seed
pnpm --filter api dev
```

En otra terminal:
```bash
curl -X POST localhost:8787/dev/chat -H 'content-type: application/json' \
  -d '{"telefono":"50688880001","texto":"cómo va la orden 48213?"}'

cp apps/web/.env.example apps/web/.env && pnpm --filter web dev   # clave = ADMIN_API_KEY
```

## Pasar de mock a datos reales

### 1. Lista de precios → Neon
```bash
DATABASE_URL=... pnpm --filter api exec tsx scripts/import-precios.ts ./precios-topex.csv
```
Cambiar `PRICES_SOURCE = "neon"` en `apps/api/wrangler.toml`.

### 2. LensWare → Hyperdrive
1. Topex crea el usuario de solo lectura y la vista `v_consultin_ordenes` (SQL en `src/sources/orders/lensware.ts`).
2. Instalar `cloudflared` en un equipo de la red de Topex y crear un túnel hacia el MySQL (puerto 3306). Nunca abrir el puerto a internet.
3. Crear el Hyperdrive apuntando al túnel:
   ```bash
   npx wrangler hyperdrive create lensware --connection-string="mysql://consultin_ro:CLAVE@<host-del-tunel>:3306/lensware"
   ```
4. Descomentar el bloque `[[hyperdrive]]` en `wrangler.toml` con el id, y poner `ORDERS_SOURCE = "lensware"`.
5. Llenar `src/sources/orders/estados.ts` con los códigos reales.

### 3. WhatsApp → Zernio
1. Conectar el número de Topex en Zernio (Embedded Signup, modo Cloud API).
2. Revisar los 3 `TODO` de `src/channels/zernio.ts` contra la documentación de Zernio.
3. Configurar el webhook de Zernio a `https://<worker>/webhooks/zernio`.
4. `wrangler secret put ZERNIO_API_KEY` y `ZERNIO_WEBHOOK_SECRET`, luego `CHANNEL = "zernio"`.

## Deploy
```bash
cd apps/api
wrangler secret put DATABASE_URL
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put ADMIN_API_KEY
pnpm deploy

cd ../web
VITE_API_URL=https://consultin-api.<cuenta>.workers.dev pnpm deploy
```

## Endpoints

| Método | Ruta | Auth | Uso |
|---|---|---|---|
| POST | `/webhooks/zernio` | firma Zernio | Mensajes entrantes de WhatsApp |
| POST | `/dev/chat` | — (solo `CHANNEL=dev`) | Probar el agente con curl |
| GET | `/crm/casos?estado=` | `ADMIN_API_KEY` | Bandeja de casos |
| GET/PATCH | `/crm/casos/:id` | `ADMIN_API_KEY` | Detalle y cambio de estado |
| POST | `/crm/casos/:id/responder` | `ADMIN_API_KEY` | Responder por WhatsApp desde el CRM |
| POST | `/crm/casos/:id/notas` | `ADMIN_API_KEY` | Nota interna |
| GET/POST | `/crm/opticas` · `/crm/opticas/:id/contactos` | `ADMIN_API_KEY` | Ópticas y números autorizados |
| GET | `/metrics/resumen?dias=30` | `ADMIN_API_KEY` | Dashboard |
| GET/POST | `/tools` · `/tools/:name` | `TOOLS_API_KEY` | Herramientas para Forja |
