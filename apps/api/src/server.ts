import { buildApp } from "./app";
import { config } from "./config";
import { pool } from "./db/client";

const app = await buildApp();

// Sauber herunterfahren (z. B. bei Strg+C oder wenn der Server neu deployed wird)
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} empfangen, fahre herunter …`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

if (config.HOST !== "127.0.0.1" && config.HOST !== "localhost" && (config.DEV_ROUTES || config.DEV_LOGIN_CODES)) {
  app.log.warn(
    "⚠️  Entwicklungsmodus ist für ALLE Geräte im Netzwerk erreichbar (Login-Codes in der Antwort, /dev/*). Nur in vertrauenswürdigen WLANs benutzen – in Uni-/Café-WLANs lieber über den Tunnel testen.",
  );
}
await app.listen({ port: config.PORT, host: config.HOST });
