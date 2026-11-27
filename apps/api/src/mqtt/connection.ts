/**
 * Die Verbindung des Backends zum MQTT-Broker.
 *  - empfängt alles, was die Ständer melden, und reicht es an handlers.ts weiter
 *  - schickt Befehle an Ständer und wartet auf deren Antwort (Ack)
 */
import { randomUUID } from "node:crypto";
import mqtt, { type MqttClient } from "mqtt";
import type { FastifyBaseLogger } from "fastify";
import {
  CommandAckMsg,
  DockStateMsg,
  StationStatusMsg,
  PROTOCOL_VERSION,
  decode,
  nowIso,
  parseTopic,
  topics,
  type CommandMsg,
  type CommandType,
} from "@radpark/protocol";
import { config } from "../config";
import { handleDockState, handleStationStatus } from "./handlers";

export class CommandTimeoutError extends Error {}

interface PendingCommand {
  resolve: (ack: CommandAckMsg) => void;
  timer: NodeJS.Timeout;
}

export class MqttGateway {
  private client: MqttClient;
  private pending = new Map<string, PendingCommand>();

  constructor(private log: FastifyBaseLogger) {
    this.client = mqtt.connect(config.MQTT_URL, {
      clientId: `api-${randomUUID().slice(0, 8)}`,
      reconnectPeriod: 2_000, // Verbindung weg? Alle 2 s neu versuchen
    });

    this.client.on("connect", () => {
      log.info({ url: config.MQTT_URL }, "MQTT verbunden");
      // Hinweis zur Skalierung: Laufen später mehrere Backend-Instanzen, bekommt jede alle Nachrichten.
      // Die Datenbank-Updates sind so geschrieben, dass doppelte Verarbeitung nicht schadet.
      this.client.subscribe(Object.values(topics.subscribeAll), { qos: 1 });
    });
    this.client.on("reconnect", () => log.warn("MQTT: Verbindung verloren, verbinde neu …"));
    this.client.on("error", (err) => log.error({ err }, "MQTT-Fehler"));

    this.client.on("message", (topic, payload) => {
      // Nachrichten DERSELBEN Station nacheinander abarbeiten (Warteschlange pro Station),
      // verschiedene Stationen dürfen parallel laufen.
      const key = topic.split("/")[1] ?? "";
      const previous = this.queues.get(key) ?? Promise.resolve();
      const next = previous
        .then(() => this.onMessage(topic, payload))
        .catch((err) => log.error({ err, topic }, "Fehler beim Verarbeiten einer MQTT-Nachricht"));
      this.queues.set(key, next);
      void next.finally(() => {
        if (this.queues.get(key) === next) this.queues.delete(key);
      });
    });
  }

  private queues = new Map<string, Promise<void>>();

  get connected() {
    return this.client.connected;
  }

  private async onMessage(topic: string, payload: Buffer) {
    const t = parseTopic(topic);
    if (!t) return;

    switch (t.kind) {
      case "status": {
        const msg = decode(StationStatusMsg, payload);
        if (!msg) return this.log.warn({ topic }, "Ungültige Status-Nachricht");
        return handleStationStatus(this.log, t.stationCode, msg);
      }
      case "dockState": {
        const msg = decode(DockStateMsg, payload);
        if (!msg) return this.log.warn({ topic }, "Ungültige Dock-Nachricht");
        return handleDockState(this.log, t.stationCode, t.dock, msg);
      }
      case "commandAck": {
        const msg = decode(CommandAckMsg, payload);
        if (!msg) return this.log.warn({ topic }, "Ungültige Ack-Nachricht");
        const pending = this.pending.get(msg.cmdId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(msg.cmdId);
          pending.resolve(msg);
        }
        return;
      }
    }
  }

  /**
   * Schickt einen Befehl an einen Ständer und wartet auf die Antwort.
   * Antwortet der Ständer nicht rechtzeitig (offline, Funkloch), gibt es einen CommandTimeoutError.
   */
  async sendCommand(stationCode: string, type: CommandType, dock: number, timeoutMs = 5_000): Promise<CommandAckMsg> {
    const cmd: CommandMsg = { v: PROTOCOL_VERSION, ts: nowIso(), cmdId: randomUUID(), type, dock };

    const ackPromise = new Promise<CommandAckMsg>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmd.cmdId);
        reject(new CommandTimeoutError(`Keine Antwort von ${stationCode} innerhalb von ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(cmd.cmdId, { resolve, timer });
    });

    await this.client.publishAsync(topics.command(stationCode), JSON.stringify(cmd), { qos: 1 });
    this.log.info({ stationCode, type, dock, cmdId: cmd.cmdId }, "Befehl gesendet");
    return ackPromise;
  }

  async close() {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    await this.client.endAsync();
  }
}
