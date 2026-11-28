/**
 * Töne der Klappe – wie der Summer im echten Kopfkasten.
 * Browser spielen erst Töne ab, nachdem man einmal auf die Seite geklickt hat → unlockAudio().
 */
let ctx: AudioContext | null = null;
let muted = false;

export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null; // kein Ton möglich – die Klappe funktioniert trotzdem
  }
}

export const audioReady = () => ctx?.state === "running";

export function setMuted(value: boolean) {
  muted = value;
}

function tone(freq: number, at: number, duration: number, type: OscillatorType, volume: number) {
  if (!ctx || muted || ctx.state !== "running") return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

/** Bügel wurde entriegelt: auffälliger Doppelton, dreimal */
export function alarmSound() {
  for (let i = 0; i < 3; i++) {
    tone(880, i * 0.42, 0.16, "square", 0.07);
    tone(1175, i * 0.42 + 0.18, 0.16, "square", 0.07);
  }
}

/** Lichttaster hat ein Rad erkannt / Rad ist raus */
export function sensorSound() {
  tone(1400, 0, 0.07, "sine", 0.12);
  tone(1800, 0.09, 0.07, "sine", 0.12);
}

/** Riegel fährt aus */
export function lockSound() {
  tone(220, 0, 0.18, "triangle", 0.2);
  tone(160, 0.12, 0.2, "triangle", 0.2);
}
