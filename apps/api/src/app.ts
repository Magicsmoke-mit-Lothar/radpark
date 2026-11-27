import Fastify from "fastify";
import cors from "@fastify/cors";
import { sql } from "drizzle-orm";
import { config } from "./config";
import { db } from "./db/client";
import { MqttGateway } from "./mqtt/connection";
import { devRoutes } from "./routes/dev";
import { stationRoutes } from "./routes/stations";

/** Baut die Web-App zusammen (getrennt von server.ts, damit wir sie später in Tests starten können) */
export async function buildApp() {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  // Verbindung zu den Fahrradständern (über den MQTT-Broker)
  const mqtt = new MqttGateway(app.log);
  app.addHook("onClose", async () => mqtt.close());

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

  if (config.DEV_ROUTES) {
    app.log.warn("⚠️  DEV_ROUTES aktiv – Entwickler-Endpunkte unter /dev/* sind ohne Login erreichbar!");
    await app.register(devRoutes, { mqtt });
  }

  return app;
}
