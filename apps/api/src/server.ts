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

await app.listen({ port: config.PORT, host: "0.0.0.0" });
