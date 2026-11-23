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
  -H "authorization: Bearer $ADMIN_API_KEY" \
  -d '{"telefono":"50688880001","texto":"cómo va la orden 48213?"}'

cp apps/web/.env.example apps/web/.env && pnpm --filter web dev   # clave = ADMIN_API_KEY
```

## Pasar de mock a datos reales

### 1. Lista de precios → Neon (hecho)
La lista se normaliza a un CSV con una fila por producto y se carga en la tabla `productos`:
```bash
DATABASE_URL=... pnpm --filter api exec tsx scripts/import-precios.ts ./lista-precios-topex.csv --reemplazar
```
Columnas y reglas en `scripts/import-precios.ts`. `--reemplazar` desactiva lo que ya no viene en el archivo.
El agente la consulta con `buscar_precio` (no va en el prompt). **El repo es público: el CSV no se sube a git.**

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
El adaptador (`src/channels/zernio.ts`) ya sigue el formato real de Zernio: evento `message.received`
firmado con `X-Zernio-Signature` (HMAC-SHA256 hex del cuerpo) y respuesta con
`POST /v1/inbox/conversations/{id}/messages` `{ accountId, message }`. Solo procesa texto entrante de WhatsApp
de las cuentas en `ZERNIO_ACCOUNT_IDS` (otras cuentas del mismo Zernio, como Instagram, se ignoran).

1. Secrets: `wrangler secret put ZERNIO_API_KEY` y `ZERNIO_WEBHOOK_SECRET` (lo generamos nosotros; Zernio firma con él).
2. En `wrangler.toml`: `CHANNEL = "zernio"`. Las cuentas atendidas se eligen en panel → Ajustes → Conexiones.
3. Webhook en Zernio: `POST /v1/webhooks/settings` con `url=https://<worker>/webhooks/zernio`,
   `events=["message.received"]`, el mismo `secret` y `accountIds` = la cuenta de WhatsApp.
4. **Hoy**: apunta al sandbox compartido de Zernio (`GET /v1/phone-numbers` → `sandbox`), gratis, 1 teléfono de prueba,
   7 días. Activar el teléfono: `POST /v1/whatsapp/sandbox/sessions {"phone":"+506..."}` y responder el WhatsApp que llega.
   Ese teléfono debe estar registrado como contacto de una óptica (panel → Ópticas) para que el agente lo identifique.
5. **Producción (hecho)**: el número de Topex +506 4600 9765 está conectado en Zernio y dado de alta en
   panel → Ajustes → Conexiones (modo solo ópticas). Qué cuentas se atienden se decide ahí, no en variables.

El simulador del panel sigue funcionando con `CHANNEL=zernio` (usa su propio canal `dev`; `SIMULADOR=off` lo apaga).
El webhook solo se activa con `CHANNEL=zernio`.

## Panel

https://consultin-web.expertia-cr.workers.dev — entrar con `ADMIN_API_KEY`
(atajo: `/#clave=<ADMIN_API_KEY>`; el `#` no se envía al servidor y la clave se borra de la URL).

- **Chats**: todas las conversaciones de las cuentas conectadas (WhatsApp, Instagram, Messenger), con lo que escribe
  la persona y lo que responde el agente. Interruptor **Agente activo / apagado** por conversación; con el agente apagado
  solo responde el equipo desde el panel. Escalar o abrir un caso también apaga el agente; resolver el caso lo enciende.
- **Clientes**: perfil de cada óptica y de cada persona que escribe: datos editables, compras (registro manual con buscador de la lista de precios), consultas al agente con lo que se cotizó, órdenes de laboratorio (ópticas) y métricas.
- **Agregar cliente**: alta manual de ópticas (datos, códigos SAP/MAC/LensWare, ruta y WhatsApp autorizados) o de personas/prospectos. Valida números de Costa Rica, números que ya son de otra óptica, código LensWare repetido y nombres duplicados.
- **Casos**: lo que el agente pasó a una persona.
- **Ajustes**:
  - *Mensajes seguidos*: segundos que el agente espera para juntar varios mensajes y responder una sola vez (0 = responde cada uno).
  - *Prompt base*: instrucciones del agente, editables. Las reglas de seguridad, la fecha, el canal y quién escribe
    las agrega siempre el código (`agent/prompt.ts` → `REGLAS_FIJAS`) y no se pueden borrar desde el panel.
  - *Conexiones*: cuentas de Zernio que atiende Consultin. Cada una tiene modo y, opcionalmente, prompt propio:
    Las ópticas registradas siempre reciben precios y sus órdenes. El modo decide qué pasa con los demás:
    - **Solo ópticas**: los no registrados reciben aviso y pasan a una persona.
    - **Todos, con precios**: los no registrados cotizan con la lista; nunca ven órdenes. (WhatsApp de Topex)
    - **Todos, sin precios**: los no registrados solo pueden pasar a una persona. (Instagram de Expertia)
    - "+ Instagram / WhatsApp / Messenger" abre el OAuth de Zernio para conectar una cuenta nueva.
    - Quitar una conexión solo hace que Consultin deje de atenderla; no desconecta nada en Zernio.

## Deploy
```bash
cd apps/api
wrangler secret put DATABASE_URL
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put ADMIN_API_KEY
pnpm deploy

cd ../web
VITE_API_URL=https://consultin-api.<cuenta>.workers.dev pnpm deploy          # Cloudflare Pages
# o, si la subida de Pages no está disponible, como Worker con los archivos embebidos:
VITE_API_URL=https://consultin-api.<cuenta>.workers.dev pnpm deploy:worker   # → consultin-web.<cuenta>.workers.dev
```

## Endpoints

| Método | Ruta | Auth | Uso |
|---|---|---|---|
| POST | `/webhooks/zernio` | firma Zernio | Mensajes entrantes de WhatsApp |
| POST | `/dev/chat` | `ADMIN_API_KEY` (solo `CHANNEL=dev`) | Probar el agente (curl o simulador del panel) |
| GET | `/dev/conversacion?telefono=&sesion=` · `/dev/contactos` | `ADMIN_API_KEY` (solo `CHANNEL=dev`) | Simulador del panel |
| GET | `/crm/casos?estado=` | `ADMIN_API_KEY` | Bandeja de casos |
| GET/PATCH | `/crm/casos/:id` | `ADMIN_API_KEY` | Detalle y cambio de estado |
| POST | `/crm/casos/:id/responder` | `ADMIN_API_KEY` | Responder por WhatsApp desde el CRM |
| POST | `/crm/casos/:id/notas` | `ADMIN_API_KEY` | Nota interna |
| GET/POST | `/crm/opticas` · `/crm/opticas/:id/contactos` | `ADMIN_API_KEY` | Ópticas y números autorizados |
| GET | `/metrics/resumen?dias=30` | `ADMIN_API_KEY` | Dashboard |
| GET/POST | `/tools` · `/tools/:name` | `TOOLS_API_KEY` | Herramientas para Forja |
