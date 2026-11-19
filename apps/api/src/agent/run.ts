import type Anthropic from "@anthropic-ai/sdk";
import { TOOLS, ejecutarTool, type ToolContext } from "./tools";

/** Solo lo que usamos del SDK: permite inyectar un cliente falso en tests. */
export interface LlmClient {
  messages: { create(p: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Messages.Message> };
}

export interface Turno { rol: "cliente" | "bot" | "agente"; contenido: string }

export interface ToolCallLog { tool: string; ok: boolean; latenciaMs: number; input: unknown }

export interface AgentResult {
  texto: string;
  escalado: boolean;
  toolCalls: ToolCallLog[];
  usage: { input: number; output: number };
}

const MAX_ITERACIONES = 6;

export async function correrAgente(opts: {
  llm: LlmClient;
  model: string;
  system: string;
  historial: Turno[];
  ctx: ToolContext;
  /** Herramientas ofrecidas al modelo (default: todas). */
  tools?: Anthropic.Messages.Tool[];
}): Promise<AgentResult> {
  const messages = aMensajes(opts.historial);
  const toolCalls: ToolCallLog[] = [];
  const usage = { input: 0, output: 0 };
  let escalado = false;

  for (let i = 0; i < MAX_ITERACIONES; i++) {
    const res = await opts.llm.messages.create({
      model: opts.model,
      max_tokens: 1024,
      system: opts.system,
      tools: opts.tools ?? TOOLS,
      messages,
    });
    usage.input += res.usage.input_tokens;
    usage.output += res.usage.output_tokens;

    if (res.stop_reason !== "tool_use") {
      const texto = res.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.Messages.TextBlock).text).join("\n").trim();
      return { texto, escalado, toolCalls, usage };
    }

    messages.push({ role: "assistant", content: res.content });
    const resultados: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const b of res.content) {
      if (b.type !== "tool_use") continue;
      const t0 = Date.now();
      if (!(opts.tools ?? TOOLS).some((t) => t.name === b.name)) {
        // El modelo pidió una herramienta que no se le ofreció en esta conversación
        toolCalls.push({ tool: b.name, ok: false, latenciaMs: 0, input: b.input });
        resultados.push({ type: "tool_result", tool_use_id: b.id, is_error: true, content: JSON.stringify({ error: "Herramienta no disponible en esta conversación." }) });
        continue;
      }
      try {
        const r = await ejecutarTool(b.name, b.input, opts.ctx);
        if (r.escalado) escalado = true;
        toolCalls.push({ tool: b.name, ok: r.ok, latenciaMs: Date.now() - t0, input: b.input });
        resultados.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(r.data), is_error: !r.ok });
      } catch (err) {
        toolCalls.push({ tool: b.name, ok: false, latenciaMs: Date.now() - t0, input: b.input });
        resultados.push({
          type: "tool_result", tool_use_id: b.id, is_error: true,
          content: JSON.stringify({ error: "La consulta falló. No inventes el dato: ofrecé escalar a una persona." }),
        });
        console.error(`[tool:${b.name}]`, err);
      }
    }
    messages.push({ role: "user", content: resultados });
  }

  return {
    texto: "Disculpe, no logré completar la consulta. Ya avisé a una persona del equipo para que le ayude.",
    escalado, toolCalls, usage,
  };
}

/** Convierte el historial guardado al formato de la API, fusionando turnos consecutivos del mismo rol. */
export function aMensajes(historial: Turno[]): Anthropic.Messages.MessageParam[] {
  const out: Anthropic.Messages.MessageParam[] = [];
  for (const t of historial) {
    const role = t.rol === "cliente" ? "user" : "assistant";
    const contenido = t.rol === "agente" ? `[Respuesta de una persona del equipo] ${t.contenido}` : t.contenido;
    const prev = out[out.length - 1];
    if (prev && prev.role === role && typeof prev.content === "string") prev.content += `\n${contenido}`;
    else out.push({ role, content: contenido });
  }
  while (out[0]?.role === "assistant") out.shift(); // la API exige empezar con user
  return out;
}
