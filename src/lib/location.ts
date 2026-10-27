import { useEffect, useState } from "react"
import * as Location from "expo-location"
import * as TaskManager from "expo-task-manager"
import { isNetworkError } from "./api"
import { getOrCreateDeviceUuid } from "./device"
import { loadStoredUser, shouldTrackLocation, getCachedUser } from "./auth"
import { loadMobileSessionId, getMobileSessionId, flushOfflineQueue, sendMobileEvent } from "./mobile"
import { createOfflineEvent, enqueueOfflineEvent } from "./queue"
import { fetchGpsMe, postGpsDuty, postMobileGps, type GpsPingPayload } from "./gps-api"

export const LOCATION_TASK = "ciis-background-location"

export type GpsLifecycle =
  | "GPS_DISABLED"
  | "GPS_PERMISSION_DENIED"
  | "GPS_ACTIVE"
  | "GPS_PAUSED"
  | "GPS_OFFLINE"
  | "GPS_STOPPED"

export type TrackingStatus = {
  running: boolean
  eligible: boolean
  error: string | null
  lastFixAt: number | null
  lifecycle: GpsLifecycle
  background: boolean
}

let status: TrackingStatus = {
  running: false,
  eligible: false,
  error: null,
  lastFixAt: null,
  lifecycle: "GPS_STOPPED",
  background: false,
}

type Listener = (s: TrackingStatus) => void
const listeners = new Set<Listener>()

function publish(next: Partial<TrackingStatus>) {
  status = { ...status, ...next }
  listeners.forEach((l) => l(status))
}

export function getTrackingStatus(): TrackingStatus {
  return status
}

export function useTrackingStatus(): TrackingStatus {
  const [current, setCurrent] = useState(status)
  useEffect(() => {
    const listener: Listener = (s) => setCurrent(s)
    listeners.add(listener)
    setCurrent(status)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return current
}

let foregroundSub: Location.LocationSubscription | null = null
let lastSent: { lat: number; lng: number; at: number } | null = null

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s1 = Math.sin(dLat / 2)
  const s2 = Math.sin(dLng / 2)
  const h = s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)))
}

const MOVE_THRESHOLD_M = 8
const MIN_INTERVAL_MS = 8000
const IDLE_INTERVAL_MS = 20000

function dueToSend(lat: number, lng: number): boolean {
  const now = Date.now()
  if (!lastSent) return true
  const moved = haversineM({ lat: lastSent.lat, lng: lastSent.lng }, { lat, lng })
  const elapsed = now - lastSent.at
  return (moved >= MOVE_THRESHOLD_M && elapsed >= MIN_INTERVAL_MS) || elapsed >= IDLE_INTERVAL_MS
}

function newEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `gps_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

/**
 * Build and send one GPS point. On a network failure it is buffered to the offline
 * queue (stamped with device/session/user) and uploads later — so a point captured
 * with mobile data off is never lost and the route backfills when data returns.
 */
export async function sendPing(loc: Location.LocationObject): Promise<void> {
  const { coords } = loc
  if (!dueToSend(coords.latitude, coords.longitude)) return

  await loadStoredUser()
  await loadMobileSessionId()
  const deviceUuid = await getOrCreateDeviceUuid()
  const nowIso = new Date(loc.timestamp || Date.now()).toISOString()

  const payload: GpsPingPayload = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy ?? null,
    recordedAt: nowIso,
    client_timestamp: nowIso,
    speedKmh: coords.speed != null && coords.speed >= 0 ? coords.speed * 3.6 : null,
    headingDeg: coords.heading != null && coords.heading >= 0 ? coords.heading : null,
    altitudeM: coords.altitude ?? null,
    event_id: newEventId(),
    device_uuid: deviceUuid,
    session_id: getMobileSessionId(),
  }

  try {
    await postMobileGps(payload)
    lastSent = { lat: coords.latitude, lng: coords.longitude, at: Date.now() }
    publish({ error: null, lastFixAt: Date.now(), running: true, eligible: true, lifecycle: "GPS_ACTIVE" })
    void flushOfflineQueue()
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueOfflineEvent(
        createOfflineEvent(
          "gps",
          deviceUuid,
          getMobileSessionId(),
          payload as unknown as Record<string, unknown>,
          getCachedUser()?.id ?? null,
        ),
      )
      lastSent = { lat: coords.latitude, lng: coords.longitude, at: Date.now() }
      publish({
        error: "No network — GPS points are saved on this phone and will upload when you are online.",
        lastFixAt: Date.now(),
        running: true,
        eligible: true,
        lifecycle: "GPS_OFFLINE",
      })
      return
    }
    publish({ error: err instanceof Error ? err.message : "GPS ping failed" })
  }
}

// Background task — must be defined at module top level, not inside a function.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return
  const locations = (data as { locations?: Location.LocationObject[] })?.locations
  if (!locations?.length) return
  for (const loc of locations) {
    await sendPing(loc)
  }
})

async function startBackgroundUpdates(): Promise<boolean> {
  try {
    const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
    if (already) return true
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 10000,
      distanceInterval: 10,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "CIIS location sharing",
        notificationBody: "Your duty location is being recorded while you are on duty.",
        notificationColor: "#1d4ed8",
      },
    })
    return true
  } catch {
    return false
  }
}

async function startForegroundWatch(): Promise<void> {
  if (foregroundSub) return
  foregroundSub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 8000, distanceInterval: 8 },
    (loc) => {
      void sendPing(loc)
    },
  )
}

export async function startTracking(): Promise<void> {
  if (!shouldTrackLocation()) {
    publish({ running: false, eligible: false, error: null, lifecycle: "GPS_DISABLED" })
    return
  }
  publish({ eligible: true, lifecycle: "GPS_PAUSED", error: null })

  const fg = await Location.requestForegroundPermissionsAsync()
  if (fg.status !== "granted") {
    publish({
      running: false,
      eligible: true,
      lifecycle: "GPS_PERMISSION_DENIED",
      error: "Location permission is required for CIIS field-duty tracking.",
    })
    void sendMobileEvent("GPS_PERMISSION_DENIED")
    return
  }

  // Try duty start; if offline, keep going and let it sync later (don't lose points).
  try {
    const me = await fetchGpsMe()
    if (!me.onDuty) await postGpsDuty("start")
  } catch (err) {
    if (!isNetworkError(err)) {
      publish({
        running: false,
        eligible: true,
        lifecycle: "GPS_OFFLINE",
        error: err instanceof Error ? err.message : "Could not start GPS",
      })
      // still fall through to begin watching
    }
  }

  // Ask for background ("Allow all the time") and start the foreground service; fall back
  // to a foreground-only watch when background isn't available (e.g. inside Expo Go).
  let background = false
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ status: "denied" }))
  if (bg.status === "granted") background = await startBackgroundUpdates()
  if (!background) await startForegroundWatch()

  void sendMobileEvent("GPS_STARTED")
  publish({ running: true, eligible: true, lifecycle: "GPS_ACTIVE", background })
  void flushOfflineQueue()
}

export async function stopTracking(opts?: { endDuty?: boolean }): Promise<void> {
  if (foregroundSub) {
    foregroundSub.remove()
    foregroundSub = null
  }
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
    if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
  } catch {
    /* ignore */
  }
  lastSent = null
  publish({ running: false, eligible: shouldTrackLocation(), error: null, lifecycle: "GPS_STOPPED", background: false })
  if (opts?.endDuty) {
    try {
      await postGpsDuty("stop")
    } catch {
      /* ignore */
    }
  }
}
