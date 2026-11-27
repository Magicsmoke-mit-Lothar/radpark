/**
 * Preisberechnung – bewusst eine "reine Funktion": gleiche Eingabe → gleiches Ergebnis,
 * keine Datenbank, keine Uhr. Dadurch lässt sie sich leicht testen (siehe pricing.test.ts).
 *
 * Regeln (MVP):
 *  - Die ersten FREE_MINUTES sind kostenlos (z. B. falsch eingestellt und sofort wieder raus)
 *  - Danach zählt jede ANGEFANGENE Stunde voll
 *  - Höchstens MAX_HOURS_PER_DAY Stunden pro angefangenem Tag (Tageshöchstpreis)
 */
export const FREE_MINUTES = 5;
export const MAX_HOURS_PER_DAY = 8;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function calculatePriceCents(startedAt: Date, endedAt: Date, pricePerHourCents: number): number {
  const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
  if (durationMs <= FREE_MINUTES * MINUTE) return 0;

  const fullDays = Math.floor(durationMs / DAY);
  const restMs = durationMs - fullDays * DAY;
  const restHours = Math.min(Math.ceil(restMs / HOUR), MAX_HOURS_PER_DAY);

  return (fullDays * MAX_HOURS_PER_DAY + restHours) * pricePerHourCents;
}
