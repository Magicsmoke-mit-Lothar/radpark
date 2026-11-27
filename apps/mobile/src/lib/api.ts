/**
 * Alles, was die App vom Backend braucht – an einer Stelle.
 * Die Bildschirme rufen nur diese Funktionen auf und müssen keine URLs kennen.
 */
import { API_URL } from './config';

// ---------------------------------------------------------------------------
// Datentypen (so, wie das Backend sie liefert)
// ---------------------------------------------------------------------------
export interface Station {
  id: string;
  code: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  pricePerHourCents: number;
  currency: string;
  online: boolean;
  freeDocks: number;
  totalDocks: number;
  distanceM?: number;
}

export type SessionStatus = 'reserved' | 'active' | 'completed' | 'cancelled';

export interface Parking {
  id: string;
  status: SessionStatus;
  reservedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  pickupRequestedAt: string | null;
  priceCents: number | null;
  currency: string;
  endReason: string | null;
  dockNumber: number;
  stationId: string;
  stationCode: string;
  stationName: string;
  pricePerHourCents: number;
  runningPriceCents?: number;
}

export interface User {
  id: string;
  email: string;
  displayName: string | null;
}

export interface WalletTx {
  id: string;
  type: 'topup' | 'parking' | 'bonus' | 'refund' | 'adjustment';
  amountCents: number;
  balanceAfterCents: number;
  description: string | null;
  createdAt: string;
}

export interface Wallet {
  balanceCents: number;
  currency: string;
  transactions: WalletTx[];
  topupOptions: number[];
  minStartBalanceCents: number;
  provider: 'stripe' | 'fake';
  testMode: boolean;
}

/** Fehler vom Backend, z. B. { error: "NO_FREE_DOCK", message: "…" } */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Weitere Felder der Fehlerantwort, z. B. retryAfterSeconds */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Grundfunktion für alle Anfragen
// ---------------------------------------------------------------------------
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Wird vom Login-System gesetzt */
export function setAuthToken(token: string | null) {
  authToken = token;
}
export function setOnUnauthorized(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  // Nach 15 s aufgeben (Entriegeln kann einige Sekunden dauern, aber nicht ewig)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', `Backend nicht erreichbar (${API_URL})`);
  } finally {
    clearTimeout(timeout);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && authToken) onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? 'UNKNOWN', data?.message ?? `HTTP ${res.status}`, data ?? {});
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Die einzelnen Endpunkte
// ---------------------------------------------------------------------------
export const api = {
  requestCode: (email: string) =>
    request<{ sent: boolean; resendAfterSeconds: number; devCode?: string }>('POST', '/auth/request-code', { email }),
  verifyCode: (email: string, code: string) =>
    request<{ token: string; user: User }>('POST', '/auth/verify', { email, code }),
  me: () => request<User>('GET', '/me'),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),

  stations: () => request<Station[]>('GET', '/stations'),

  currentParking: () => request<{ parking: Parking | null }>('GET', '/parkings/current').then((r) => r.parking),
  history: () => request<Parking[]>('GET', '/parkings'),
  startParking: (stationId: string) => request<Parking>('POST', '/parkings', { stationId }),
  pickup: (id: string) => request<Parking>('POST', `/parkings/${id}/pickup`),
  cancel: (id: string) => request<Parking>('POST', `/parkings/${id}/cancel`),

  /** Was kann der Server? (z. B. ob es Simulator-Knöpfe gibt) */
  meta: () => request<{ simulatorControl: boolean; paymentProvider: 'stripe' | 'fake'; testMode: boolean }>('GET', '/meta'),
  /** Nur mit Simulator: "Rad einstellen" / "Rad entnehmen" auslösen */
  simulate: (stationCode: string, dock: number, action: 'park' | 'take') =>
    request<{ ok: boolean }>('POST', `/sim/stations/${stationCode}/docks/${dock}/action`, { action }),

  wallet: () => request<Wallet>('GET', '/wallet'),
  startTopup: (amountCents: number, returnUrl: string) =>
    request<{ topupId: string; status: string; checkoutUrl: string | null }>('POST', '/wallet/topups', { amountCents, returnUrl }),
  confirmTopup: (id: string) => request<{ status: string; balanceCents: number }>('POST', `/wallet/topups/${id}/confirm`),
};
