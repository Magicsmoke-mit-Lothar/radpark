/**
 * RadPark Klappe – Bedienoberfläche.
 * Zwei Ansichten: "Einrichten" (Broker, Stationscode, Passwort) und "Klappe" (die Docks).
 */
import "./style.css";
import { FIRMWARE, KlappeStation, type Cause, type ConnState, type Dock, type LogKind } from "./station";
import { alarmSound, audioReady, lockSound, sensorSound, setMuted, unlockAudio } from "./sound";

// ---------------------------------------------------------------------------
// Einstellungen (bleiben im Browser dieses Laptops gespeichert)
// ---------------------------------------------------------------------------
interface Settings {
  url: string;
  station: string;
  password: string;
  docks: number;
  relockSeconds: number;
  autoClose: boolean;
  remember: boolean;
  muted: boolean;
}

const SETTINGS_KEY = "radpark-klappe:einstellungen";
const docksKey = (code: string) => `radpark-klappe:docks:${code}`;

// localStorage kann fehlen oder gesperrt sein (privates Fenster) → dann eben ohne Speichern
const store = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* egal */
    }
  },
};

function defaultUrl() {
  // Entwicklung (pnpm dev:klappe): lokaler Broker. Auf dem Server: derselbe Rechner unter /mqtt
  if (import.meta.env.DEV) return "ws://localhost:9001";
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/mqtt`;
}

const defaults: Settings = {
  url: defaultUrl(),
  station: "",
  password: "",
  docks: 1,
  relockSeconds: 120,
  autoClose: false,
  remember: true,
  muted: false,
};

let settings: Settings = { ...defaults, ...store.get<Partial<Settings>>(SETTINGS_KEY) };

function saveSettings() {
  store.set(SETTINGS_KEY, settings.remember ? settings : { ...settings, password: "" });
}

/**
 * Einrichtungs-Link: …/klappe/#station=LAB-001&pw=…&docks=1
 * Der Teil nach "#" wird NIE an den Server geschickt – das Passwort bleibt im Browser.
 */
let autoStart = false;
if (location.hash.length > 1) {
  const p = new URLSearchParams(location.hash.slice(1));
  const station = p.get("station");
  const pw = p.get("pw");
  if (station) settings.station = station.toUpperCase();
  if (pw) settings.password = pw;
  if (p.get("docks")) settings.docks = clampInt(p.get("docks"), 1, 8, 1);
  if (p.get("broker")) settings.url = p.get("broker")!;
  settings.remember = true;
  saveSettings();
  // Passwort sofort aus der Adresszeile (und dem Browserverlauf) entfernen
  history.replaceState(null, "", location.pathname + location.search);
  autoStart = Boolean(settings.station && settings.password);
} else {
  autoStart = Boolean(settings.station && settings.password && store.get<boolean>("radpark-klappe:lief"));
}

// Link in einen schon offenen Tab eingefügt? Dann lädt der Browser nicht neu → selbst neu laden
window.addEventListener("hashchange", () => {
  if (/(^#|&)(station|pw)=/.test(location.hash)) location.reload();
});

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------
function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function esc(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function $(sel: string, root: ParentNode = document) {
  return root.querySelector(sel) as HTMLElement;
}

const app = document.getElementById("app")!;
let station: KlappeStation | null = null;
let countdownTimer: ReturnType<typeof setInterval> | undefined;
let wakeLock: { release(): Promise<void> } | null = null;

// Wer hat zuletzt entriegelt? Nur das Backend löst den Alarm aus (nicht ein Neustart o. Ä.)
const alarmDocks = new Set<number>();

// ---------------------------------------------------------------------------
// Ansicht 1: Einrichten
// ---------------------------------------------------------------------------
function showSetup(message?: string) {
  stopCountdown();
  document.title = "RadPark Klappe";
  document.body.dataset.view = "setup";
  app.innerHTML = `
    <main class="setup">
      <div class="setup-card">
        <div class="brand big">${logo()}<div><b>RadPark Klappe</b><span>Laptop als Fahrradständer</span></div></div>
        <p class="lead">Dieser Laptop meldet sich als <b>Station</b> am Server an – genau wie später der echte
        Ständer. Entriegelt die App den Bügel, siehst und hörst du es hier. Rad einstellen und Bügel schließen
        machst du mit den Knöpfen.</p>
        ${message ? `<p class="notice warn">${esc(message)}</p>` : ""}
        <form id="setup" autocomplete="off">
          <label>Stationscode
            <input name="station" required pattern="[A-Za-z0-9\\-]{2,20}" placeholder="z. B. LAB-001" value="${esc(settings.station)}" />
          </label>
          <label>Passwort der Station
            <input name="password" type="password" required value="${esc(settings.password)}" />
            <small>Steht im Einrichtungs-Link (<code>pnpm stage:klappe-link</code> auf dem Server).</small>
          </label>
          <div class="row">
            <label>Docks
              <input name="docks" type="number" min="1" max="8" value="${settings.docks}" />
              <small>Wie in der Datenbank angelegt</small>
            </label>
            <label>Bügel schließt von selbst nach
              <span class="suffix"><input name="relock" type="number" min="0" max="3600" value="${settings.relockSeconds}" /> s</span>
              <small>0 = nie</small>
            </label>
          </div>
          <label class="check"><input name="autoClose" type="checkbox" ${settings.autoClose ? "checked" : ""} />
            Bügel schließt automatisch, sobald ein Rad erkannt oder entnommen wird (wie die echte Hardware)</label>
          <label class="check"><input name="remember" type="checkbox" ${settings.remember ? "checked" : ""} />
            Passwort auf diesem Laptop merken (startet beim nächsten Öffnen von selbst)</label>
          <details>
            <summary>Erweitert</summary>
            <label>Broker-Adresse
              <input name="url" required value="${esc(settings.url)}" />
              <small>Standard: <code>${esc(defaultUrl())}</code></small>
            </label>
          </details>
          <button class="btn primary wide" type="submit">Als Station anmelden</button>
        </form>
      </div>
    </main>`;

  $("#setup").addEventListener("submit", (e) => {
    e.preventDefault();
    unlockAudio();
    const f = new FormData(e.target as HTMLFormElement);
    settings = {
      ...settings,
      station: String(f.get("station")).trim().toUpperCase(),
      password: String(f.get("password")),
      docks: clampInt(f.get("docks"), 1, 8, 1),
      relockSeconds: clampInt(f.get("relock"), 0, 3600, 120),
      autoClose: f.get("autoClose") === "on",
      remember: f.get("remember") === "on",
      url: String(f.get("url")).trim() || defaultUrl(),
    };
    saveSettings();
    start();
  });
}

// ---------------------------------------------------------------------------
// Ansicht 2: die Klappe
// ---------------------------------------------------------------------------
function loadDocks(code: string, count: number) {
  const saved = store.get<Record<string, Dock>>(docksKey(code)) ?? {};
  const docks = new Map<number, Dock>();
  for (let n = 1; n <= count; n++) {
    const prev = saved[n];
    // Wie bei echter Hardware: Nach einem Neustart ist ein offener Bügel wieder zu
    docks.set(n, prev ? { ...prev, lock: prev.lock === "unlocked" ? "locked" : prev.lock } : { lock: "locked", bikePresent: false });
  }
  return docks;
}

function start() {
  const docks = loadDocks(settings.station, settings.docks);
  setMuted(settings.muted);
  document.body.dataset.view = "klappe";
  document.body.dataset.conn = "verbinde";
  app.innerHTML = `
    <div class="alarm-banner" role="alert" hidden></div>
    <header class="top">
      <div class="brand">${logo()}<div><b>RadPark Klappe</b><span>${esc(settings.station)} · ${FIRMWARE}</span></div></div>
      <div class="conn" aria-live="polite"><i></i><span>Verbinde …</span></div>
      <nav class="actions">
        <button class="btn ghost" data-act="sound"></button>
        <button class="btn ghost" data-act="power"></button>
        <button class="btn ghost" data-act="logout">Abmelden</button>
      </nav>
    </header>
    <p class="audio-hint" hidden>🔈 Einmal irgendwo klicken, damit die Klappe Töne abspielen darf.</p>
    <main class="docks ${docks.size === 1 ? "single" : ""}">
      ${[...docks.keys()].map(dockCard).join("")}
    </main>
    <section class="log">
      <h2>Was passiert gerade?</h2>
      <ol></ol>
    </section>
    <footer class="keys">Tastatur: <kbd>Leertaste</kbd> Bügel schließen · <kbd>R</kbd> Rad einstellen / entnehmen</footer>`;

  station = new KlappeStation(
    settings.station,
    docks,
    { url: settings.url, password: settings.password, relockSeconds: settings.relockSeconds, autoClose: () => settings.autoClose },
    {
      conn: onConn,
      dock: onDock,
      log: addLog,
      identify: (n) => {
        const card = cardOf(n);
        card?.classList.remove("identify");
        void card?.offsetWidth; // Animation neu starten
        card?.classList.add("identify");
        addLog(`💡 Dock ${n}: LED blinkt (Ständer suchen)`, "info");
      },
    },
  );

  last.clear();
  alarmDocks.clear();
  for (const [n, d] of docks) {
    last.set(n, { lock: d.lock, bike: d.bikePresent });
    renderDock(n, d);
  }
  renderSound();
  bindControls();
  station.connect();
  startCountdown();
  store.set("radpark-klappe:lief", true);
  if (!audioReady()) $(".audio-hint").hidden = false;
}

function dockCard(n: number) {
  return `
    <article class="dock" data-n="${n}">
      <header>
        <h2>Dock ${n}</h2>
        <span class="chip"></span>
      </header>
      ${rackSvg(n)}
      <p class="headline"></p>
      <p class="hint"></p>
      <p class="countdown" hidden></p>
      <div class="controls">
        <button class="btn bike" data-act="bike" data-n="${n}"></button>
        <button class="btn primary" data-act="close" data-n="${n}">🔒 Bügel schließen</button>
      </div>
      <details class="werkstatt">
        <summary>Werkstatt</summary>
        <div>
          <button class="btn ghost small" data-act="jam" data-n="${n}">Schloss klemmt (Störung)</button>
          <button class="btn ghost small" data-act="repair" data-n="${n}">Reparieren</button>
        </div>
      </details>
      <p class="raw"></p>
    </article>`;
}

/** Vorderansicht eines Docks: Hauptpfosten mit Kopfkasten, Riegel, Gegenpfosten, Radrinne */
function rackSvg(n: number) {
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return `<line x1="166" y1="160" x2="${(166 + Math.cos(a) * 50).toFixed(1)}" y2="${(160 + Math.sin(a) * 50).toFixed(1)}" />`;
  }).join("");
  return `
  <svg class="rack" viewBox="0 0 320 236" role="img" aria-label="Dock">
    <rect class="ground" x="0" y="222" width="320" height="14" />
    <rect class="rinne" x="104" y="214" width="124" height="8" rx="2" />
    <g class="rad">
      <line class="gabel" x1="166" y1="160" x2="150" y2="14" />
      <circle class="reifen" cx="166" cy="160" r="56" />
      <g class="speichen">${spokes}</g>
      <circle class="nabe" cx="166" cy="160" r="5" />
    </g>
    <!-- Der Riegel verschwindet beim Einfahren im Kopfkasten (alles links davon wird abgeschnitten) -->
    <clipPath id="riegel-clip-${n}"><rect x="42" y="0" width="278" height="236" /></clipPath>
    <g clip-path="url(#riegel-clip-${n})"><rect class="riegel" x="104" y="72" width="140" height="13" rx="6.5" /></g>
    <rect class="pfosten" x="56" y="96" width="40" height="126" />
    <rect class="kopf" x="42" y="52" width="70" height="52" rx="7" />
    <circle class="led-ring" cx="77" cy="78" r="13" />
    <circle class="led" cx="77" cy="78" r="8" />
    <rect class="pfosten gegen" x="228" y="58" width="26" height="164" />
    <rect class="loch" x="228" y="72" width="8" height="13" />
  </svg>`;
}

function logo() {
  return `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--petrol)"/><rect x="6" y="6" width="7" height="22" rx="1.5" fill="#e8f1f0"/><rect x="21" y="12" width="5" height="16" rx="1.5" fill="#e8f1f0"/><rect x="9" y="12.5" width="15" height="4" rx="2" fill="var(--signal)"/></svg>`;
}

