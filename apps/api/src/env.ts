export interface Env {
  // vars
  PRICES_SOURCE: "mock" | "neon";
  ORDERS_SOURCE: "mock" | "lensware";
  CHANNEL: "dev" | "zernio";
  /** Simulador del panel (/dev/*). "off" lo apaga. Independiente de CHANNEL. */
  SIMULADOR?: "on" | "off";
  /** URL del panel, a donde vuelve el usuario tras conectar una cuenta en Zernio. */
  PANEL_URL?: string;
  ANTHROPIC_MODEL: string;
  LAB_NAME: string;

  // secrets
  DATABASE_URL: string;
  ANTHROPIC_API_KEY: string;
  ZERNIO_API_KEY?: string;
  ZERNIO_WEBHOOK_SECRET?: string;
  ADMIN_API_KEY: string;
  /** Protege /tools/* si Forja (u otro orquestador) llama las herramientas por HTTP */
  TOOLS_API_KEY?: string;

  // bindings
  LENSWARE_DB?: Hyperdrive;
}

export type AppBindings = { Bindings: Env };
