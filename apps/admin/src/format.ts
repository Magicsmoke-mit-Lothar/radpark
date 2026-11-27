import { ApiError, type DockStatus } from './api';

export const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

/** "vor 3 Min." – relative Zeitangabe */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '–';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `vor ${s} s`;
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  return `vor ${Math.floor(s / 86400)} Tg.`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function duration(fromIso: string, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000));
  return min < 60 ? `${min} Min.` : `${Math.floor(min / 60)} Std. ${min % 60} Min.`;
}

export const dockStatusLabel: Record<DockStatus, string> = {
  available: 'Frei',
  reserved: 'Reserviert',
  occupied: 'Belegt',
  out_of_service: 'Gesperrt',
};

export const lockLabel = { locked: 'verriegelt', unlocked: 'offen', jammed: 'klemmt', unknown: 'unbekannt' } as const;

/** Ereignistypen in verständlicher Sprache */
const eventLabels: Record<string, string> = {
  'station.online': 'Station online',
  'station.offline': 'Station offline',
  'dock.bike_detected': 'Rad erkannt',
  'dock.bike_removed': 'Rad entnommen',
  'dock.unbooked_bike': 'Rad ohne Buchung',
  'dock.fault': 'Störung',
  'dock.released': 'Dock freigegeben',
  'dock.disabled': 'Dock gesperrt',
  'command.sent': 'Befehl gesendet',
  'command.acked': 'Befehl ausgeführt',
  'command.failed': 'Befehl fehlgeschlagen',
  'user.registered': 'Neuer Nutzer',
  'user.login': 'Login',
  'session.reserved': 'Platz reserviert',
  'session.started': 'Parken gestartet',
  'session.pickup_requested': 'Abholung angefordert',
  'session.pickup_timeout': 'Abholung abgelaufen',
  'session.completed': 'Parken beendet',
  'session.cancelled': 'Reservierung abgebrochen',
};
export const eventLabel = (type: string) => eventLabels[type] ?? type;

/** Wie "laut" ist ein Ereignis? (für die Farbe im Protokoll) */
export function eventTone(type: string, payload: Record<string, unknown> | null): 'danger' | 'warning' | 'ok' | 'neutral' {
  if (type === 'dock.fault' || type === 'station.offline' || type === 'command.failed') return 'danger';
  if (type === 'session.completed' && payload?.expected === false) return 'danger';
  if (type === 'dock.unbooked_bike' || type === 'session.pickup_timeout' || type === 'dock.disabled') return 'warning';
  if (type === 'session.completed' || type === 'station.online' || type === 'dock.released') return 'ok';
  return 'neutral';
}

/** Kurze Zusatzinfo zu einem Ereignis */
export function eventDetail(type: string, p: Record<string, unknown> | null): string {
  if (!p) return '';
  if (type === 'session.completed') return `${money(Number(p.priceCents ?? 0))}${p.expected === false ? ' · ⚠️ ohne Abholung!' : ''}`;
  if (type === 'session.cancelled') return String(p.reason ?? '');
  if (type === 'command.sent') return `${p.type} (${p.via})`;
  if (type === 'command.failed') return String(p.error ?? '');
  if (type === 'dock.fault') return String(p.fault ?? p.lock ?? '');
  if (type === 'dock.disabled') return String(p.reason ?? '');
  return '';
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Unbekannter Fehler';
}
