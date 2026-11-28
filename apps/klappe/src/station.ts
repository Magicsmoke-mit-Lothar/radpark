/**
 * Die "Klappe": ein Laptop, der sich wie ein ECHTER Fahrradständer verhält.
 *
 * Er meldet sich mit seinem Stationscode am MQTT-Broker an (genau wie später der ESP32),
 * empfängt Befehle vom Backend (entriegeln / verriegeln / LED blinken) und meldet zurück,
 * was "physisch" passiert: Bügel offen oder zu, Rad drin oder nicht.
 *
 * Unterschied zum Simulator: Hier drückt ein MENSCH die Knöpfe ("Rad einstellen",
 * "Bügel schließen") – so kann man den Ablauf an einem zweiten Gerät live durchspielen.
 * Protokoll: packages/protocol bzw. docs/PROTOKOLL.md
 */
import mqtt, { type MqttClient } from "mqtt";
import {
  CommandMsg,
  PROTOCOL_VERSION,
  SimActionMsg,
  decode,
  nowIso,
  simTopics,
  topics,
  type CommandAckMsg,
  type DockStateMsg,
  type LockState,
  type StationStatusMsg,
} from "@radpark/protocol";

export const FIRMWARE = "klappe-0.1.0";

export interface Dock {
  lock: LockState;
  bikePresent: boolean;
  fault?: string;
}

export type ConnState = "getrennt" | "verbinde" | "verbunden" | "fehler" | "abgelehnt";
/** Wer hat die Änderung ausgelöst? (nur für die Anzeige) */
export type Cause = "backend" | "hand" | "app" | "automatik";
export type LogKind = "in" | "out" | "info" | "warn";

export interface KlappeOptions {
  url: string;
  password: string;
  /** Offener Bügel schließt nach … Sekunden von selbst (0 = nie) */
  relockSeconds: number;
  /** Wie die echte Hardware: Bügel schließt von selbst, sobald ein Rad erkannt/entnommen wurde */
  autoClose: () => boolean;
}

