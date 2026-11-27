/**
 * Entwickler-Werkzeuge – NUR für die lokale Entwicklung!
 * Werden nur geladen, wenn in der .env DEV_ROUTES=true steht.
 * Damit kann man Befehle an Ständer schicken, bevor es Login & Parkvorgänge gibt (Schritt 3).
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { CommandType, SimAction } from "@radpark/protocol";
import { db } from "../db/client";
import { docks, events, parkingSessions, stations } from "../db/schema";
import { recordEvent } from "../events";
import { CommandTimeoutError, type MqttGateway } from "../mqtt/connection";

const CommandParams = z.object({ code: z.string(), number: z.coerce.number().int().positive() });
const CommandBody = z.object({ type: CommandType });

export async function devRoutes(app: FastifyInstance, opts: { mqtt: MqttGateway }) {
  /**
   * POST /dev/stations/BER-001/docks/3/command   Body: {"type": "unlock"}
   * → schickt den Befehl an den Ständer und wartet auf die Antwort
   */
  app.post("/dev/stations/:code/docks/:number/command", async (req, reply) => {
    const params = CommandParams.safeParse(req.params);
    const body = CommandBody.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: 'Erwartet z. B. POST /dev/stations/BER-001/docks/3/command mit {"type":"unlock"}' });
    }
    const { code, number } = params.data;

    const [dock] = await db
      .select({ stationId: stations.id, dockId: docks.id })
      .from(docks)
      .innerJoin(stations, eq(stations.id, docks.stationId))
      .where(and(eq(stations.code, code), eq(docks.number, number)));
    if (!dock) return reply.code(404).send({ error: `Dock ${number} an Station ${code} gibt es nicht` });

    const ids = { stationId: dock.stationId, dockId: dock.dockId };
    await recordEvent({ ...ids, type: "command.sent", payload: { type: body.data.type, via: "dev" } });

    try {
      const ack = await opts.mqtt.sendCommand(code, body.data.type, number);
      await recordEvent({ ...ids, type: ack.ok ? "command.acked" : "command.failed", payload: { ...ack } });
      return reply.code(ack.ok ? 200 : 409).send(ack);
    } catch (err) {
      if (err instanceof CommandTimeoutError) {
        await recordEvent({ ...ids, type: "command.failed", payload: { error: "TIMEOUT" } });
        return reply.code(504).send({ error: err.message });
      }
      throw err;
    }
  });

  /**
   * POST /dev/stations/BER-001/docks/3/simulate {"action": "park" | "take"}
   * Sagt dem SIMULATOR: "Rad einstellen" bzw. "Rad entnehmen" – als stünde jemand am Ständer.
   * (Wird von den 🛠-Knöpfen in der App benutzt. Mit echter Hardware wirkungslos.)
   */
  app.post("/dev/stations/:code/docks/:number/simulate", async (req, reply) => {
    const params = CommandParams.safeParse(req.params);
    const body = z.object({ action: SimAction }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'Erwartet {"action":"park"} oder {"action":"take"}' });
    await opts.mqtt.simulate(params.data.code, params.data.number, body.data.action);
    return { ok: true };
  });

  /**
   * POST /dev/sessions/:id/backdate {"minutes": 130}
   * "Zeitreise": verlegt den Start eines laufenden Parkvorgangs in die Vergangenheit –
   * so kann man Gebühren testen, ohne stundenlang zu warten.
   */
  app.post("/dev/sessions/:id/backdate", async (req, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(req.params);
    const body = z.object({ minutes: z.number().int().positive().max(60 * 24 * 30) }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'Erwartet {"minutes": 130}' });
    const startedAt = new Date(Date.now() - body.data.minutes * 60_000);
    const [s] = await db
      .update(parkingSessions)
      .set({ startedAt, reservedAt: startedAt })
      .where(and(eq(parkingSessions.id, params.data.id), eq(parkingSessions.status, "active")))
      .returning({ id: parkingSessions.id });
    if (!s) return reply.code(404).send({ error: "Kein laufender (aktiver) Parkvorgang mit dieser ID" });
    return { ok: true, startedAt };
  });

  /** GET /dev/events → die letzten 50 Einträge aus dem Event-Log */
  app.get("/dev/events", async () => {
    return db.select().from(events).orderBy(desc(events.id)).limit(50);
  });
}
