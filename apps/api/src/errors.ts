import { z } from "zod";

/**
 * Ein "erwarteter" Fehler mit HTTP-Statuscode und maschinenlesbarem Code.
 * Die App zeigt anhand des Codes (z. B. "NO_FREE_DOCK") eine passende Meldung in der
 * Sprache des Nutzers an; `message` ist nur für Entwickler gedacht.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Prüft Eingaben gegen ein Schema – bei Fehlern gibt es automatisch HTTP 400. */
export function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new AppError(400, "INVALID_INPUT", z.prettifyError(result.error));
  return result.data;
}

/** Erkennt den PostgreSQL-Fehler "eindeutiger Index verletzt" (z. B. Doppelbuchung) */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  // drizzle verpackt den Original-Fehler von pg manchmal in `cause`
  const e = (err as { cause?: unknown })?.cause ?? err;
  const pgErr = e as { code?: string; constraint?: string };
  return pgErr?.code === "23505" && (!constraint || pgErr.constraint === constraint);
}
