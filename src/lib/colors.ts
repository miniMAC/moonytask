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
