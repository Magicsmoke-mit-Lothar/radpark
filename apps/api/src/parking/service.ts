/**
 * Aktionen, die ein NUTZER auslöst: parken, abholen, abbrechen.
 * Was die HARDWARE auslöst (Rad erkannt, Rad weg …), steht in lifecycle.ts.
 *
 * Grundprinzip: Erst in einer kurzen Transaktion den Platz sichern, DANN (außerhalb der
 * Transaktion) mit dem Ständer reden. Funkverbindungen können Sekunden dauern – so lange
 * wollen wir keine Datenbank-Sperren halten.
 */
import type { FastifyBaseLogger } from "fastify";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { docks, parkingSessions, stations, users } from "../db/schema";
import { AppError, isUniqueViolation } from "../errors";
import { recordEvent } from "../events";
import type { MqttGateway } from "../mqtt/connection";
import { endSession } from "./lifecycle";
import { calculatePriceCents } from "./pricing";

/** Alles, was die App über einen Parkvorgang anzeigen muss */
const sessionView = {
  id: parkingSessions.id,
  status: parkingSessions.status,
  reservedAt: parkingSessions.reservedAt,
  startedAt: parkingSessions.startedAt,
  endedAt: parkingSessions.endedAt,
  pickupRequestedAt: parkingSessions.pickupRequestedAt,
  priceCents: parkingSessions.priceCents,
  currency: parkingSessions.currency,
  endReason: parkingSessions.endReason,
  dockNumber: docks.number,
  stationId: stations.id,
  stationCode: stations.code,
  stationName: stations.name,
  pricePerHourCents: stations.pricePerHourCents,
};

export class ParkingService {
  constructor(
    private mqtt: MqttGateway,
    private log: FastifyBaseLogger,
  ) {}

  /** Parken starten: freies Dock reservieren und entriegeln */
  async start(userId: string, stationId: string, dockNumber?: number) {
    let reserved: { sessionId: string; dockId: string; dockNumber: number; stationCode: string };

    try {
      reserved = await db.transaction(async (tx) => {
        const [station] = await tx.select().from(stations).where(eq(stations.id, stationId));
        if (!station) throw new AppError(404, "STATION_NOT_FOUND", "Station nicht gefunden");
        if (!station.online) throw new AppError(409, "STATION_OFFLINE", "Station ist gerade nicht erreichbar");

        const [user] = await tx.select({ balanceCents: users.balanceCents }).from(users).where(eq(users.id, userId));
        if (user!.balanceCents < config.MIN_START_BALANCE_CENTS) {
          throw new AppError(402, "INSUFFICIENT_BALANCE", "Bitte lade zuerst Guthaben auf");
        }

        const [dock] = await tx
          .select()
          .from(docks)
          .where(
            and(
              eq(docks.stationId, stationId),
              eq(docks.status, "available"),
              eq(docks.lockState, "locked"),
              eq(docks.bikePresent, false),
              isNull(docks.fault),
              dockNumber !== undefined ? eq(docks.number, dockNumber) : undefined,
            ),
          )
          .orderBy(asc(docks.number))
          .limit(1)
          // "skip locked": Docks, die gerade jemand anderes bucht, überspringen statt warten
          .for("update", { skipLocked: true });
        if (!dock) {
          throw dockNumber !== undefined
            ? new AppError(409, "DOCK_NOT_AVAILABLE", `Dock ${dockNumber} ist nicht frei`)
            : new AppError(409, "NO_FREE_DOCK", "An dieser Station ist kein Platz frei");
        }

        const [session] = await tx
          .insert(parkingSessions)
          .values({ userId, dockId: dock.id, currency: station.currency })
          .returning({ id: parkingSessions.id });
        await tx.update(docks).set({ status: "reserved" }).where(eq(docks.id, dock.id));
        await recordEvent(
          { type: "session.reserved", userId, sessionId: session!.id, stationId, dockId: dock.id },
          tx,
        );
        return { sessionId: session!.id, dockId: dock.id, dockNumber: dock.number, stationCode: station.code };
      });
    } catch (err) {
      if (isUniqueViolation(err, "sessions_one_open_per_user")) {
        throw new AppError(409, "ALREADY_PARKING", "Du hast bereits einen laufenden Parkvorgang");
      }
      if (isUniqueViolation(err, "sessions_one_open_per_dock")) {
        throw new AppError(409, "DOCK_NOT_AVAILABLE", "Dieses Dock wurde gerade von jemand anderem gebucht");
      }
      throw err;
    }

    // Jetzt den Bügel öffnen
    const unlocked = await this.unlock(reserved.stationCode, reserved.dockNumber);
    if (!unlocked.ok) {
      await this.cancelInternal(reserved.sessionId, "UNLOCK_FAILED", false);
      throw new AppError(502, "UNLOCK_FAILED", `Bügel konnte nicht geöffnet werden: ${unlocked.error}`);
    }

    return this.get(userId, reserved.sessionId);
  }

  /** Rad abholen: Bügel öffnen. Beendet wird der Vorgang erst, wenn der Sensor "Rad weg" meldet. */
  async requestPickup(userId: string, sessionId: string) {
    const s = await this.get(userId, sessionId);
    if (s.status !== "active") throw new AppError(409, "NOT_ACTIVE", "Dieser Parkvorgang läuft nicht");

    await db.update(parkingSessions).set({ pickupRequestedAt: new Date() }).where(eq(parkingSessions.id, sessionId));
    const unlocked = await this.unlock(s.stationCode, s.dockNumber);
    if (!unlocked.ok) {
      await db.update(parkingSessions).set({ pickupRequestedAt: null }).where(eq(parkingSessions.id, sessionId));
      throw new AppError(502, "UNLOCK_FAILED", `Bügel konnte nicht geöffnet werden: ${unlocked.error}`);
    }
    await recordEvent({ type: "session.pickup_requested", userId, sessionId, stationId: s.stationId });
    return this.get(userId, sessionId);
  }