export interface KlappeEvents {
  conn(state: ConnState, detail?: string): void;
  dock(n: number, dock: Dock, cause: Cause): void;
  log(msg: string, kind: LogKind): void;
  identify(n: number): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class KlappeStation {
  private client: MqttClient | null = null;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Wann schließt ein offener Bügel automatisch? (für den Countdown in der Anzeige) */
  readonly relockAt = new Map<number, number>();

  readonly code: string;
  readonly docks: Map<number, Dock>;
  private opts: KlappeOptions;
  private ev: KlappeEvents;

  constructor(code: string, docks: Map<number, Dock>, opts: KlappeOptions, ev: KlappeEvents) {
    this.code = code;
    this.docks = docks;
    this.opts = opts;
    this.ev = ev;
  }

  get connected() {
    return this.client?.connected ?? false;
  }

  // -------------------------------------------------------------------------
  // Verbindung
  // -------------------------------------------------------------------------

  connect() {
    if (this.client) return;
    this.ev.conn("verbinde");
    const offline: StationStatusMsg = { v: PROTOCOL_VERSION, ts: nowIso(), online: false };

    const client = mqtt.connect(this.opts.url, {
      // Benutzername = Stationscode → der Broker erlaubt uns NUR die eigenen Topics
      clientId: `station-${this.code}`,
      username: this.code,
      password: this.opts.password,
      keepalive: 15,
      reconnectPeriod: 3_000,
      connectTimeout: 10_000,
      // "Letzter Wille": Klappt der Laptop zu oder fällt das WLAN aus, meldet der BROKER uns offline
      will: { topic: topics.status(this.code), payload: JSON.stringify(offline), qos: 1, retain: true },
    });
    this.client = client;

    client.on("connect", async () => {
      this.ev.conn("verbunden");
      this.ev.log(`Mit dem Broker verbunden als ${this.code}`, "info");
      await client.subscribeAsync(topics.command(this.code), { qos: 1 });
      // Damit auch der 🛠-Knopf in der App (Testbetrieb) diese Klappe "bedienen" kann
      await client.subscribeAsync(simTopics.subscribeStation(this.code), { qos: 1 });
      await this.publishStatus(true);
      for (const n of this.docks.keys()) await this.publishDock(n);
    });
    client.on("reconnect", () => this.ev.conn("verbinde"));
    client.on("offline", () => this.ev.conn("verbinde", "Verbindung verloren – versuche es erneut …"));
    client.on("error", (err) => {
      if (/not authori[sz]ed|bad user ?name or password/i.test(err.message)) {
        // Falsche Zugangsdaten: nicht endlos weiterprobieren
        this.client = null;
        client.end(true);
        this.ev.conn("abgelehnt", "Der Broker lehnt ab: Stationscode oder Passwort falsch.");
        return;
      }
      this.ev.conn("fehler", err.message);
      this.ev.log(err.message, "warn");
    });
    client.on("message", (topic, payload) => {
      if (topic.startsWith("sim/")) return void this.handleAppAction(topic, payload);
      const cmd = decode(CommandMsg, payload);
      if (cmd) void this.handleCommand(cmd);
      else this.ev.log(`Unverständliche Nachricht auf ${topic} ignoriert`, "warn");
    });
  }

  /** Sauber abmelden (z. B. Feierabend): meldet sich selbst offline */
  async disconnect() {
    const client = this.client;
    if (!client) return;
    this.client = null;
    if (client.connected) {
      await this.publishStatusVia(client, false).catch(() => undefined);
      await client.endAsync().catch(() => undefined);
    } else {
      client.end(true);
    }
    this.ev.conn("getrennt");
    this.ev.log("Abgemeldet (offline gemeldet)", "info");
  }

  /** Stromausfall simulieren: Verbindung hart kappen → der Broker verschickt den "letzten Willen" */
  powerCut() {
    const client = this.client;
    if (!client) return;
    this.client = null;
    client.end(true);
    this.ev.conn("getrennt");
    this.ev.log("⚡ Stromausfall simuliert – der Broker meldet die Station gleich offline", "warn");
  }

  // -------------------------------------------------------------------------
  // Befehle vom Backend
  // -------------------------------------------------------------------------

  private async handleCommand(cmd: CommandMsg) {
    const dock = this.docks.get(cmd.dock);
    this.ev.log(`📩 Befehl vom Backend: ${cmd.type} Dock ${cmd.dock}`, "in");
    if (!dock) return this.ack(cmd.cmdId, false, "UNKNOWN_DOCK");
    if (dock.lock === "jammed") return this.ack(cmd.cmdId, false, "LOCK_JAMMED");

    switch (cmd.type) {
      case "unlock":
        await sleep(400); // der Motor braucht einen Moment
        dock.lock = "unlocked";
        this.scheduleRelock(cmd.dock);
        await this.changed(cmd.dock, "backend");
        return this.ack(cmd.cmdId, true);
      case "lock":
        await sleep(400);
        dock.lock = "locked";
        this.clearRelock(cmd.dock);
        await this.changed(cmd.dock, "backend");
        return this.ack(cmd.cmdId, true);
      case "identify":
        this.ev.identify(cmd.dock);
        return this.ack(cmd.cmdId, true);
      default:
        return this.ack(cmd.cmdId, false, "UNKNOWN_COMMAND");
    }
  }

  /** 🛠-Knopf in der App: "Rad einstellen" / "Rad entnehmen" ferngesteuert */
  private async handleAppAction(topic: string, payload: { toString(): string }) {
    const msg = decode(SimActionMsg, payload);
    const n = Number(topic.split("/")[4]);
    if (!msg || !Number.isInteger(n)) return;
    this.ev.log(`📱 App-Testknopf: ${msg.action === "park" ? "Rad einstellen" : "Rad entnehmen"} (Dock ${n})`, "in");
    const error = await this.setBike(n, msg.action === "park", "app");
    if (error) return this.ev.log(error, "warn");
    await sleep(1_000);
    await this.closeLatch(n, "app");
  }

  // -------------------------------------------------------------------------
  // Was ein Mensch an der Klappe tut
  // -------------------------------------------------------------------------

  /** Lichttaster: Rad steht drin / Rad ist raus. Geht nur bei offenem Bügel (sonst ist der Riegel im Weg). */
  async setBike(n: number, present: boolean, cause: Cause = "hand"): Promise<string | null> {
    const dock = this.docks.get(n);
    if (!dock) return `Dock ${n} gibt es nicht`;
    if (dock.lock !== "unlocked") return `Dock ${n}: Der Bügel ist zu – erst über die App entriegeln`;
    if (dock.bikePresent === present) return null;
    dock.bikePresent = present;
    this.scheduleRelock(n); // Handgriff → Sicherheits-Countdown beginnt von vorn
    await this.changed(n, cause);
    if (cause === "hand" && this.opts.autoClose()) {
      await sleep(1_000);
      await this.closeLatch(n, "automatik");
    }
    return null;
  }

  /** Bügel schließen (Riegel fährt aus) */
  async closeLatch(n: number, cause: Cause = "hand"): Promise<string | null> {
    const dock = this.docks.get(n);
    if (!dock) return `Dock ${n} gibt es nicht`;
    if (dock.lock !== "unlocked") return null; // schon zu
    dock.lock = "locked";
    this.clearRelock(n);
    await this.changed(n, cause);
    return null;
  }

  /** Schloss klemmt (Vandalismus, Frost …) */
  async jam(n: number) {
    const dock = this.docks.get(n);
    if (!dock) return;
    dock.lock = "jammed";
    dock.fault = "LOCK_JAMMED";
    this.clearRelock(n);
    await this.changed(n, "hand");
  }

  /** Techniker hat repariert → Grundzustand: verriegelt */
  async repair(n: number) {
    const dock = this.docks.get(n);
    if (!dock) return;
    dock.lock = "locked";
    delete dock.fault;
    await this.changed(n, "hand");
  }

  // -------------------------------------------------------------------------
  // Hilfsfunktionen
  // -------------------------------------------------------------------------

  /** Sicherheitsfunktion: Ein offener Bügel bleibt nicht ewig offen */
  private scheduleRelock(n: number) {
    this.clearRelock(n);
    if (this.opts.relockSeconds <= 0) return;
    this.relockAt.set(n, Date.now() + this.opts.relockSeconds * 1_000);
    this.timers.set(
      n,
      setTimeout(() => {
        this.ev.log(`⏱️ Dock ${n}: Zeit abgelaufen – Bügel schließt automatisch`, "info");
        void this.closeLatch(n, "automatik");
      }, this.opts.relockSeconds * 1_000),
    );
  }

  private clearRelock(n: number) {
    clearTimeout(this.timers.get(n));
    this.timers.delete(n);
    this.relockAt.delete(n);
  }

  private async changed(n: number, cause: Cause) {
    this.ev.dock(n, this.docks.get(n)!, cause);
    await this.publishDock(n);
  }

  private async publishStatus(online: boolean) {
    if (this.client) await this.publishStatusVia(this.client, online);
  }

  private async publishStatusVia(client: MqttClient, online: boolean) {
    const msg: StationStatusMsg = { v: PROTOCOL_VERSION, ts: nowIso(), online, firmware: FIRMWARE, dockCount: this.docks.size };
    await client.publishAsync(topics.status(this.code), JSON.stringify(msg), { qos: 1, retain: true });
  }

  private async publishDock(n: number) {
    const dock = this.docks.get(n);
    // Offline: Der aktuelle Zustand wird beim Wiederverbinden automatisch nachgeliefert
    if (!dock || !this.client?.connected) return;
    const msg: DockStateMsg = { v: PROTOCOL_VERSION, ts: nowIso(), lock: dock.lock, bikePresent: dock.bikePresent, fault: dock.fault };
    await this.client.publishAsync(topics.dockState(this.code, n), JSON.stringify(msg), { qos: 1, retain: true });
    this.ev.log(`📤 Gemeldet: Dock ${n} ${lockText(dock.lock)}, ${dock.bikePresent ? "Rad drin" : "kein Rad"}`, "out");
  }

  private async ack(cmdId: string, ok: boolean, error?: string) {
    const msg: CommandAckMsg = { v: PROTOCOL_VERSION, ts: nowIso(), cmdId, ok, error };
    await this.client?.publishAsync(topics.commandAck(this.code), JSON.stringify(msg), { qos: 1 });
    this.ev.log(ok ? "📤 Befehl bestätigt" : `📤 Befehl abgelehnt: ${error}`, ok ? "out" : "warn");
  }
}

export function lockText(lock: LockState) {
  return lock === "locked" ? "verriegelt" : lock === "unlocked" ? "entriegelt" : "Störung";
}
