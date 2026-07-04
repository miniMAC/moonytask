// Palette categorica validata (dataviz skill, light mode).
// L'ordine degli slot è il meccanismo di sicurezza CVD: non riordinare.
export const PROJECT_COLORS = [
  "#2a78d6", // blue
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
  "#e87ba4", // magenta
  "#eb6834", // orange
];

/** Colore del progetto: quello scelto dall'utente o uno stabile derivato dall'id. */
export function projectColor(color: string | null, id: string): string {
  if (color) return color;
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PROJECT_COLORS[hash % PROJECT_COLORS.length];
}

/** Versione più satura e luminosa del colore, per i pulsanti (non per i grafici). */
export function vividColor(hex: string): string {
  const match = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s2 = Math.min(1, s * 1.3 + 0.08);
  const l2 = Math.min(0.62, Math.max(0.5, l * 1.12));
  return `hsl(${Math.round(h)} ${Math.round(s2 * 100)}% ${Math.round(l2 * 100)}%)`;
}
