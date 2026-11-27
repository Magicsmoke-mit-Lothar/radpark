import { z } from "zod";

// Lädt Variablen aus der Datei .env (falls vorhanden) in process.env
try {
  process.loadEnvFile();
} catch {
  // keine .env-Datei – dann zählen nur echte Umgebungsvariablen (z. B. auf dem Server)
}

// Wir prüfen die Konfiguration beim Start. Fehlt etwas, bricht das Programm
// sofort mit einer verständlichen Meldung ab – statt später irgendwo mysteriös.
const ConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  MQTT_URL: z.string().url().default("mqtt://localhost:1883"),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const parsed = ConfigSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Ungültige Konfiguration (.env prüfen):", z.prettifyError(parsed.error));
  process.exit(1);
}

export const config = parsed.data;
