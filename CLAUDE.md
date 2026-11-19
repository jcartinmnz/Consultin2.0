# Consultin 2.0 — Laboratorio Óptico Topex

Agente de WhatsApp que cotiza lentes y da el estado de órdenes de laboratorio (LensWare).
Servicio al cliente solo atiende los casos que el agente escala, desde un CRM propio con dashboard.
Cliente: Laboratorio Óptico Topex · Proveedor: Expertia · Entrega: viernes 4 de diciembre de 2026.

## Stack
- **API**: Cloudflare Workers + Hono + TypeScript (`apps/api`)
- **Panel (dashboard + CRM)**: Vite + React en Cloudflare Pages (`apps/web`)
- **DB**: Neon Postgres + Drizzle ORM (`apps/api/src/db/schema.ts`)
- **Modelo**: Anthropic API con tool calling (`apps/api/src/agent`)
- **WhatsApp**: Zernio (WhatsApp Cloud API de Meta) (`apps/api/src/channels/zernio.ts`)
- **LensWare**: MySQL on-prem en Topex → Cloudflare Tunnel + Hyperdrive (`apps/api/src/sources/orders/lensware.ts`)
- **Forja**: puede consumir las herramientas por HTTP en `/tools/*` (ver "Forja" abajo)

## Principio de arquitectura: adaptadores
El agente, las rutas y el CRM SOLO dependen de interfaces. Cada dato externo tiene un mock y una implementación real:

| Dato | Interfaz | Mock (default) | Real | Variable |
|---|---|---|---|---|
| Precios | `PriceSource` | `prices/mock.ts` (JSON) | `prices/neon.ts` (tabla `productos`) | `PRICES_SOURCE` |
| Órdenes | `OrderSource` | `orders/mock.ts` (JSON) | `orders/lensware.ts` (vista MySQL) | `ORDERS_SOURCE` |
| Canal | `ChannelAdapter` | `channels/dev.ts` (curl / simulador) | `channels/zernio.ts` | `CHANNEL` (+ `ZERNIO_ACCOUNT_IDS`) |

Para conectar un dato real: implementar la interfaz, registrarla en `sources/index.ts` o `channels/index.ts`, cambiar la variable en `wrangler.toml`. **No tocar el agente.**

## Flujo de un mensaje (`services/procesar.ts`)
1. Identificar óptica por teléfono (`contactos.telefono`, autorizado) → si no existe: caso N2 `numero_no_registrado`, sin LLM.
2. Upsert conversación + guardar mensaje (idempotente por `externalId`).
3. Si la conversación está en estado `humano` → el bot NO responde.
4. Regla determinista "pide hablar con una persona" → caso N2, sin LLM.
5. Agente (`agent/run.ts`): loop de tool calling, máx. 6 iteraciones.
6. Guardar respuesta, enviar por el canal, registrar eventos (alimentan el dashboard).

## Reglas que NO se rompen
- Precios, estados y fechas **solo** salen de herramientas. El prompt lo exige y el código nunca deja que el modelo los genere.
- Una óptica **solo** ve sus órdenes: `estado_orden` compara `codigoCliente` contra la óptica identificada por teléfono. La identidad nunca viene del modelo ni del texto del usuario.
- Nunca exponer recetas, nombres de pacientes ni datos clínicos (Ley 8968). La vista de LensWare no debe incluirlos.
- Acceso a LensWare **solo lectura** (usuario MySQL con `SELECT` sobre una vista).
- Todo endpoint que acepte un teléfono como identidad debe estar autenticado: el webhook de Zernio exige firma HMAC (`ZERNIO_WEBHOOK_SECRET` obligatorio) y `/dev/*`, `/crm/*`, `/metrics/*` y `/tools/*` exigen clave. Comparar secretos solo con `lib/seguridad.ts`.
- Cualquier escalamiento crea un caso en `casos` y pone la conversación en `humano`. Al resolver el caso vuelve a `bot`. Máximo un caso abierto por conversación (índice único parcial `casos_conv_abierto_uq`).

## Comandos
```bash
pnpm install
pnpm --filter api dev          # wrangler dev en :8787 (lee apps/api/.dev.vars)
pnpm --filter web dev          # panel en :5173
pnpm test                      # vitest (api)
pnpm typecheck
pnpm --filter api db:generate  # migración desde schema.ts
pnpm --filter api db:migrate
pnpm --filter api db:seed      # 2 ópticas demo + precios mock
```

Probar el agente sin WhatsApp (`CHANNEL=dev`):
```bash
curl -X POST localhost:8787/dev/chat -H 'content-type: application/json' \
  -H "authorization: Bearer $ADMIN_API_KEY" \
  -d '{"telefono":"50688880001","texto":"cuánto sale un progresivo 1.67 con AR?"}'
```
Teléfonos demo: `50688880001` (OPT001, órdenes 48213/48214/48190) y `50688880002` (OPT002, 48220 en HOLD y 48105 atrasada).

## Pendientes que dependen de Topex / proveedores (marcados con TODO en el código)
- [ ] `sources/orders/estados.ts`: tabla real de códigos de estado de LensWare.
- [ ] `sources/orders/lensware.ts`: el lab crea la vista `v_consultin_ordenes` con las columnas documentadas en el archivo.
- [ ] Lista de precios real → `scripts/import-precios.ts` (ajustar `MAPEO` al Excel de Topex).
- [x] `channels/zernio.ts`: formato confirmado contra la OpenAPI de Zernio (firma, `message.received`, respuesta).
- [ ] Conectar el número de WhatsApp de Topex en Zernio (hoy se usa el sandbox compartido) y poner su `accountId` en `ZERNIO_ACCOUNT_IDS` y en el webhook.
- [ ] Definir si el loop del agente corre aquí (default) o en Forja.

## Forja
Si el agente se orquesta en Forja en lugar de `agent/run.ts`:
- `GET /tools` devuelve las definiciones (JSON Schema) para registrarlas como herramientas en Forja.
- `POST /tools/:name` con `{ telefono, input, conversacionExtId? }` y `Authorization: Bearer $TOOLS_API_KEY`.
- La identidad se resuelve por `telefono` en el servidor: Forja no puede pedir órdenes de otra óptica.
- El CRM y el dashboard siguen funcionando porque `/tools` registra eventos y crea casos igual.

## Convenciones
- Código y nombres de dominio en español (óptica, orden, caso); términos técnicos en inglés.
- Teléfonos en E.164 sin "+" (`50688887777`).
- Montos en colones (CRC), formato `₡45 000` en mensajes.
- Tests en `apps/api/test`. Toda herramienta nueva necesita test de seguridad (acceso entre ópticas).
- No hacer commit de `.dev.vars`. Secrets con `wrangler secret put`.
