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
  /** Zeitzone des Betreibers – z. B. für "Umsatz heute" */
  BUSINESS_TIMEZONE: z.string().default("Europe/Berlin"),
  /** Nach so vielen Sekunden ohne eingestelltes Rad wird eine Reservierung automatisch abgebrochen */
  RESERVATION_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
  /** Entwickler-Endpunkte (/dev/*) einschalten – NIEMALS in Produktion */
  DEV_ROUTES: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // --- Bezahlung / Guthaben ---
  /**
   * Stripe-Geheimschlüssel. ABSICHTLICH nur TEST-Schlüssel erlaubt (sk_test_… / rk_test_…):
   * Mit einem Live-Schlüssel (echtes Geld!) startet das Backend gar nicht erst.
   */
  STRIPE_SECRET_KEY: z
    .string()
    .trim()
    .regex(/^(sk|rk)_test_/, "Nur Stripe-TESTschlüssel erlaubt (beginnen mit sk_test_) – kein Echtgeld!")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /**
   * Womit wird Guthaben aufgeladen?
   *  stripe = Stripe-Testmodus (Testkarten, kein echtes Geld)
   *  fake   = sofortige Testgutschrift ohne Stripe (nur mit DEV_ROUTES=true)
   * Leer lassen = automatisch: stripe, wenn ein Schlüssel da ist, sonst fake.
   */
  PAYMENT_PROVIDER: z.enum(["stripe", "fake"]).optional(),
  /** So viel Guthaben braucht man mindestens, um einen Parkvorgang zu starten (Cent) */
  MIN_START_BALANCE_CENTS: z.coerce.number().int().min(0).default(100),
});

const parsed = ConfigSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Ungültige Konfiguration (.env prüfen):", z.prettifyError(parsed.error));
  process.exit(1);
}

const paymentProvider = parsed.data.PAYMENT_PROVIDER ?? (parsed.data.STRIPE_SECRET_KEY ? "stripe" : "fake");
if (paymentProvider === "stripe" && !parsed.data.STRIPE_SECRET_KEY) {
  console.error("❌ PAYMENT_PROVIDER=stripe, aber STRIPE_SECRET_KEY fehlt in der .env");
  process.exit(1);
}
if (paymentProvider === "fake" && !parsed.data.DEV_ROUTES) {
  console.error("❌ Testzahlungen (PAYMENT_PROVIDER=fake) sind nur mit DEV_ROUTES=true erlaubt");
  process.exit(1);
}

export const config = { ...parsed.data, PAYMENT_PROVIDER: paymentProvider };
