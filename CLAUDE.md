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
| Canal | `ChannelAdapter` | `channels/dev.ts` (curl) | `channels/zernio.ts` | `CHANNEL` (+ tabla `conexiones`) |

Para conectar un dato real: implementar la interfaz, registrarla en `sources/index.ts` o `channels/index.ts`, cambiar la variable en `wrangler.toml`. **No tocar el agente.**

## Flujo de un mensaje (`routes/webhooks.ts` → `services/procesar.ts`)
0. El webhook solo atiende cuentas de Zernio dadas de alta y activas en la tabla `conexiones` (panel → Ajustes). Cada conexión tiene `modo` (`opticas` | `abierto` | `precios`) y `prompt` opcional.
1. Identificar óptica por teléfono de WhatsApp (`contactos.telefono`, autorizado). Instagram/Messenger no traen teléfono → nunca hay óptica identificada. Una óptica identificada recibe todas las herramientas en cualquier modo; el modo decide qué pasa con quien NO está registrado:
   - `opticas`: caso N2 `numero_no_registrado`, sin LLM.
   - `abierto`: el agente atiende solo con `escalar_a_humano` (`toolsPara(false)`). Instagram de Expertia.
   - `precios`: el agente atiende con `buscar_precio` + `escalar_a_humano` (`toolsPara(false, true)`, `preciosSinIdentidad`). **Nunca `estado_orden`**. WhatsApp de Topex (decisión de Expertia, 23 nov 2026).
2. Upsert conversación + guardar mensaje (idempotente por `externalId`).
3. Si la conversación está en estado `humano` → el bot NO responde.
   - Ráfaga: espera `espera_segundos` (panel → Ajustes, default 6, máx. 15). Si durante la espera llegó otro mensaje del cliente, este termina y responde el último, una sola vez, con el historial completo. Si apagaron el agente durante la espera, no responde.
4. Regla determinista "pide hablar con una persona" (en cualquier mensaje de la ráfaga) → caso N2, sin LLM.
5. Agente (`agent/run.ts`): loop de tool calling, máx. 6 iteraciones. Prompt = instrucciones editables (prompt de la conexión, o `configuracion.prompt_base`, o `PROMPT_BASE_DEFAULT`) + contexto + `REGLAS_FIJAS`.
6. Enviar por el canal y, solo si salió, guardar la respuesta y registrar eventos. Si el envío falla: caso con el texto que no salió.

## Perfil de cliente (panel → Clientes, `routes/clientes.ts`)
- Tabla `clientes`: una por óptica (`opticaId` único) y una "persona" por conversación sin óptica (Instagram, Messenger, WhatsApp no registrado), creada con el primer mensaje (`repo.asegurarCliente`). `conversaciones.clienteId` las liga.
- `compras`: registro manual desde el perfil (no hay fuente de ventas real todavía); el total se calcula en el servidor.
- Consultas = eventos `tool_call` de `buscar_precio`/`estado_orden` con `metadata.resultado` (resumen de lo cotizado, `resumirResultado`).
- Alta manual: `POST /crm/clientes` (óptica o persona). Una persona con teléfono queda ligada a las conversaciones de WhatsApp de ese número (`asegurarCliente`), pero sigue sin acceso a precios ni órdenes: eso solo lo da ser contacto autorizado de una óptica.
- Teléfonos: `lib/telefono.ts` (`normalizarTelefono`) valida números de Costa Rica.
- No guardar datos clínicos en `clientes.notas` (Ley 8968).

## Reglas que NO se rompen
- Precios, estados y fechas **solo** salen de herramientas. El prompt lo exige y el código nunca deja que el modelo los genere. La lista de precios vive en la tabla `productos` y se consulta con `buscar_precio`; nunca se inyecta en el prompt.
- Una óptica **solo** ve sus órdenes: `estado_orden` compara `codigoCliente` contra la óptica identificada por teléfono; si la óptica no tiene `codigoLensware`, no devuelve órdenes. La identidad nunca viene del modelo, del texto ni del nombre de perfil (un usuario de Instagram puede llamarse como una óptica).
- Las reglas de seguridad del prompt viven en el código (`REGLAS_FIJAS`), no en el prompt editable.
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

Probar el agente sin WhatsApp (`/dev/chat`, requiere `SIMULADOR = "on"` en `wrangler.toml`; en producción está en `off`):
```bash
curl -X POST localhost:8787/dev/chat -H 'content-type: application/json' \
  -H "authorization: Bearer $ADMIN_API_KEY" \
  -d '{"telefono":"50688880001","texto":"cuánto sale un progresivo 1.67 con AR?"}'
```
Teléfonos demo: `50688880001` (OPT001, órdenes 48213/48214/48190) y `50688880002` (OPT002, 48220 en HOLD y 48105 atrasada).

## Pendientes que dependen de Topex / proveedores (marcados con TODO en el código)
- [ ] `sources/orders/estados.ts`: tabla real de códigos de estado de LensWare.
- [ ] `sources/orders/lensware.ts`: el lab crea la vista `v_consultin_ordenes` con las columnas documentadas en el archivo.
- [x] Lista de precios real cargada en Neon (514 productos, `PRICES_SOURCE = "neon"`). Se actualiza con `scripts/import-precios.ts <csv> --reemplazar`. **El repo es público: el CSV con precios nunca se sube** (`.gitignore`); lo guarda Expertia.
- [x] `channels/zernio.ts`: formato confirmado contra la OpenAPI de Zernio (firma, `message.received`, respuesta).
- [x] WhatsApp de Topex +506 4600 9765 conectado en Zernio (cuenta `6b04a0263fd0353f177b0829`) y dado de alta en `conexiones` en modo `precios` (no registrados cotizan; órdenes solo ópticas). El webhook de Zernio recibe todas las cuentas; Consultin filtra por `conexiones`.
- [x] Base de ópticas de Topex importada: 382 ópticas (por ruta, con SAP/MAC/razón social) y 378 números autorizados (`scripts/import-opticas.ts <csv>`; el CSV trae datos personales y **no se sube**).
- [ ] Confirmar con Topex qué código usa LensWare por óptica (¿SAP, MAC u otro?) y cargarlo en `opticas.codigo_lensware`. Sin código, `estado_orden` no da órdenes y ofrece escalar.
- [ ] Revisar con Topex los 14 números compartidos entre sucursales (quedaron en la primera) y las 90 ópticas sin WhatsApp.
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