const cardOf = (n: number) => document.querySelector<HTMLElement>(`.dock[data-n="${n}"]`);

function describe(d: Dock): { chip: string; headline: string; hint: string } {
  if (d.lock === "jammed") {
    return { chip: "Störung", headline: "Störung – Schloss klemmt", hint: "Das Backend sperrt den Platz. Werkstatt → Reparieren." };
  }
  if (d.lock === "unlocked") {
    return d.bikePresent
      ? { chip: "Entriegelt", headline: "Entriegelt – Rad steht drin", hint: "Parken: Bügel schließen. Abholen: Rad entnehmen." }
      : { chip: "Entriegelt", headline: "Entriegelt – Durchgang frei", hint: "Rad einstellen und Bügel schließen. Ohne Rad schließen = Platz bleibt frei." };
  }
  return d.bikePresent
    ? { chip: "Rad gesichert", headline: "Rad ist angeschlossen", hint: "Zum Abholen in der App auf „Abholen“ tippen." }
    : { chip: "Frei", headline: "Frei und verriegelt", hint: "Warte auf die App: „Hier parken“." };
}

function renderDock(n: number, d: Dock) {
  const card = cardOf(n);
  if (!card) return;
  const info = describe(d);
  card.dataset.lock = d.lock;
  card.dataset.bike = String(d.bikePresent);
  card.classList.toggle("alarm", alarmDocks.has(n) && d.lock === "unlocked");
  $(".chip", card).textContent = info.chip;
  $(".headline", card).textContent = info.headline;
  $(".hint", card).textContent = info.hint;
  const bike = $('[data-act="bike"]', card) as HTMLButtonElement;
  bike.textContent = d.bikePresent ? "↩︎ Rad entnehmen" : "🚲 Rad einstellen";
  bike.disabled = d.lock !== "unlocked";
  ($('[data-act="close"]', card) as HTMLButtonElement).disabled = d.lock !== "unlocked";
  ($('[data-act="jam"]', card) as HTMLButtonElement).disabled = d.lock === "jammed";
  ($('[data-act="repair"]', card) as HTMLButtonElement).disabled = d.lock !== "jammed";
  $(".raw", card).textContent = `Meldung an den Server: lock=${d.lock} · bikePresent=${d.bikePresent}${d.fault ? ` · fault=${d.fault}` : ""}`;
  renderAlarm();
}

