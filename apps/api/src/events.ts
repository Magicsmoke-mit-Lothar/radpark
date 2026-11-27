import { db, type Executor } from "./db/client";
import { events } from "./db/schema";

/**
 * Alle Ereignistypen an einer Stelle. Neue Typen hier ergänzen –
 * so sieht man auf einen Blick, was im System alles protokolliert wird.
 */
export type EventType =
  // Stationen & Hardware
  | "station.online"
  | "station.offline"
  | "dock.bike_detected"
  | "dock.bike_removed"
  | "dock.unbooked_bike" // Rad steht im Dock, ohne dass es eine Buchung gibt
  | "dock.fault"
  | "dock.released" // Admin hat ein gesperrtes Dock wieder freigegeben
  | "dock.disabled" // Admin hat ein Dock gesperrt (z. B. Wartung)
  | "command.sent"
  | "command.acked"
  | "command.failed"
  // Nutzer
  | "user.registered"
  | "user.login"
  // Parkvorgänge
  | "session.reserved"
  | "session.started"
  | "session.pickup_requested"
  | "session.pickup_timeout" // Bügel war offen, aber Rad wurde nicht entnommen
  | "session.completed"
  | "session.cancelled";

export interface EventInput {
  type: EventType;
  stationId?: string;
  dockId?: string;
  userId?: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Hängt ein Ereignis an das Event-Log an.
 * Wird `tx` übergeben, landet das Ereignis in derselben Transaktion –
 * also nur dann, wenn auch die eigentliche Änderung gespeichert wird.
 */
export async function recordEvent(e: EventInput, tx: Executor = db) {
  await tx.insert(events).values(e);
}
