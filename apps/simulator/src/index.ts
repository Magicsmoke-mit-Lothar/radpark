/**
 * Ständer-Simulator
 * =================
 * Startet für jede Station einen simulierten Fahrradständer und bietet eine
 * kleine Kommandozeile, mit der du "physisch" Räder einstellen, Störungen
 * auslösen oder den Strom abdrehen kannst.
 *
 * Start: pnpm sim
 *
 * Einstellungen (Umgebungsvariablen, alle optional):
 *   MQTT_URL         Broker-Adresse                      (Standard: mqtt://localhost:1883)
 *   API_URL          Backend, um die Stationsliste zu holen (Standard: http://localhost:3000)
 *   SIM_STATIONS     Stationen ohne Backend vorgeben, z. B. "BER-001:8,BER-002:6"
 *   SIM_RELOCK_SECONDS  offener Bügel schließt automatisch nach … Sekunden (Standard: 60)
 *   SIM_STATION_PASSWORD Passwort am gesicherten Broker (Benutzername = Stationscode)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { SimStation, type DockSim } from "./station";

const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const API_URL = process.env.API_URL ?? "http://localhost:3000";
const RELOCK_SECONDS = Number(process.env.SIM_RELOCK_SECONDS ?? 60);
// Der "physische" Zustand (welches Rad steht wo) überlebt einen Neustart – wie bei echter Hardware
const STATE_FILE = process.env.SIM_STATE_FILE ? new URL(`file://${process.env.SIM_STATE_FILE}`) : new URL("../.sim-state.json", import.meta.url);

const log = (msg: string) => console.log(`  ${msg}`);

// ---------------------------------------------------------------------------
// 1. Welche Stationen gibt es?
// ---------------------------------------------------------------------------
async function loadStationList(): Promise<{ code: string; dockCount: number }[]> {
  if (process.env.SIM_STATIONS) {
    return process.env.SIM_STATIONS.split(",").map((entry) => {
      const [code, count] = entry.trim().split(":");
      return { code: code!, dockCount: Number(count ?? 4) };
    });
  }
  try {
    const res = await fetch(`${API_URL}/stations`);
    const list = (await res.json()) as { code: string; totalDocks: number }[];
    return list.map((s) => ({ code: s.code, dockCount: s.totalDocks }));
  } catch {
    console.error(`❌ Konnte die Stationsliste nicht von ${API_URL} laden. Läuft das Backend (pnpm dev:api)?`);
    console.error(`   Alternativ ohne Backend: SIM_STATIONS="BER-001:8,BER-002:6" pnpm sim`);
    process.exit(1);
  }
}

type SavedState = Record<string, Record<string, DockSim>>;
const saved: SavedState = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};

const stations = new Map<string, SimStation>();
function saveState() {
  // Nur die EIGENEN Stationen aktualisieren – laufen zwei Simulatoren mit verschiedenen
  // Stationen (z. B. SIM_STATIONS="TST-001:4"), überschreiben sie sich nicht gegenseitig.
  let out: SavedState = {};
  try {
    out = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    // Datei fehlt oder ist kaputt → neu anlegen
  }
  for (const s of stations.values()) out[s.code] = Object.fromEntries(s.docks);
  writeFileSync(STATE_FILE, JSON.stringify(out, null, 2));
}

for (const { code, dockCount } of await loadStationList()) {
  const docks = new Map<number, DockSim>();
  for (let n = 1; n <= dockCount; n++) {
    const prev = saved[code]?.[n];
    // Ein offener Bügel bleibt nach einem Neustart nicht offen
    docks.set(n, prev ? { ...prev, lock: prev.lock === "unlocked" ? "locked" : prev.lock } : { lock: "locked", bikePresent: false });
  }
  const station = new SimStation(code, docks, {
    mqttUrl: MQTT_URL,
    password: process.env.SIM_STATION_PASSWORD || undefined,
    relockSeconds: RELOCK_SECONDS,
    onChange: saveState,
    log,
  });
  stations.set(code, station);
  station.start();
}

// ---------------------------------------------------------------------------
// 2. Kommandozeile
// ---------------------------------------------------------------------------
const HELP = `
Befehle:
  liste [STATION]               Zustand aller (oder einer) Stationen anzeigen
  parken  STATION DOCK          Rad in ein entriegeltes Dock stellen    (z. B. parken BER-001 3)
  abholen STATION DOCK          Rad aus einem entriegelten Dock nehmen
  stoerung STATION DOCK         Schloss klemmt → Störung melden
  reparieren STATION DOCK       Störung beheben
  offline STATION               Stromausfall simulieren
  online STATION                Station wieder einschalten
  hilfe                         diese Hilfe
  ende                          Simulator beenden

Entriegeln geht – wie in echt – nur über das Backend, z. B.:
  curl -X POST localhost:3000/dev/stations/BER-001/docks/3/command -H 'content-type: application/json' -d '{"type":"unlock"}'
`;

function show(code?: string) {
  const symbol = (d: DockSim) => (d.lock === "jammed" ? "⚠️ " : d.bikePresent ? "🚲" : d.lock === "unlocked" ? "🔓" : "⬜");
  for (const s of stations.values()) {
    if (code && s.code !== code) continue;
    const line = [...s.docks].map(([n, d]) => `${n}:${symbol(d)}`).join("  ");
    console.log(`  ${s.online ? "🟢" : "🔴"} ${s.code.padEnd(8)} ${line}`);
  }
  console.log("  Legende: ⬜ frei & verriegelt  🔓 entriegelt  🚲 Rad steht drin  ⚠️  Störung");
}

function getStation(code: string | undefined) {
  const s = code ? stations.get(code.toUpperCase()) : undefined;
  if (!s) log(`Unbekannte Station "${code ?? ""}". Verfügbar: ${[...stations.keys()].join(", ")}`);
  return s;
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("Fahre herunter, Stationen melden sich ab …");
  // Sicherheitsnetz: Spätestens nach 3 s beenden, auch wenn der Broker nicht antwortet
  setTimeout(() => process.exit(0), 3_000).unref();
  await Promise.all([...stations.values()].map((s) => s.shutdown().catch(() => undefined)));
  process.exit(0);
}

console.log(`\n🚲 RadPark-Simulator – ${stations.size} Stationen, Broker ${MQTT_URL}`);
console.log(HELP);

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "sim> " });
rl.prompt();

rl.on("line", async (line) => {
  const [cmd, code, dockArg] = line.trim().split(/\s+/);
  const dock = Number(dockArg);
  const withDock = async (fn: (s: SimStation, n: number) => Promise<string | null>) => {
    const s = getStation(code);
    if (!s) return;
    if (!Number.isInteger(dock)) return log("Bitte eine Dock-Nummer angeben, z. B. 3");
    const error = await fn(s, dock);
    log(error ? `❌ ${error}` : "✅ erledigt");
  };

  switch (cmd?.toLowerCase()) {
    case undefined:
    case "":
      break;
    case "liste":
      show(code?.toUpperCase());
      break;
    case "parken":
      await withDock((s, n) => s.parkBike(n));
      break;
    case "abholen":
      await withDock((s, n) => s.takeBike(n));
      break;
    case "stoerung":
    case "störung":
      await withDock((s, n) => s.jam(n));
      break;
    case "reparieren":
      await withDock((s, n) => s.repair(n));
      break;
    case "offline":
      getStation(code)?.goOffline();
      break;
    case "online":
      getStation(code)?.start();
      break;
    case "hilfe":
    case "help":
      console.log(HELP);
      break;
    case "ende":
    case "exit":
    case "quit":
      return shutdown();
    default:
      log(`Unbekannter Befehl "${cmd}" – tippe "hilfe"`);
  }
  rl.prompt();
});

rl.on("close", shutdown);
rl.on("SIGINT", shutdown); // Strg+C in der Kommandozeile
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