function renderAlarm() {
  const open = [...alarmDocks].filter((n) => station?.docks.get(n)?.lock === "unlocked");
  const banner = $(".alarm-banner");
  if (!banner) return;
  banner.hidden = open.length === 0;
  banner.textContent = open.length ? `🔓 ${open.map((n) => `Dock ${n}`).join(", ")} entriegelt – Bügel ist offen` : "";
  document.body.classList.toggle("alarm", open.length > 0);
  document.title = open.length ? "🔓 ENTRIEGELT · RadPark Klappe" : `RadPark Klappe · ${settings.station}`;
}

// Zuletzt angezeigter Zustand je Dock – um zu erkennen, WAS sich geändert hat
const last = new Map<number, { lock: Dock["lock"]; bike: boolean }>();

function onDock(n: number, d: Dock, cause: Cause) {
  const prev = last.get(n);
  last.set(n, { lock: d.lock, bike: d.bikePresent });
  if (prev && prev.bike !== d.bikePresent) sensorSound();
  if (prev?.lock !== d.lock) {
    if (d.lock === "unlocked") {
      if (cause === "backend") {
        // Der wichtigste Moment: Die App hat den Bügel geöffnet → unübersehbar anzeigen
        alarmDocks.add(n);
        alarmSound();
        addLog(`🔓 Dock ${n} wurde vom Server ENTRIEGELT`, "warn");
      }
    } else {
      alarmDocks.delete(n);
      if (d.lock === "locked") {
        lockSound();
        const how = cause === "automatik" ? "automatisch " : cause === "backend" ? "vom Server " : cause === "app" ? "per App-Testknopf " : "";
        addLog(`🔒 Dock ${n}: Bügel ${how}geschlossen`, "info");
      }
    }
  }
  store.set(docksKey(settings.station), Object.fromEntries(station?.docks ?? []));
  renderDock(n, d);
  updateCountdowns();
}

