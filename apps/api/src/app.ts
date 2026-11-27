import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { sql } from "drizzle-orm";
import { adminRoutes } from "./admin/routes";
import { authRoutes } from "./auth/routes";
import { config } from "./config";
import { db } from "./db/client";
import { AppError } from "./errors";
import { verifyMailTransport } from "./mailer";
import { MqttGateway } from "./mqtt/connection";
import { parkingRoutes } from "./parking/routes";
import { ParkingService } from "./parking/service";
import { devRoutes } from "./routes/dev";
import { simRoutes } from "./routes/sim";
import { stationRoutes } from "./routes/stations";
import { FakeProvider, StripeProvider } from "./wallet/providers";
import { walletRoutes } from "./wallet/routes";
import { WalletService } from "./wallet/service";

/** Baut die Web-App zusammen (getrennt von server.ts, damit wir sie später in Tests starten können) */
export async function buildApp() {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, trustProxy: config.TRUST_PROXY });
  app.decorateRequest("userId", null);
  app.decorateRequest("userRole", null);

  // E-Mail-Versand prüfen (nur Hinweis im Log – das Backend startet trotzdem)
  verifyMailTransport(app.log);

  // Verbindung zu den Fahrradständern (über den MQTT-Broker)
  const mqtt = new MqttGateway(app.log);
  const parking = new ParkingService(mqtt, app.log);

  // Guthaben – Zahlungsanbieter je nach Konfiguration (NUR Testmodus, siehe config.ts)
  const paymentProvider =
    config.PAYMENT_PROVIDER === "stripe" ? new StripeProvider(config.STRIPE_SECRET_KEY!) : new FakeProvider();
  const wallet = new WalletService(paymentProvider, app.log);
  app.log.info(
    paymentProvider.name === "stripe"
      ? "💳 Bezahlung: Stripe-TESTMODUS (Testkarten, kein Echtgeld)"
      : "💳 Bezahlung: interne Testgutschrift (kein Stripe-Schlüssel gesetzt)",
  );

  // Hintergrund-Job: hängengebliebene Reservierungen aufräumen
  const expiryTimer = setInterval(() => {
    parking.expireStaleReservations().catch((err) => app.log.error({ err }, "Aufräumen fehlgeschlagen"));
  }, 15_000);

  // Hintergrund-Job: offene Aufladungen beim Zahlungsanbieter abgleichen
  const topupTimer = setInterval(() => {
    wallet.reconcilePending().catch((err) => app.log.error({ err }, "Aufladungs-Abgleich fehlgeschlagen"));
  }, 30_000);

  app.addHook("onClose", async () => {
    clearInterval(expiryTimer);
    clearInterval(topupTimer);
    await mqtt.close();
  });

  // Einheitliche Fehlerantworten: { error: "CODE", message: "…" }
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, ...err.details });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: "BAD_REQUEST", message: (err as Error).message });
    }
    req.log.error({ err }, "Unerwarteter Fehler");
    return reply.code(500).send({ error: "INTERNAL", message: "Interner Fehler" });
  });

  await app.register(cors, { origin: true }); // in Produktion auf eigene Domains beschränken

  // Bremse gegen Missbrauch: Grenzen werden pro Route festgelegt (z. B. beim Login).
  // Hinweis Skalierung: Zähler liegen im Arbeitsspeicher – bei mehreren Backend-Instanzen
  // stattdessen Redis als gemeinsamen Speicher verwenden.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) =>
      new AppError(429, "TOO_MANY_REQUESTS", `Zu viele Anfragen – bitte in ${Math.ceil(ctx.ttl / 1000)} s erneut versuchen`, {
        retryAfterSeconds: Math.ceil(ctx.ttl / 1000),
      }),
  });

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

  /** GET /meta → was kann dieser Server? (Die App blendet z. B. die 🛠-Simulator-Knöpfe danach ein) */
  app.get("/meta", async () => ({
    simulatorControl: config.SIMULATOR_CONTROL,
    paymentProvider: config.PAYMENT_PROVIDER,
    testMode: true,
  }));

  await app.register(stationRoutes);
  await app.register(authRoutes);
  await app.register(parkingRoutes, { parking });
  await app.register(walletRoutes, { wallet });
  await app.register(adminRoutes, { mqtt });

  if (config.SIMULATOR_CONTROL) await app.register(simRoutes, { mqtt });

  if (config.DEV_ROUTES) {
    app.log.warn("⚠️  DEV_ROUTES aktiv – Entwickler-Endpunkte unter /dev/* sind ohne Login erreichbar!");
    await app.register(devRoutes, { mqtt });
  }

  return app;
}
