/**
 * Verbindung zum Backend – die einzige Stelle im Dashboard, die URLs kennt.
 * Das Login-Token liegt im localStorage des Browsers.
 */
const API_URL: string = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname}:3000`;
const TOKEN_KEY = 'radpark.admin.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized: (() => void) | null = null;
export const setOnUnauthorized = (fn: () => void) => {
  onUnauthorized = fn;
};

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', `Backend nicht erreichbar (${API_URL}). Läuft "pnpm dev:api"?`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? 'UNKNOWN', data?.message ?? `HTTP ${res.status}`);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Datentypen
// ---------------------------------------------------------------------------
export type DockStatus = 'available' | 'reserved' | 'occupied' | 'out_of_service';

export interface User {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

export interface Overview {
  stations: { total: number; online: number };
  docks: Record<DockStatus, number>;
  openSessions: number;
  today: { completedSessions: number; revenueCents: number; newUsers: number };
}

export interface AdminDock {
  id: string;
  number: number;
  status: DockStatus;
  lockState: 'locked' | 'unlocked' | 'jammed' | 'unknown';
  bikePresent: boolean;
  fault: string | null;
  stateUpdatedAt: string | null;
  sessionId: string | null;
  sessionStatus: 'reserved' | 'active' | null;
  sessionStartedAt: string | null;
  userEmail: string | null;
}

export interface AdminStation {
  id: string;
  code: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  pricePerHourCents: number;
  currency: string;
  online: boolean;
  lastSeenAt: string | null;
  firmware: string | null;
  docks: AdminDock[];
}

export interface OpenSession {
  id: string;
  status: 'reserved' | 'active';
  reservedAt: string;
  startedAt: string | null;
  pickupRequestedAt: string | null;
  userEmail: string;
  stationCode: string;
  stationName: string;
  dockNumber: number;
  runningPriceCents: number;
}

export interface AdminEvent {
  id: number;
  type: string;
  createdAt: string;
  payload: Record<string, unknown> | null;
  stationCode: string | null;
  dockNumber: number | null;
  userEmail: string | null;
}

export type DockCommand = 'unlock' | 'lock' | 'identify';

// ---------------------------------------------------------------------------
// Endpunkte
// ---------------------------------------------------------------------------
export const api = {
  requestCode: (email: string) => request<{ devCode?: string }>('POST', '/auth/request-code', { email }),
  verify: (email: string, code: string) => request<{ token: string; user: User }>('POST', '/auth/verify', { email, code }),
  me: () => request<User>('GET', '/me'),
  logout: () => request('POST', '/auth/logout'),

  overview: () => request<Overview>('GET', '/admin/overview'),
  stations: () => request<AdminStation[]>('GET', '/admin/stations'),
  openSessions: () => request<OpenSession[]>('GET', '/admin/sessions/open'),
  events: (type: string) => request<AdminEvent[]>('GET', `/admin/events?limit=100${type ? `&type=${encodeURIComponent(type)}` : ''}`),

  releaseDock: (id: string) => request('POST', `/admin/docks/${id}/release`),
  disableDock: (id: string, reason?: string) => request('POST', `/admin/docks/${id}/disable`, { reason }),
  dockCommand: (id: string, type: DockCommand) => request('POST', `/admin/docks/${id}/command`, { type }),
};