function onConn(state: ConnState, detail?: string) {
  if (state === "abgelehnt") {
    station = null;
    store.set("radpark-klappe:lief", false);
    return showSetup(detail);
  }
  document.body.dataset.conn = state;
  const label = { getrennt: "Offline", verbinde: "Verbinde …", verbunden: "Online", fehler: "Fehler", abgelehnt: "Abgelehnt" }[state];
  const conn = $(".conn span");
  if (conn) conn.textContent = detail && state !== "verbunden" ? `${label} – ${detail}` : label;
  if (state === "verbunden") void keepAwake();
  renderPower();
}

function addLog(msg: string, kind: LogKind) {
  const list = $(".log ol");
  if (!list) return;
  const li = document.createElement("li");
  li.className = kind;
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString("de-DE");
  li.append(time, document.createTextNode(msg));
  list.prepend(li);
  while (list.children.length > 80) list.lastElementChild?.remove();
}

function renderSound() {
  const b = $('[data-act="sound"]');
  if (b) b.textContent = settings.muted ? "🔇 Ton aus" : "🔊 Ton an";
}

function renderPower() {
  const b = $('[data-act="power"]');
  if (b) b.textContent = station && document.body.dataset.conn !== "getrennt" ? "⚡ Stromausfall" : "🔌 Einschalten";
}

