import { API_BASE_URL, getAuthHeaders, fetchWithTimeout } from "./api"

const API = `${API_BASE_URL}/api/gps`

export type GpsStatus = "live" | "stale" | "offline"

export type GpsOfficer = {
  userId: number
  username: string
  name: string
  role: string
  employeeId?: string
  location: string
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  recordedAt: string | null
  onDuty: boolean
  dutyStartedAt: string | null
  batteryPct: number | null
  speedKmh?: number | null
  headingDeg?: number | null
  altitudeM?: number | null
  hasFix?: boolean
  status: GpsStatus
}

export type GpsHistoryPoint = {
  latitude: number
  longitude: number
  accuracy: number | null
  recordedAt: string | null
  speedKmh?: number | null
  status?: string
  locationName?: string
}

export type GpsPingPayload = {
  latitude: number
  longitude: number
  accuracy?: number | null
  recordedAt?: string
  client_timestamp?: string
  speedKmh?: number | null
  headingDeg?: number | null
  altitudeM?: number | null
  batteryPct?: number | null
  battery_level?: number | null
  event_id?: string
  device_uuid?: string
  session_id?: string
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json()
    if (typeof data?.detail === "string") return data.detail
  } catch {
    /* ignore */
  }
  return fallback
}

export async function fetchGpsLive(location?: string, includeOffDuty = false): Promise<GpsOfficer[]> {
  const sp = new URLSearchParams()
  if (location && location !== "all") sp.set("location", location)
  if (includeOffDuty) sp.set("include_off_duty", "1")
  const q = sp.toString() ? `?${sp}` : ""
  const res = await fetchWithTimeout(`${API}/live/${q}`, { headers: await getAuthHeaders() })
  if (!res.ok) throw new Error(await readError(res, "Failed to load live GPS"))
  const data = await res.json()
  return Array.isArray(data?.officers) ? data.officers : []
}

export async function fetchGpsMe(): Promise<GpsOfficer> {
  const res = await fetchWithTimeout(`${API}/me/`, { headers: await getAuthHeaders() })
  if (!res.ok) throw new Error(await readError(res, "Failed to load GPS status"))
  return res.json()
}

export async function postGpsDuty(action: "start" | "stop"): Promise<GpsOfficer> {
  const res = await fetchWithTimeout(`${API}/duty/`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ action }),
  })
  if (!res.ok) throw new Error(await readError(res, "Failed to update duty"))
  return res.json()
}

export async function postGpsHeartbeat(): Promise<void> {
  try {
    await fetchWithTimeout(`${API}/heartbeat/`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: "{}",
    })
  } catch {
    /* best-effort */
  }
}

export async function postMobileGps(payload: GpsPingPayload): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/mobile/gps/`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await readError(res, "Failed to send GPS ping"))
}

export async function fetchGpsHistory(userId: number, hours = 24): Promise<GpsHistoryPoint[]> {
  const res = await fetchWithTimeout(`${API}/history/${userId}/?hours=${hours}`, {
    headers: await getAuthHeaders(),
  })
  if (!res.ok) throw new Error(await readError(res, "Failed to load GPS history"))
  const data = await res.json()
  return Array.isArray(data?.points) ? data.points : []
}

export function trailDistanceKm(points: GpsHistoryPoint[]): number {
  const r = 6371000
  let meters = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const dLat = ((b.latitude - a.latitude) * Math.PI) / 180
    const dLng = ((b.longitude - a.longitude) * Math.PI) / 180
    const s1 = Math.sin(dLat / 2)
    const s2 = Math.sin(dLng / 2)
    const h =
      s1 * s1 +
      Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * s2 * s2
    const d = 2 * r * Math.asin(Math.min(1, Math.sqrt(h)))
    if (d > 50_000) continue
    meters += d
  }
  return meters / 1000
}

export function hoursSinceLocalMidnight(): number {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 3_600_000))
}
