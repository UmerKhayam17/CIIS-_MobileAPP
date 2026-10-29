import { trailDistanceKm, type GpsHistoryPoint as ApiHistoryPoint } from "../lib/gps-api"

/**
 * Presentation-only summary of a GPS trail (distance, moving time, stops) computed on the
 * phone from `fetchGpsHistory` points. The backend may also send per-point speed and a place
 * name; they are read when present and ignored otherwise.
 */
type GpsHistoryPoint = ApiHistoryPoint & { speedKmh?: number | null; locationName?: string }

export type RouteStop = {
  latitude: number
  longitude: number
  from: string | null
  to: string | null
  durationSec: number
  locationName?: string
}

export type RouteSummary = {
  points: GpsHistoryPoint[]
  distanceKm: number
  durationSec: number
  movingSec: number
  avgSpeedKmh: number | null
  maxSpeedKmh: number | null
  start: GpsHistoryPoint | null
  end: GpsHistoryPoint | null
  stops: RouteStop[]
}

/** Great-circle distance in metres. */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s1 = Math.sin(dLat / 2)
  const s2 = Math.sin(dLng / 2)
  const h = s1 * s1 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * s2 * s2
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)))
}

function ts(p: GpsHistoryPoint): number {
  return p.recordedAt ? new Date(p.recordedAt).getTime() : NaN
}

/**
 * Distance, timing and stops for a GPS trail. A stop is a run of points that stays within
 * `radiusM` of where it began for at least `minStopSec`.
 */
export function summarizeRoute(raw: GpsHistoryPoint[], minStopSec = 300, radiusM = 80): RouteSummary {
  const points = raw
    .filter((p) => p.latitude != null && p.longitude != null && !(p.latitude === 0 && p.longitude === 0))
    .sort((a, b) => (ts(a) || 0) - (ts(b) || 0))

  const start = points[0] ?? null
  const end = points[points.length - 1] ?? null
  const durationSec = start && end && ts(end) > ts(start) ? (ts(end) - ts(start)) / 1000 : 0

  let movingSec = 0
  let maxSpeed: number | null = null
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const dt = (ts(b) - ts(a)) / 1000
    if (!(dt > 0) || dt > 600) continue
    const kmh = (distanceM(a.latitude, a.longitude, b.latitude, b.longitude) / dt) * 3.6
    if (kmh >= 3 && kmh < 250) movingSec += dt
    const reported = b.speedKmh ?? (kmh < 250 ? kmh : null)
    if (reported != null && (maxSpeed == null || reported > maxSpeed)) maxSpeed = reported
  }

  const stops: RouteStop[] = []
  let i = 0
  while (i < points.length) {
    const anchor = points[i]
    let j = i
    while (j + 1 < points.length && distanceM(anchor.latitude, anchor.longitude, points[j + 1].latitude, points[j + 1].longitude) <= radiusM) j++
    const span = (ts(points[j]) - ts(anchor)) / 1000
    if (j > i && span >= minStopSec) {
      const run = points.slice(i, j + 1)
      stops.push({
        latitude: run.reduce((s, p) => s + p.latitude, 0) / run.length,
        longitude: run.reduce((s, p) => s + p.longitude, 0) / run.length,
        from: anchor.recordedAt,
        to: points[j].recordedAt,
        durationSec: span,
        locationName: run.find((p) => p.locationName)?.locationName,
      })
      i = j + 1
    } else {
      i++
    }
  }

  const distanceKm = trailDistanceKm(points)
  return {
    points,
    distanceKm,
    durationSec,
    movingSec,
    avgSpeedKmh: movingSec > 60 ? distanceKm / (movingSec / 3600) : null,
    maxSpeedKmh: maxSpeed,
    start,
    end,
    stops,
  }
}