// ---------------------------------------------------------------------------
// Knöpfe & Tastatur
// ---------------------------------------------------------------------------
function bindControls() {
  app.onclick = async (e) => {
    unlockAudio();
    $(".audio-hint")?.setAttribute("hidden", "");
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn || !station) return;
    const n = Number(btn.dataset.n);
    switch (btn.dataset.act) {
      case "bike": {
        const d = station.docks.get(n)!;
        const error = await station.setBike(n, !d.bikePresent);
        if (error) addLog(error, "warn");
        else addLog(`${d.bikePresent ? "🚲 Rad eingestellt" : "↩︎ Rad entnommen"} (Dock ${n})`, "info");
        break;
      }
      case "close":
        await station.closeLatch(n);
        break;
      case "jam":
        await station.jam(n);
        addLog(`⚠️ Dock ${n}: Schloss klemmt`, "warn");
        break;
      case "repair":
        await station.repair(n);
        addLog(`🔧 Dock ${n}: repariert`, "info");
        break;
      case "sound":
        settings.muted = !settings.muted;
        setMuted(settings.muted);
        saveSettings();
        renderSound();
        break;
      case "power":
        if (document.body.dataset.conn === "getrennt") station.connect();
        else station.powerCut();
        renderPower();
        break;
      case "logout":
        await station.disconnect();
        station = null;
        store.set("radpark-klappe:lief", false);
        showSetup();
        break;
    }
  };
}

document.addEventListener("keydown", (e) => {
  if (!station || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.target as HTMLElement).closest("input, textarea, select, summary")) return;
  // Gemeint ist das Dock, das gerade offen ist (bei mehreren: das zuletzt entriegelte)
  const open = [...station.docks].filter(([, d]) => d.lock === "unlocked").map(([n]) => n);
  const n = [...alarmDocks].reverse().find((x) => open.includes(x)) ?? open[0];
  if (n === undefined) return;
  if (e.code === "Space") {
    e.preventDefault();
    void station.closeLatch(n);
  } else if (e.key === "r" || e.key === "R") {
    cardOf(n)?.querySelector<HTMLButtonElement>('[data-act="bike"]')?.click();
  }
});

// ---------------------------------------------------------------------------
// Countdown & Bildschirm wach halten
// ---------------------------------------------------------------------------
function updateCountdowns() {
  if (!station) return;
  for (const n of station.docks.keys()) {
    const el = cardOf(n)?.querySelector<HTMLElement>(".countdown");
    if (!el) continue;
    const at = station.relockAt.get(n);
    el.hidden = at === undefined;
    if (at !== undefined) {
      const s = Math.max(0, Math.ceil((at - Date.now()) / 1000));
      el.textContent = `Bügel schließt automatisch in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
  }
}

function startCountdown() {
  stopCountdown();
  countdownTimer = setInterval(updateCountdowns, 250);
}

function stopCountdown() {
  clearInterval(countdownTimer);
}

/** Der Laptop soll nicht in den Ruhezustand gehen, solange er "Ständer" ist */
async function keepAwake() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    if (!wakeLock && nav.wakeLock && document.visibilityState === "visible") {
      wakeLock = await nav.wakeLock.request("screen");
      (wakeLock as unknown as EventTarget).addEventListener?.("release", () => (wakeLock = null));
    }
  } catch {
    /* nicht unterstützt – egal */
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && station?.connected) void keepAwake();
});

// Los geht's
if (autoStart) start();
else showSetup();

