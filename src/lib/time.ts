/** Formatta secondi come H:MM:SS (per il timer live). */
export function fmtClock(totalSecs: number): string {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Formatta secondi come ore:minuti totali, es. "225:26" (stile Timemator). */
export function fmtHM(totalSecs: number): string {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Formatta secondi in modo compatto: "2h 05m" oppure "12m". */
export function fmtDuration(totalSecs: number): string {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.round((totalSecs % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function fmtCost(
  amount: number,
  currency: string,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Epoch secondi dell'inizio del giorno locale della data data. */
export function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return Math.floor(x.getTime() / 1000);
}

export function startOfWeek(d: Date): number {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // lunedì = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return Math.floor(x.getTime() / 1000);
}

export function startOfMonth(d: Date): number {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  return Math.floor(x.getTime() / 1000);
}

/** Chiave YYYY-MM-DD nel fuso locale per un epoch in secondi. */
export function dayKey(epochSecs: number): string {
  const d = new Date(epochSecs * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Tutte le chiavi-giorno tra due epoch (inclusi). */
export function dayKeysBetween(fromSecs: number, toSecs: number): string[] {
  const keys: string[] = [];
  const d = new Date(fromSecs * 1000);
  d.setHours(0, 0, 0, 0);
  while (Math.floor(d.getTime() / 1000) <= toSecs) {
    keys.push(dayKey(Math.floor(d.getTime() / 1000)));
    d.setDate(d.getDate() + 1);
  }
  return keys;
}

export function fmtDayLabel(key: string, locale: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}

export function fmtDateTime(epochSecs: number, locale: string): string {
  return new Date(epochSecs * 1000).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
