/** Interpreta *negrita* de WhatsApp para mostrar los mensajes como los ve la óptica. */
export function Formato({ texto }: { texto: string }) {
  return <>{texto.split(/(\*[^*\n]+\*)/g).map((p, i) => (p.length > 2 && p.startsWith("*") && p.endsWith("*") ? <strong key={i}>{p.slice(1, -1)}</strong> : p))}</>;
}
