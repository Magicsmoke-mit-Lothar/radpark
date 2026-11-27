/**
 * Das Ständer-Protokoll (Version 1)
 * =================================
 * Dieser "Vertrag" beschreibt, wie das Backend und ein Fahrradständer über MQTT
 * miteinander sprechen. Der Simulator hält sich daran – und später auch die
 * Firmware auf dem echten Prototyp (ESP32). Solange beide Seiten diesen Vertrag
 * einhalten, ist es dem Backend egal, ob echte Hardware dranhängt oder nicht.
 *
 * Begriffe:
 *  - Station  = ein Fahrradständer-Standort mit EINEM Steuergerät (Controller)
 *  - Dock     = ein einzelner Stellplatz an der Station (Nummer 1..n), jeweils mit eigenem Schloss
 *
 * Ausführliche Erklärung: docs/PROTOKOLL.md
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Topics ("Adressen" der Nachrichten)
// ---------------------------------------------------------------------------
export const topics = {
  /** Ständer → Backend: online/offline. Retained + Last Will (siehe Doku). */
  status: (stationCode: string) => `stations/${stationCode}/status`,
  /** Ständer → Backend: Zustand eines einzelnen Docks (Schloss, Rad erkannt?). Retained. */
  dockState: (stationCode: string, dock: number) => `stations/${stationCode}/docks/${dock}/state`,
  /** Backend → Ständer: Befehl (z. B. Dock 3 entriegeln). */
  command: (stationCode: string) => `stations/${stationCode}/cmd`,
  /** Ständer → Backend: Antwort auf einen Befehl. */
  commandAck: (stationCode: string) => `stations/${stationCode}/cmd/ack`,

  /** Wildcard-Abos fürs Backend ("+" = genau eine Ebene beliebig) */
  subscribeAll: {
    status: "stations/+/status",
    dockState: "stations/+/docks/+/state",
    commandAck: "stations/+/cmd/ack",
  },
} as const;

/** Zerlegt ein empfangenes Topic wieder in seine Bestandteile. */
export function parseTopic(
  topic: string,
):
  | { kind: "status"; stationCode: string }
  | { kind: "dockState"; stationCode: string; dock: number }
  | { kind: "command"; stationCode: string }
  | { kind: "commandAck"; stationCode: string }
  | null {
  const parts = topic.split("/");
  if (parts[0] !== "stations" || !parts[1]) return null;
  const stationCode = parts[1];
  if (parts.length === 3 && parts[2] === "status") return { kind: "status", stationCode };
  if (parts.length === 3 && parts[2] === "cmd") return { kind: "command", stationCode };
  if (parts.length === 4 && parts[2] === "cmd" && parts[3] === "ack") return { kind: "commandAck", stationCode };
  if (parts.length === 5 && parts[2] === "docks" && parts[4] === "state") {
    const dock = Number(parts[3]);
    if (Number.isInteger(dock) && dock > 0) return { kind: "dockState", stationCode, dock };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Nachrichten (alle als JSON)
// ---------------------------------------------------------------------------
const base = {
  /** Protokollversion – damit alte Firmware und neues Backend sich erkennen */
  v: z.literal(PROTOCOL_VERSION),
  /** Zeitpunkt auf dem Gerät (ISO-8601) */
  ts: z.iso.datetime(),
};

export const StationStatusMsg = z.object({
  ...base,
  online: z.boolean(),
  firmware: z.string().optional(),
  dockCount: z.number().int().positive().optional(),
});
export type StationStatusMsg = z.infer<typeof StationStatusMsg>;

export const LockState = z.enum(["locked", "unlocked", "jammed"]);
export type LockState = z.infer<typeof LockState>;

export const DockStateMsg = z.object({
  ...base,
  lock: LockState,
  /** Sensor: steht ein Fahrrad im Dock? */
  bikePresent: z.boolean(),
  /** Optionaler Fehlercode der Hardware, z. B. "SENSOR_TIMEOUT" */
  fault: z.string().optional(),
});
export type DockStateMsg = z.infer<typeof DockStateMsg>;

export const CommandType = z.enum(["unlock", "lock", "identify"]);
export type CommandType = z.infer<typeof CommandType>;

export const CommandMsg = z.object({
  ...base,
  /** Eindeutige ID, damit die Antwort (Ack) dem Befehl zugeordnet werden kann */
  cmdId: z.string().min(1),
  type: CommandType,
  dock: z.number().int().positive(),
});
export type CommandMsg = z.infer<typeof CommandMsg>;

export const CommandAckMsg = z.object({
  ...base,
  cmdId: z.string().min(1),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type CommandAckMsg = z.infer<typeof CommandAckMsg>;

/** Hilfsfunktion: JSON-Payload sicher einlesen und prüfen. Gibt null bei Müll zurück. */
export function decode<T>(schema: z.ZodType<T>, payload: Buffer | string): T | null {
  try {
    const result = schema.safeParse(JSON.parse(payload.toString()));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// NUR SIMULATOR – gehört NICHT zum Hardware-Protokoll!
// Damit kann man während der Entwicklung "physische" Handgriffe auslösen
// (Rad einstellen / entnehmen), z. B. per Knopf in der App. Echte Ständer
// abonnieren diese Topics nie.
// ---------------------------------------------------------------------------
export const simTopics = {
  /** Entwickler → Simulator: "stell ein Rad in Dock n" / "nimm das Rad aus Dock n" */
  action: (stationCode: string, dock: number) => `sim/stations/${stationCode}/docks/${dock}/action`,
  subscribeStation: (stationCode: string) => `sim/stations/${stationCode}/docks/+/action`,
} as const;

export const SimAction = z.enum(["park", "take"]);
export type SimAction = z.infer<typeof SimAction>;
export const SimActionMsg = z.object({ action: SimAction });
export type SimActionMsg = z.infer<typeof SimActionMsg>;
