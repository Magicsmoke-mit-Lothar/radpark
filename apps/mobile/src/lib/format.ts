import { ApiError } from './api';

/** 150 → "1,50 €" */
export function formatMoney(cents: number, currency = 'EUR'): string {
  const symbol = currency === 'EUR' ? '€' : currency;
  return `${(cents / 100).toFixed(2).replace('.', ',')} ${symbol}`;
}

/** Laufende Uhr: 3725000 ms → "1:02:05" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Dauer für den Verlauf: "2 Std. 5 Min." */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} Min.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

/** "27.11.2026, 14:05" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 850 → "850 m", 2400 → "2,4 km" */
export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/**
 * Fehlercodes vom Backend → verständliche deutsche Meldung.
 * Später für weitere Sprachen einfach eine zweite Tabelle anlegen.
 */
const MESSAGES: Record<string, string> = {
  NETWORK: 'Keine Verbindung zum Server. Bist du im selben WLAN wie dein Rechner und läuft das Backend?',
  INVALID_INPUT: 'Bitte überprüfe deine Eingabe.',
  INVALID_CODE: 'Der Code ist falsch oder abgelaufen.',
  UNAUTHORIZED: 'Bitte melde dich erneut an.',
  STATION_OFFLINE: 'Diese Station ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.',
  NO_FREE_DOCK: 'An dieser Station ist leider kein Platz mehr frei.',
  DOCK_NOT_AVAILABLE: 'Dieser Platz wurde gerade vergeben. Bitte versuche es noch einmal.',
  ALREADY_PARKING: 'Du hast bereits ein Rad geparkt.',
  UNLOCK_FAILED: 'Der Bügel konnte nicht geöffnet werden. Bitte versuche es erneut.',
  NOT_ACTIVE: 'Dieser Parkvorgang läuft nicht mehr.',
  CANNOT_CANCEL: 'Dein Rad steht schon im Ständer – nutze „Rad abholen“.',
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return MESSAGES[err.code] ?? err.message;
  return 'Etwas ist schiefgelaufen. Bitte versuche es erneut.';
}

/** Warum endete ein Parkvorgang? (für den Verlauf) */
export function endReasonText(reason: string | null): string | null {
  switch (reason) {
    case 'BIKE_REMOVED':
      return null; // Normalfall, nichts anzeigen
    case 'BIKE_REMOVED_UNEXPECTEDLY':
      return '⚠️ Rad wurde ohne Abholung entnommen';
    case 'RELOCKED_WITHOUT_BIKE':
      return 'Kein Rad eingestellt';
    case 'USER_CANCELLED':
      return 'Abgebrochen';
    case 'RESERVATION_EXPIRED':
      return 'Reservierung abgelaufen';
    case 'UNLOCK_FAILED':
      return 'Bügel ließ sich nicht öffnen';
    default:
      return reason;
  }
}
