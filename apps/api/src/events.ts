import { db } from "./db/client";
import { events } from "./db/schema";

/**
 * Alle Ereignistypen an einer Stelle. Neue Typen hier ergänzen –
 * so sieht man auf einen Blick, was im System alles protokolliert wird.
 */
export type EventType =
  | "station.online"
  | "station.offline"
  | "dock.bike_detected"
  | "dock.bike_removed"
  | "dock.fault"
  | "command.sent"
  | "command.acked"
  | "command.failed";

export interface EventInput {
  type: EventType;
  stationId?: string;
  dockId?: string;
  userId?: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
}

/** Hängt ein Ereignis an das Event-Log an. */
export async function recordEvent(e: EventInput) {
  await db.insert(events).values(e);
}
