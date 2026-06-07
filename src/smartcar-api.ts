// Thin client for the VoltPass Smartcar connector (server-side). The browser
// never sees Smartcar secrets or tokens — only these endpoints.

// Resolve the Render backend base URL from the Vite env var injected at build
// time. Falls back to the relative path so local dev (vite proxy) still works.
const BASE = (import.meta.env.VITE_SMARTCAR_API_URL as string | undefined) ?? '/api/smartcar';

export interface ConnectedVehicle {
  smartcarId: string;
  make: string;
  model: string;
  year: number;
  voltpassVehicleId: string | null;
}

export interface SmartcarStatus {
  configured: boolean;
  mode: "live" | "test" | "simulator";
  geofence: { lat: number; lng: number; radiusM: number };
  connectedCount: number;
}

export interface SnapshotResult {
  batteryPct: number;
  odometer: number;
  latitude: number;
  longitude: number;
  lockStatus: string;
  chargeStatus: string;
  source: "smartcar_live" | "simulator";
  locationConfirmed: boolean;
  expectedLocation: { lat: number; lng: number; radiusM: number };
}

export interface UnlockResult {
  commandSent: boolean;
  lockStatus: string;
  source: "smartcar_live" | "simulator";
  message: string;
}

/** Throw a friendly error when the backend is sleeping or returning HTML. */
async function guardJson(r: Response, label: string): Promise<Response> {
  if (!r.ok) {
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      // Render free tier returns HTML splash/503 while waking up
      throw new Error(
        `Render backend waking up (${r.status}) — refresh in 30 seconds.`,
      );
    }
    const body = await r.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      (body.error as string | undefined) ?? `${label} failed (${r.status})`,
    );
  }
  const ct = r.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new Error(
      `Render backend waking up — got HTML instead of JSON. Refresh in 30 seconds.`,
    );
  }
  return r;
}

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  await guardJson(r, `GET ${url}`);
  return r.json();
}

async function jpost<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  await guardJson(r, `POST ${url}`);
  return r.json();
}

export const smartcar = {
  status: () => jget<SmartcarStatus>(`${BASE}/status`),
  authUrl: () => jget<{ url: string; mode: string }>(`${BASE}/auth-url`),
  callback: (code: string) =>
    jget<{ ok: boolean; vehicles: ConnectedVehicle[] }>(
      `${BASE}/callback?code=${encodeURIComponent(code)}`,
    ),
  connectSimulator: () =>
    jpost<{ ok: boolean; vehicles: ConnectedVehicle[] }>(`${BASE}/connect-simulator`),
  vehicles: () => jget<{ vehicles: ConnectedVehicle[] }>(`${BASE}/vehicles`),
  snapshot: (smartcarId: string, vehicleId: string, tripId?: string) =>
    jpost<SnapshotResult>(`${BASE}/snapshot`, { smartcarId, vehicleId, tripId }),
  unlock: (smartcarId: string, vehicleId: string, tripId?: string, advanceTrip = true) =>
    jpost<UnlockResult>(`${BASE}/unlock`, { smartcarId, vehicleId, tripId, advanceTrip }),
};
