/**
 * Admin-API fürs Betreiber-Dashboard (apps/admin).
 * ALLE Routen hier verlangen die Rolle "admin" (requireAdmin).
 * Jede Admin-Aktion landet mit der ID des Admins im Event-Log → nachvollziehbar, wer was getan hat.
 */
import type { FastifyInstance } from "fastify";
import { aliasedTable, and, asc, count, desc, eq, gte, inArray, like, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { CommandType } from "@radpark/protocol";
import { currentUserId, requireAdmin } from "../auth/guard";
import { config } from "../config";
import { db } from "../db/client";
import { docks, events, parkingSessions, stations, topups, users } from "../db/schema";
import { AppError, parseInput } from "../errors";
import { recordEvent } from "../events";
import { CommandTimeoutError, type MqttGateway } from "../mqtt/connection";
import { calculatePriceCents } from "../parking/pricing";

const DockParams = z.object({ id: z.uuid() });
const CommandBody = z.object({ type: CommandType });
const DisableBody = z.object({ reason: z.string().trim().max(200).optional() });
const EventsQuery = z.object({
  /** z. B. "session." für alle Parkvorgang-Ereignisse oder "dock.fault" für genau einen Typ */
  type: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Beginn des heutigen Tages in der Zeitzone des Betreibers (nicht UTC!) */
const startOfToday = sql`date_trunc('day', now() at time zone ${config.BUSINESS_TIMEZONE}) at time zone ${config.BUSINESS_TIMEZONE}`;
const OPEN = ["reserved", "active"] as const;

export async function adminRoutes(app: FastifyInstance, opts: { mqtt: MqttGateway }) {
  app.addHook("preHandler", requireAdmin);

  // ---------------------------------------------------------------------------
  // Übersicht (Kennzahlen)
  // ---------------------------------------------------------------------------
  app.get("/admin/overview", async () => {
    const [stationStats] = await db
      .select({ total: count(), online: sql<number>`count(*) filter (where ${stations.online})`.mapWith(Number) })
      .from(stations);

    const dockRows = await db.select({ status: docks.status, n: count() }).from(docks).groupBy(docks.status);
    const dockStats = { available: 0, reserved: 0, occupied: 0, out_of_service: 0 };
    for (const r of dockRows) dockStats[r.status] = r.n;

    const [open] = await db
      .select({ n: count() })
      .from(parkingSessions)
      .where(inArray(parkingSessions.status, [...OPEN]));

    const [today] = await db
      .select({ completed: count(), revenueCents: sum(parkingSessions.priceCents).mapWith(Number) })
      .from(parkingSessions)
      .where(and(eq(parkingSessions.status, "completed"), gte(parkingSessions.endedAt, startOfToday)));

    const [newUsers] = await db.select({ n: count() }).from(users).where(gte(users.createdAt, startOfToday));

    // Guthaben: Summe aller Kundenguthaben (das "schulden" wir den Nutzern) + Aufladungen heute
    const [balances] = await db.select({ total: sum(users.balanceCents).mapWith(Number) }).from(users);
    const [topupsToday] = await db
      .select({ n: count(), totalCents: sum(topups.amountCents).mapWith(Number) })
      .from(topups)
      .where(and(eq(topups.status, "succeeded"), gte(topups.completedAt, startOfToday)));

    return {
      stations: stationStats,
      docks: dockStats,
      openSessions: open!.n,
      today: {
        completedSessions: today!.completed,
        revenueCents: today!.revenueCents ?? 0,
        newUsers: newUsers!.n,
        topups: topupsToday!.n,
        topupCents: topupsToday!.totalCents ?? 0,
      },
      wallet: { totalBalanceCents: balances!.total ?? 0 },
    };
  });

  // ---------------------------------------------------------------------------
  // Stationen mit allen Docks (inkl. wer gerade wo parkt)
  // ---------------------------------------------------------------------------
  app.get("/admin/stations", async () => {
    const stationRows = await db.select().from(stations).orderBy(asc(stations.code));
    const dockRows = await db
      .select({
        id: docks.id,
        stationId: docks.stationId,
        number: docks.number,
        status: docks.status,
        lockState: docks.lockState,
        bikePresent: docks.bikePresent,
        fault: docks.fault,
        stateUpdatedAt: docks.stateUpdatedAt,
        sessionId: parkingSessions.id,
        sessionStatus: parkingSessions.status,
        sessionStartedAt: parkingSessions.startedAt,
        userEmail: users.email,
      })
      .from(docks)
      .leftJoin(parkingSessions, and(eq(parkingSessions.dockId, docks.id), inArray(parkingSessions.status, [...OPEN])))
      .leftJoin(users, eq(users.id, parkingSessions.userId))
      .orderBy(asc(docks.number));

    return stationRows.map(({ location: _location, ...s }) => ({
      ...s,
      docks: dockRows.filter((d) => d.stationId === s.id).map(({ stationId: _sid, ...d }) => d),
    }));
  });

  // ---------------------------------------------------------------------------
  // Laufende Parkvorgänge
  // ---------------------------------------------------------------------------
  app.get("/admin/sessions/open", async () => {
    const rows = await db
      .select({
        id: parkingSessions.id,
        status: parkingSessions.status,
        reservedAt: parkingSessions.reservedAt,
        startedAt: parkingSessions.startedAt,
        pickupRequestedAt: parkingSessions.pickupRequestedAt,
        userEmail: users.email,
        stationCode: stations.code,
        stationName: stations.name,
        dockNumber: docks.number,
        pricePerHourCents: stations.pricePerHourCents,
      })
      .from(parkingSessions)
      .innerJoin(users, eq(users.id, parkingSessions.userId))
      .innerJoin(docks, eq(docks.id, parkingSessions.dockId))
      .innerJoin(stations, eq(stations.id, docks.stationId))
      .where(inArray(parkingSessions.status, [...OPEN]))
      .orderBy(desc(parkingSessions.reservedAt));
    const now = new Date();
    return rows.map((r) => ({
      ...r,
      runningPriceCents: r.startedAt ? calculatePriceCents(r.startedAt, now, r.pricePerHourCents) : 0,
    }));
  });

  // ---------------------------------------------------------------------------
  // Ereignis-Protokoll
  // ---------------------------------------------------------------------------
  app.get("/admin/events", async (req) => {
    const { type, limit } = parseInput(EventsQuery, req.query);
    const actor = aliasedTable(users, "actor");
    return db
      .select({
        id: events.id,
        type: events.type,
        createdAt: events.createdAt,
        payload: events.payload,
        stationCode: stations.code,
        dockNumber: docks.number,
        userEmail: actor.email,
      })
      .from(events)
      .leftJoin(stations, eq(stations.id, events.stationId))
      .leftJoin(docks, eq(docks.id, events.dockId))
      .leftJoin(actor, eq(actor.id, events.userId))
      .where(type ? (type.endsWith(".") ? like(events.type, `${type}%`) : eq(events.type, type)) : undefined)
      .orderBy(desc(events.id))
      .limit(limit);
  });

  // ---------------------------------------------------------------------------
  // Dock-Aktionen
  // ---------------------------------------------------------------------------

  /** Gesperrtes Dock wieder freigeben – nur, wenn die Hardware keine Störung mehr meldet */
  app.post("/admin/docks/:id/release", async (req) => {
    const { id } = parseInput(DockParams, req.params);
    const adminId = currentUserId(req);
    return db.transaction(async (tx) => {
      const [dock] = await tx.select().from(docks).where(eq(docks.id, id)).for("update");
      if (!dock) throw new AppError(404, "DOCK_NOT_FOUND", "Dock nicht gefunden");
      if (dock.status !== "out_of_service") throw new AppError(409, "NOT_DISABLED", "Dock ist nicht gesperrt");
      if (dock.fault || dock.lockState === "jammed") {
        throw new AppError(409, "FAULT_ACTIVE", `Hardware meldet noch eine Störung (${dock.fault ?? dock.lockState}) – erst reparieren`);
      }
      if (dock.bikePresent) {
        throw new AppError(409, "BIKE_PRESENT", "Im Dock steht noch ein Rad – erst entfernen lassen");
      }
      await tx.update(docks).set({ status: "available" }).where(eq(docks.id, id));
      await recordEvent({ type: "dock.released", dockId: id, stationId: dock.stationId, userId: adminId }, tx);
      return { ok: true };
    });
  });

  /** Dock sperren (Wartung, Vandalismus …) – nicht, solange jemand darin parkt */
  app.post("/admin/docks/:id/disable", async (req) => {
    const { id } = parseInput(DockParams, req.params);
    const { reason } = parseInput(DisableBody, req.body ?? {});
    const adminId = currentUserId(req);
    return db.transaction(async (tx) => {
      const [dock] = await tx.select().from(docks).where(eq(docks.id, id)).for("update");
      if (!dock) throw new AppError(404, "DOCK_NOT_FOUND", "Dock nicht gefunden");
      if (dock.status === "reserved" || dock.status === "occupied") {
        throw new AppError(409, "DOCK_IN_USE", "Dock ist gerade gebucht – erst nach Ende des Parkvorgangs sperren");
      }
      await tx.update(docks).set({ status: "out_of_service" }).where(eq(docks.id, id));
      await recordEvent(
        { type: "dock.disabled", dockId: id, stationId: dock.stationId, userId: adminId, payload: { reason } },
        tx,
      );
      return { ok: true };
    });
  });

  /** Service-Befehl an ein Dock (z. B. für den Techniker vor Ort entriegeln) */
  app.post("/admin/docks/:id/command", async (req, reply) => {
    const { id } = parseInput(DockParams, req.params);
    const { type } = parseInput(CommandBody, req.body);
    const adminId = currentUserId(req);
    const [dock] = await db
      .select({ number: docks.number, stationId: docks.stationId, code: stations.code, online: stations.online })
      .from(docks)
      .innerJoin(stations, eq(stations.id, docks.stationId))
      .where(eq(docks.id, id));
    if (!dock) throw new AppError(404, "DOCK_NOT_FOUND", "Dock nicht gefunden");
    if (!dock.online) throw new AppError(409, "STATION_OFFLINE", `Station ${dock.code} ist offline`);

    const ids = { dockId: id, stationId: dock.stationId, userId: adminId };
    await recordEvent({ ...ids, type: "command.sent", payload: { type, via: "admin" } });
    try {
      const ack = await opts.mqtt.sendCommand(dock.code, type, dock.number);
      await recordEvent({ ...ids, type: ack.ok ? "command.acked" : "command.failed", payload: { ...ack } });
      if (!ack.ok) throw new AppError(409, "COMMAND_REJECTED", `Ständer lehnt ab: ${ack.error}`);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof CommandTimeoutError) {
        await recordEvent({ ...ids, type: "command.failed", payload: { error: "TIMEOUT" } });
        throw new AppError(504, "STATION_TIMEOUT", err.message);
      }
      throw err;
    }
  });
}
