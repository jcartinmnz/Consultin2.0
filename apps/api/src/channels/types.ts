/** Mensaje entrante normalizado: lo que el agente necesita, sin importar el proveedor. */
export interface InboundMessage {
  canal: string;            // "whatsapp" | "dev"
  conversacionExtId: string;
  telefono: string;         // E.164 sin "+"
  nombrePerfil: string | null;
  texto: string;
  mensajeExtId: string;     // para deduplicar reintentos del webhook
}

export interface ChannelAdapter {
  readonly nombre: string;
  /** Valida firma y convierte el webhook en mensajes. Devuelve [] si el evento no es un mensaje de texto. */
  parseWebhook(req: Request): Promise<InboundMessage[]>;
  /** Envía una respuesta dentro de la conversación (ventana de 24 h de WhatsApp). */
  enviar(conversacionExtId: string, texto: string): Promise<void>;
}
