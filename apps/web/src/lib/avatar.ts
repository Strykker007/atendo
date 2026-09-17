/** Cor estável por contato (hash do telefone) — 8 tons que funcionam nos dois temas. */
const HUES = [14, 32, 152, 190, 215, 262, 292, 340];
export function avatarStyle(seed: string): React.CSSProperties {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = HUES[h % HUES.length];
  return { background: `hsl(${hue} 55% 45%)`, color: '#fff' };
}
export const initialOf = (name: string) => (name.trim()[0] ?? '?').toUpperCase();
