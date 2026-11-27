/**
 * Ein simulierter Fahrradständer.
 * Verhält sich nach außen GENAU so, wie es später die ESP32-Firmware tun soll
 * (siehe docs/PROTOKOLL.md). Diese Datei ist damit auch die "Vorlage" für die Firmware.
 */
import mqtt, { type MqttClient } from "mqtt";
import {
  CommandMsg,
  PROTOCOL_VERSION,
  decode,
  nowIso,
  topics,
  type CommandAckMsg,
  type DockStateMsg,
  type LockState,
  type StationStatusMsg,
} from "@radpark/protocol";

export interface DockSim {
  lock: LockState;
  bikePresent: boolean;
  fault?: string;
}

export interface SimOptions {
  mqttUrl: string;
  /** Nach wie vielen Sekunden ein offener Bügel ohne Aktion automatisch wieder schließt */
  relockSeconds: number;
  /** Wird nach jeder Zustandsänderung aufgerufen (zum Speichern) */
  onChange: () => void;
  log: (msg: string) => void;
}

const FIRMWARE = "sim-0.2.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SimStation {
  private client: MqttClient | null = null;
  private relockTimers = new Map<number, NodeJS.Timeout>();

  constructor(
    readonly code: string,
    readonly docks: Map<number, DockSim>,
    private opts: SimOptions,
  ) {}

  get online() {
    return this.client?.connected ?? false;
  }

  // -------------------------------------------------------------------------
  // Verbindung
  // -------------------------------------------------------------------------

  start() {
    if (this.client) return;
    const offline: StationStatusMsg = { v: PROTOCOL_VERSION, ts: nowIso(), online: false };

    this.client = mqtt.connect(this.opts.mqttUrl, {
      clientId: `station-${this.code}`,
      keepalive: 10, // Broker merkt nach ~15 s ohne Lebenszeichen, dass wir weg sind
      reconnectPeriod: 3_000,
      // "Letzter Wille": Diese Nachricht veröffentlicht der BROKER, wenn wir unerwartet verschwinden
      will: { topic: topics.status(this.code), payload: Buffer.from(JSON.stringify(offline)), qos: 1, retain: true },
    });

    this.client.on("connect", async () => {
      this.opts.log(`🟢 ${this.code} verbunden`);
      await this.client!.subscribeAsync(topics.command(this.code), { qos: 1 });
      await this.publishStatus(true);
      for (const n of this.docks.keys()) await this.publishDock(n);
    });

    this.client.on("message", (_topic, payload) => {
      const cmd = decode(CommandMsg, payload);
      if (cmd) void this.handleCommand(cmd);
    });
  }

  /** Simuliert Stromausfall/Funkloch: Verbindung bricht hart ab → Broker sendet den "letzten Willen" */
  goOffline() {
    if (!this.client) return;
    this.client.end(true); // true = sofort kappen, ohne sich höflich abzumelden
    this.client = null;
    this.opts.log(`🔌 ${this.code} vom Netz getrennt (Stromausfall simuliert)`);
  }

  /** Sauberes Herunterfahren (z. B. Wartung): meldet sich selbst offline */
  async shutdown() {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    if (client.connected) {
      await this.publishStatusVia(client, false);
      await client.endAsync();
    } else {
      // Gerade keine Verbindung → nicht auf den Broker warten, sondern sofort aufgeben
      client.end(true);
    }
  }

  // -------------------------------------------------------------------------
  // Befehle vom Backend
  // -------------------------------------------------------------------------

  private async handleCommand(cmd: CommandMsg) {
    const dock = this.docks.get(cmd.dock);
    this.opts.log(`📩 ${this.code} Befehl "${cmd.type}" für Dock ${cmd.dock}`);
    if (!dock) return this.ack(cmd.cmdId, false, "UNKNOWN_DOCK");
    if (dock.lock === "jammed") return this.ack(cmd.cmdId, false, "LOCK_JAMMED");

    switch (cmd.type) {
      case "unlock":
        await sleep(400); // Motor braucht etwas Zeit
        dock.lock = "unlocked";
        await this.dockChanged(cmd.dock);
        this.scheduleRelock(cmd.dock);
        return this.ack(cmd.cmdId, true);
      case "lock":
        await sleep(400);
        dock.lock = "locked";
        await this.dockChanged(cmd.dock);
        return this.ack(cmd.cmdId, true);
      case "identify":
        this.opts.log(`💡 ${this.code} Dock ${cmd.dock}: LED blinkt`);
        return this.ack(cmd.cmdId, true);
      default:
        return this.ack(cmd.cmdId, false, "UNKNOWN_COMMAND");
    }
  }

  // -------------------------------------------------------------------------
  // "Physische" Aktionen – das, was ein Mensch am Ständer tut
  // -------------------------------------------------------------------------

  /** Rad in ein (entriegeltes) Dock stellen → Sensor erkennt es → Bügel schließt */
  async parkBike(n: number): Promise<string | null> {
    const dock = this.docks.get(n);
    if (!dock) return `Dock ${n} gibt es an ${this.code} nicht`;
    if (dock.bikePresent) return `In Dock ${n} steht schon ein Rad`;
    if (dock.lock !== "unlocked") return `Dock ${n} ist verriegelt – erst entriegeln (per Backend-Befehl "unlock")`;

    dock.bikePresent = true;
    this.clearRelock(n);
    await this.dockChanged(n);
    await sleep(1_000);
    dock.lock = "locked";
    await this.dockChanged(n);
    return null;
  }

  /** Rad aus einem (entriegelten) Dock nehmen → Bügel schließt wieder */
  async takeBike(n: number): Promise<string | null> {
    const dock = this.docks.get(n);
    if (!dock) return `Dock ${n} gibt es an ${this.code} nicht`;
    if (!dock.bikePresent) return `In Dock ${n} steht kein Rad`;
    if (dock.lock !== "unlocked") return `Dock ${n} ist verriegelt – erst entriegeln (per Backend-Befehl "unlock")`;

    dock.bikePresent = false;
    this.clearRelock(n);
    await this.dockChanged(n);
    await sleep(1_000);
    dock.lock = "locked";
    await this.dockChanged(n);
    return null;
  }

  /** Schloss klemmt (z. B. Vandalismus, Frost) */
  async jam(n: number): Promise<string | null> {
    const dock = this.docks.get(n);
    if (!dock) return `Dock ${n} gibt es an ${this.code} nicht`;
    dock.lock = "jammed";
    dock.fault = "LOCK_JAMMED";
    await this.dockChanged(n);
    return null;
  }

  /** Techniker hat repariert */
  async repair(n: number): Promise<string | null> {
    const dock = this.docks.get(n);
    if (!dock) return `Dock ${n} gibt es an ${this.code} nicht`;
    dock.lock = "locked";
    delete dock.fault;
    await this.dockChanged(n);
    return null;
  }

  // -------------------------------------------------------------------------
  // Hilfsfunktionen
  // -------------------------------------------------------------------------

  /** Sicherheitsfunktion: offener Bügel schließt nach einer Weile von selbst */
  private scheduleRelock(n: number) {
    this.clearRelock(n);
    this.relockTimers.set(
      n,
      setTimeout(async () => {
        const dock = this.docks.get(n);
        if (dock?.lock === "unlocked") {
          dock.lock = "locked";
          this.opts.log(`⏱️  ${this.code} Dock ${n}: niemand kam – Bügel automatisch geschlossen`);
          await this.dockChanged(n);
        }
      }, this.opts.relockSeconds * 1_000),
    );
  }

  private clearRelock(n: number) {
    clearTimeout(this.relockTimers.get(n));
    this.relockTimers.delete(n);
  }

  private async dockChanged(n: number) {
    this.opts.onChange();
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
    if (!dock || !this.client?.connected) return; // offline: Zustand wird beim Wiederverbinden nachgeliefert
    const msg: DockStateMsg = { v: PROTOCOL_VERSION, ts: nowIso(), lock: dock.lock, bikePresent: dock.bikePresent, fault: dock.fault };
    await this.client.publishAsync(topics.dockState(this.code, n), JSON.stringify(msg), { qos: 1, retain: true });
  }

  private async ack(cmdId: string, ok: boolean, error?: string) {
    const msg: CommandAckMsg = { v: PROTOCOL_VERSION, ts: nowIso(), cmdId, ok, error };
    if (!ok) this.opts.log(`❌ ${this.code} Befehl abgelehnt: ${error}`);
    await this.client?.publishAsync(topics.commandAck(this.code), JSON.stringify(msg), { qos: 1 });
  }
}