  /** Reservierung abbrechen (nur solange noch kein Rad drin ist) */
  async cancel(userId: string, sessionId: string) {
    const s = await this.get(userId, sessionId);
    if (s.status !== "reserved") {
      throw new AppError(409, "CANNOT_CANCEL", "Nur Reservierungen ohne eingestelltes Rad können abgebrochen werden");
    }
    await this.cancelInternal(sessionId, "USER_CANCELLED", true);
    return this.get(userId, sessionId);
  }

  /** Aktueller (offener) Parkvorgang des Nutzers – inkl. bisher angefallener Kosten */
  async current(userId: string) {
    const [s] = await db
      .select(sessionView)
      .from(parkingSessions)
      .innerJoin(docks, eq(docks.id, parkingSessions.dockId))
      .innerJoin(stations, eq(stations.id, docks.stationId))
      .where(and(eq(parkingSessions.userId, userId), inArray(parkingSessions.status, ["reserved", "active"])));
    if (!s) return null;
    const runningPriceCents = s.startedAt ? calculatePriceCents(s.startedAt, new Date(), s.pricePerHourCents) : 0;
    return { ...s, runningPriceCents };
  }

  /** Die letzten Parkvorgänge des Nutzers */
  async history(userId: string) {
    return db
      .select(sessionView)
      .from(parkingSessions)
      .innerJoin(docks, eq(docks.id, parkingSessions.dockId))
      .innerJoin(stations, eq(stations.id, docks.stationId))
      .where(eq(parkingSessions.userId, userId))
      .orderBy(desc(parkingSessions.reservedAt))
      .limit(50);
  }

  async get(userId: string, sessionId: string) {
    const [s] = await db
      .select(sessionView)
      .from(parkingSessions)
      .innerJoin(docks, eq(docks.id, parkingSessions.dockId))
      .innerJoin(stations, eq(stations.id, docks.stationId))
      // userId in der Bedingung: niemand kann fremde Parkvorgänge sehen oder steuern
      .where(and(eq(parkingSessions.id, sessionId), eq(parkingSessions.userId, userId)));
    if (!s) throw new AppError(404, "SESSION_NOT_FOUND", "Parkvorgang nicht gefunden");
    return s;
  }

  /**
   * Aufräumen: Reservierungen, die zu lange hängen (z. B. Station während der Reservierung
   * offline gegangen), werden abgebrochen. Läuft regelmäßig im Hintergrund (siehe app.ts).
   */
  async expireStaleReservations() {
    const cutoff = new Date(Date.now() - config.RESERVATION_TIMEOUT_SECONDS * 1000);
    const stale = await db
      .select({ id: parkingSessions.id })
      .from(parkingSessions)
      .where(and(eq(parkingSessions.status, "reserved"), lt(parkingSessions.reservedAt, cutoff)));
    for (const { id } of stale) {
      this.log.info({ sessionId: id }, "⌛ Reservierung abgelaufen");
      await this.cancelInternal(id, "RESERVATION_EXPIRED", true);
    }
  }

  // ---------------------------------------------------------------------------

  private async unlock(stationCode: string, dockNumber: number): Promise<{ ok: boolean; error?: string }> {
    try {
      const ack = await this.mqtt.sendCommand(stationCode, "unlock", dockNumber);
      return { ok: ack.ok, error: ack.error };
    } catch (err) {
      this.log.warn({ err, stationCode, dockNumber }, "Entriegeln fehlgeschlagen");
      return { ok: false, error: "TIMEOUT" };
    }
  }

  /** Reservierung abbrechen und Dock freigeben; optional den Bügel wieder schließen */
  private async cancelInternal(sessionId: string, reason: string, relock: boolean) {
    const result = await db.transaction(async (tx) => {
      const [s] = await tx
        .select({ status: parkingSessions.status, userId: parkingSessions.userId, dockId: parkingSessions.dockId })
        .from(parkingSessions)
        .where(eq(parkingSessions.id, sessionId))
        .for("update");
      if (!s || s.status !== "reserved") return null; // inzwischen schon erledigt (z. B. Rad eingestellt)

      await endSession(tx, sessionId, { status: "cancelled", endReason: reason });
      const [dock] = await tx
        .update(docks)
        // Nur zurück auf "frei", wenn nicht zwischenzeitlich eine Störung gemeldet wurde
        .set({ status: sql`case when ${docks.status} = 'reserved' then 'available'::dock_status else ${docks.status} end` })
        .where(eq(docks.id, s.dockId))
        .returning({ number: docks.number, stationId: docks.stationId, lockState: docks.lockState });
      await recordEvent(
        { type: "session.cancelled", userId: s.userId, sessionId, dockId: s.dockId, stationId: dock!.stationId, payload: { reason } },
        tx,
      );
      return dock!;
    });

    // Bügel offen gelassen? Dann schließen (Fehler hier sind nicht schlimm – der Ständer schließt auch selbst)
    if (result && relock && result.lockState === "unlocked") {
      const [station] = await db.select({ code: stations.code }).from(stations).where(eq(stations.id, result.stationId));
      this.mqtt.sendCommand(station!.code, "lock", result.number).catch(() => undefined);
    }
  }
}
