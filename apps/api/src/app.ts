import Fastify from "fastify";
import cors from "@fastify/cors";
import { sql } from "drizzle-orm";
import { adminRoutes } from "./admin/routes";
import { authRoutes } from "./auth/routes";
import { config } from "./config";
import { db } from "./db/client";
import { AppError } from "./errors";
import { MqttGateway } from "./mqtt/connection";
import { parkingRoutes } from "./parking/routes";
import { ParkingService } from "./parking/service";
import { devRoutes } from "./routes/dev";
import { stationRoutes } from "./routes/stations";

/** Baut die Web-App zusammen (getrennt von server.ts, damit wir sie später in Tests starten können) */
export async function buildApp() {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  app.decorateRequest("userId", null);
  app.decorateRequest("userRole", null);

  // Verbindung zu den Fahrradständern (über den MQTT-Broker)
  const mqtt = new MqttGateway(app.log);
  const parking = new ParkingService(mqtt, app.log);

  // Hintergrund-Job: hängengebliebene Reservierungen aufräumen
  const expiryTimer = setInterval(() => {
    parking.expireStaleReservations().catch((err) => app.log.error({ err }, "Aufräumen fehlgeschlagen"));
  }, 15_000);

  app.addHook("onClose", async () => {
    clearInterval(expiryTimer);
    await mqtt.close();
  });

  // Einheitliche Fehlerantworten: { error: "CODE", message: "…" }
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: "BAD_REQUEST", message: (err as Error).message });
    }
    req.log.error({ err }, "Unerwarteter Fehler");
    return reply.code(500).send({ error: "INTERNAL", message: "Interner Fehler" });
  });

  await app.register(cors, { origin: true }); // in Produktion auf eigene Domains beschränken

  /** GET /health → "lebt der Server, erreicht er Datenbank und Broker?" (für Monitoring/Load-Balancer) */
  app.get("/health", async (_req, reply) => {
    let dbUp = true;
    try {
      await db.execute(sql`select 1`);
    } catch {
      dbUp = false;
    }
    const body = { ok: dbUp && mqtt.connected, db: dbUp ? "up" : "down", mqtt: mqtt.connected ? "up" : "down" };
    return reply.code(body.ok ? 200 : 503).send(body);
  });

  await app.register(stationRoutes);
  await app.register(authRoutes);
  await app.register(parkingRoutes, { parking });
  await app.register(adminRoutes, { mqtt });

  if (config.DEV_ROUTES) {
    app.log.warn("⚠️  DEV_ROUTES aktiv – Entwickler-Endpunkte unter /dev/* sind ohne Login erreichbar!");
    await app.register(devRoutes, { mqtt });
  }

  return app;
}
