import type { ChannelAdapter, InboundMessage } from "./types";

/**
 * Canal de desarrollo: permite probar el agente completo con curl, sin WhatsApp.
 * Las respuestas se guardan en memoria y las devuelve POST /dev/chat.
 */
export class DevChannel implements ChannelAdapter {
  readonly nombre = "dev";
  readonly salida: string[] = [];

  async parseWebhook(req: Request): Promise<InboundMessage[]> {
    const b = (await req.json()) as { telefono: string; texto: string; nombre?: string };
    return [{
      canal: "dev",
      conversacionExtId: `dev-${b.telefono}`,
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
