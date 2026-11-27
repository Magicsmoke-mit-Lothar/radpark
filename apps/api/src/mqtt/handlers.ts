/**
 * Verarbeitung der Nachrichten, die von den Ständern kommen.
 * Hier wird aus "Hardware-Fakten" (Schloss zu, Rad erkannt) der Zustand in der Datenbank.
 */
import type { FastifyBaseLogger } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DockStateMsg, StationStatusMsg } from "@radpark/protocol";
import { db } from "../db/client";
import { docks, stations } from "../db/schema";
import { recordEvent } from "../events";
import { applyDockStateToSession } from "../parking/lifecycle";

async function findStation(code: string) {
  const [station] = await db
    .select({ id: stations.id, online: stations.online })
    .from(stations)
    .where(eq(stations.code, code));
  return station;
}

/** Ständer meldet sich online oder (per "Last Will" über den Broker) offline */
export async function handleStationStatus(log: FastifyBaseLogger, code: string, msg: StationStatusMsg) {
  const station = await findStation(code);
  if (!station) {
    log.warn({ code }, "Status von unbekannter Station – ist sie in der Datenbank angelegt?");
    return;
  }

  await db
    .update(stations)
    .set({
      online: msg.online,
      // Serverzeit statt msg.ts: die Offline-Nachricht wurde schon beim Verbinden hinterlegt,
      // ihr Zeitstempel ist also alt.
      lastSeenAt: new Date(),
      ...(msg.firmware ? { firmware: msg.firmware } : {}),
    })
    .where(eq(stations.id, station.id));

  if (station.online !== msg.online) {
    log.info({ code }, msg.online ? "🟢 Station online" : "🔴 Station offline");
    await recordEvent({
      type: msg.online ? "station.online" : "station.offline",
      stationId: station.id,
      payload: { firmware: msg.firmware },
    });
  }
}

/** Ständer meldet den Zustand eines einzelnen Docks */
export async function handleDockState(log: FastifyBaseLogger, code: string, dockNumber: number, msg: DockStateMsg) {
  const station = await findStation(code);
  if (!station) {
    log.warn({ code }, "Dock-Zustand von unbekannter Station");
    return;
  }

  // Alles in EINER Transaktion: Dock-Zustand, Parkvorgang und Events werden gemeinsam gespeichert – oder gar nicht.
  await db.transaction(async (tx) => {
    // "for update" sperrt die Zeile, bis die Transaktion fertig ist. Gleichzeitige Änderungen
    // (z. B. ein Nutzer bucht genau jetzt dieses Dock) müssen warten → keine Durcheinander.
    const [dock] = await tx
      .select()
      .from(docks)
      .where(and(eq(docks.stationId, station.id), eq(docks.number, dockNumber)))
      .for("update");
    if (!dock) {
      log.warn({ code, dockNumber }, "Dock-Zustand für unbekanntes Dock");
      return;
    }

    // Nachrichten können verspätet ankommen (Funkloch!). Ältere als die zuletzt gespeicherte ignorieren wir.
    const msgTime = new Date(msg.ts);
    if (dock.stateUpdatedAt && msgTime < dock.stateUpdatedAt) {
      log.debug({ code, dockNumber }, "Veraltete Dock-Nachricht ignoriert");
      return;
    }

    const hasFault = msg.lock === "jammed" || !!msg.fault;

    await tx
      .update(docks)
      .set({
        lockState: msg.lock,
        bikePresent: msg.bikePresent,
        fault: msg.fault ?? (msg.lock === "jammed" ? "LOCK_JAMMED" : null),
        stateUpdatedAt: msgTime,
        // Bei einem Hardwarefehler sperren wir das Dock für neue Buchungen.
        // Wieder freigeben soll später bewusst ein Mensch (Admin-Dashboard), nicht die Hardware.
        ...(hasFault ? { status: "out_of_service" as const } : {}),
      })
      .where(eq(docks.id, dock.id));

    const base = { stationId: station.id, dockId: dock.id };

    if (dock.bikePresent !== msg.bikePresent) {
      log.info({ code, dockNumber }, msg.bikePresent ? "🚲 Rad eingestellt" : "↗️  Rad entnommen");
      await recordEvent({ ...base, type: msg.bikePresent ? "dock.bike_detected" : "dock.bike_removed" }, tx);
    }

    if (hasFault && dock.status !== "out_of_service") {
      log.warn({ code, dockNumber, fault: msg.fault, lock: msg.lock }, "⚠️  Störung an Dock – außer Betrieb gesetzt");
      await recordEvent({ ...base, type: "dock.fault", payload: { lock: msg.lock, fault: msg.fault } }, tx);
    }

    // Und was bedeutet das für einen laufenden Parkvorgang?
    await applyDockStateToSession(tx, log, dock, msg, hasFault);
  });
}
