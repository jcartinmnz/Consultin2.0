import type { ChannelAdapter, InboundMessage } from "./types";

/**
 * Canal de desarrollo: permite probar el agente completo con curl, sin WhatsApp.
 * Las respuestas se guardan en memoria y las devuelve POST /dev/chat.
 */
export class DevChannel implements ChannelAdapter {
  readonly nombre = "dev";
  readonly salida: string[] = [];

  async parseWebhook(req: Request): Promise<InboundMessage[]> {
    const b = (await req.json()) as { telefono: string; texto: string; nombre?: string; sesion?: string };
    return [{
      canal: "dev",
      conversacionExtId: devConversacionId(b.telefono, b.sesion),
      telefono: b.telefono.replace(/\D/g, ""),
      nombrePerfil: b.nombre ?? null,
      texto: b.texto,
      mensajeExtId: crypto.randomUUID(),
    }];
  }

  async enviar(_conv: string, texto: string) {
    this.salida.push(texto);
  }
}

/** Cada sesión del simulador es una conversación nueva; sin sesión se usa una por teléfono. */
export function devConversacionId(telefono: string, sesion?: string | null): string {
  const tel = String(telefono).replace(/\D/g, "");
  const ses = sesion && /^[a-z0-9-]{1,40}$/i.test(sesion) ? `-${sesion}` : "";
  return `dev-${tel}${ses}`;
}
