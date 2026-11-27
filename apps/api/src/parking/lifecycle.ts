/**
 * Regeln: Wie verändern Hardware-Meldungen einen Parkvorgang?
 *
 *  Vorgang     | Hardware meldet …                               | → Ergebnis
 *  ------------|-------------------------------------------------|-------------------------------------------
 *  reserviert  | Rad erkannt UND Schloss zu                      | aktiv, Parkzeit läuft, Dock "occupied"
 *  reserviert  | Schloss wieder zu, aber kein Rad                | abgebrochen (Nutzer kam nicht)
 *  aktiv       | Rad weg                                         | beendet, Preis berechnet, Dock frei
 *  aktiv       | Schloss zu, Rad noch da, obwohl Abholung lief   | Abholung abgelaufen → bleibt aktiv
 *  (keiner)    | Rad erkannt                                     | Warnung im Event-Log (Rad ohne Buchung)
 *
 * Diese Funktion läuft INNERHALB der Transaktion, in der auch der Dock-Zustand gespeichert wird.
 */
import type { FastifyBaseLogger } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import type { DockStateMsg } from "@radpark/protocol";
import type { Executor } from "../db/client";
import { docks, parkingSessions, stations } from "../db/schema";
import { recordEvent } from "../events";
import { calculatePriceCents } from "./pricing";

type Dock = typeof docks.$inferSelect;

export async function applyDockStateToSession(
  tx: Executor,
  log: FastifyBaseLogger,
  before: Dock,
  msg: DockStateMsg,
  hasFault: boolean,
) {
  const [session] = await tx
    .select()
    .from(parkingSessions)
    .where(and(eq(parkingSessions.dockId, before.id), inArray(parkingSessions.status, ["reserved", "active"])))
    .for("update");

  const ids = { stationId: before.stationId, dockId: before.id };
  // Nach Ende eines Vorgangs ist das Dock wieder frei – außer es hat gerade eine Störung
  const freeStatus = hasFault ? ("out_of_service" as const) : ("available" as const);
  const now = new Date();

  if (!session) {
    if (msg.bikePresent && !before.bikePresent) {
      log.warn({ dockId: before.id }, "Rad ohne Buchung im Dock erkannt");
      await recordEvent({ ...ids, type: "dock.unbooked_bike" }, tx);
    }
    return;
  }

  const ev = { ...ids, userId: session.userId, sessionId: session.id };

  // --- reserviert → aktiv -----------------------------------------------------
  if (session.status === "reserved" && msg.bikePresent && msg.lock === "locked") {
    await tx.update(parkingSessions).set({ status: "active", startedAt: now }).where(eq(parkingSessions.id, session.id));
    if (!hasFault) await tx.update(docks).set({ status: "occupied" }).where(eq(docks.id, before.id));
    await recordEvent({ ...ev, type: "session.started" }, tx);
    log.info({ sessionId: session.id }, "▶️  Parkvorgang gestartet");
    return;
  }

  // --- reserviert → abgebrochen (Bügel leer wieder zu) ----------------------
  if (session.status === "reserved" && !msg.bikePresent && msg.lock === "locked" && before.lockState === "unlocked") {
    await endSession(tx, session.id, { status: "cancelled", endReason: "RELOCKED_WITHOUT_BIKE" });
    await tx.update(docks).set({ status: freeStatus }).where(eq(docks.id, before.id));
    await recordEvent({ ...ev, type: "session.cancelled", payload: { reason: "RELOCKED_WITHOUT_BIKE" } }, tx);
    log.info({ sessionId: session.id }, "⏹️  Reservierung abgebrochen – kein Rad eingestellt");
    return;
  }

  // --- aktiv → beendet (Rad entnommen) ----------------------------------------
  if (session.status === "active" && before.bikePresent && !msg.bikePresent) {
    const [station] = await tx
      .select({ pricePerHourCents: stations.pricePerHourCents, currency: stations.currency })
      .from(stations)
      .where(eq(stations.id, before.stationId));
    const priceCents = calculatePriceCents(session.startedAt ?? session.reservedAt, now, station!.pricePerHourCents);
    // Rad weg, ohne dass der Nutzer "Abholen" gedrückt hat? → Diebstahl oder Sensorfehler!
    const expected = session.pickupRequestedAt !== null;

    await endSession(tx, session.id, {
      status: "completed",
      endReason: expected ? "BIKE_REMOVED" : "BIKE_REMOVED_UNEXPECTEDLY",
      priceCents,
      currency: station!.currency,
    });
    await tx.update(docks).set({ status: freeStatus }).where(eq(docks.id, before.id));
    await recordEvent({ ...ev, type: "session.completed", payload: { priceCents, expected } }, tx);
    if (expected) log.info({ sessionId: session.id, priceCents }, "✅ Parkvorgang beendet");
    else log.warn({ sessionId: session.id }, "🚨 Rad entnommen OHNE Abholung – Diebstahl oder Sensorfehler?");
    return;
  }

  // --- Abholung angefordert, aber Bügel ging mit Rad wieder zu -----------------
  if (session.status === "active" && session.pickupRequestedAt && msg.lock === "locked" && msg.bikePresent) {
    await tx.update(parkingSessions).set({ pickupRequestedAt: null }).where(eq(parkingSessions.id, session.id));
    await recordEvent({ ...ev, type: "session.pickup_timeout" }, tx);
    log.info({ sessionId: session.id }, "Abholung abgelaufen – Rad wurde nicht entnommen, Vorgang läuft weiter");
  }
}

/** Beendet einen Vorgang (Status + Endzeit + Grund) */
export async function endSession(
  tx: Executor,
  sessionId: string,
  data: { status: "completed" | "cancelled"; endReason: string; priceCents?: number; currency?: string },
) {
  await tx
    .update(parkingSessions)
    .set({ ...data, endedAt: new Date() })
    .where(eq(parkingSessions.id, sessionId));
}
