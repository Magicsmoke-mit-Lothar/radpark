import Fastify from "fastify";
import cors from "@fastify/cors";
import { sql } from "drizzle-orm";
import { config } from "./config";
import { db } from "./db/client";
import { stationRoutes } from "./routes/stations";

/** Baut die Web-App zusammen (getrennt von server.ts, damit wir sie später in Tests starten können) */
export async function buildApp() {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  await app.register(cors, { origin: true }); // in Produktion auf eigene Domains beschränken

  /** GET /health → "lebt der Server und erreicht er die Datenbank?" (für Monitoring/Load-Balancer) */
  app.get("/health", async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { ok: true, db: "up" };
    } catch {
      return reply.code(503).send({ ok: false, db: "down" });
    }
  });

  await app.register(stationRoutes);

  return app;
}
