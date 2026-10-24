import { API_BASE_URL, getAuthHeaders, getStoredToken, isNetworkError, fetchWithTimeout } from "./api"
import { getOrCreateDeviceUuid } from "./device"
import { getCachedUser } from "./auth"
import { getItem, setItem, removeItem } from "./storage"
import {
  createOfflineEvent,
  enqueueOfflineEvent,
  listPendingEvents,
  deleteEvent,
  bumpEventAttempts,
  MAX_UPLOAD_ATTEMPTS,
  type OfflineEvent,
} from "./queue"

const SESSION_KEY = "ciis_mobile_session_id"
let sessionCache: string | null = null

export type MobileSessionInfo = {
  session_id: string
  status?: string
  device_uuid?: string
  gps_required?: boolean
}

export async function saveMobileSession(session: MobileSessionInfo | null | undefined): Promise<void> {
  if (!session?.session_id) return
  sessionCache = session.session_id
  await setItem(SESSION_KEY, session.session_id)
}

export async function loadMobileSessionId(): Promise<string> {
  if (sessionCache !== null) return sessionCache
  sessionCache = (await getItem(SESSION_KEY)) || ""
  return sessionCache
}

export function getMobileSessionId(): string {
  return sessionCache || ""
}

export async function clearMobileSession(): Promise<void> {
  sessionCache = ""
  await removeItem(SESSION_KEY)
}

async function identityFields() {
  return {
    device_uuid: await getOrCreateDeviceUuid(),
    session_id: getMobileSessionId(),
  }
}

function userId(): number | null {
  return getCachedUser()?.id ?? null
}

export async function postMobileJson(url: string, body: Record<string, unknown>): Promise<Response> {
  const headers = await getAuthHeaders()
  return fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...(await identityFields()), ...body }),
  })
}

export async function sendHeartbeat(extra: Record<string, unknown> = {}): Promise<void> {
  if (!(await getStoredToken())) return
  const payload = { timestamp: new Date().toISOString(), ...extra }
  const event = createOfflineEvent(
    "heartbeat",
    await getOrCreateDeviceUuid(),
    getMobileSessionId(),
    payload,
    userId(),
  )
  try {
    const res = await postMobileJson(`${API_BASE_URL}/api/mobile/heartbeat/`, {
      ...payload,
      event_id: event.event_id,
    })
    if (!res.ok) throw new Error("heartbeat failed")
  } catch (err) {
    if (isNetworkError(err)) await enqueueOfflineEvent(event)
  }
}

export async function sendMobileEvent(eventName: string, extra: Record<string, unknown> = {}): Promise<void> {
  if (!(await getStoredToken()) && eventName !== "LOGOUT") return
  const payload = { event: eventName, event_type: eventName, ...extra }
  const event = createOfflineEvent(
    "mobile_event",
    await getOrCreateDeviceUuid(),
    getMobileSessionId(),
    payload,
    userId(),
  )
  try {
    const res = await postMobileJson(`${API_BASE_URL}/api/mobile-events/`, {
      ...payload,
      event_id: event.event_id,
    })
    if (!res.ok) throw new Error("event failed")
  } catch (err) {
    if (isNetworkError(err)) await enqueueOfflineEvent(event)
  }
}

export async function reportMobileEvent(event: string): Promise<void> {
  if (!(await getStoredToken())) return
  try {
    const res = await postMobileJson(`${API_BASE_URL}/api/activity-logs/report/`, { event })
    if (!res.ok) throw new Error("report failed")
  } catch {
    /* activity reporting is best-effort */
  }
}

export async function transitionMobileSession(state: "using" | "locked"): Promise<void> {
  if (!(await getStoredToken())) return
  try {
    await postMobileJson(`${API_BASE_URL}/api/mobile-sessions/transition/`, { state })
  } catch {
    /* best-effort */
  }
}

export async function endMobileSession(): Promise<void> {
  if (!(await getStoredToken())) return
  try {
    await postMobileJson(`${API_BASE_URL}/api/mobile-sessions/end/`, {})
  } catch {
    /* ignore */
  }
}

export async function logoutMobileSession(): Promise<void> {
  const payload = { event: "LOGOUT" }
  const event = createOfflineEvent(
    "logout",
    await getOrCreateDeviceUuid(),
    getMobileSessionId(),
    payload,
    userId(),
  )
  try {
    const res = await postMobileJson(`${API_BASE_URL}/api/auth/logout/`, {
      ...payload,
      event_id: event.event_id,
    })
    if (!res.ok) throw new Error("logout failed")
  } catch (err) {
    if (isNetworkError(err)) await enqueueOfflineEvent(event)
  }
}

async function uploadEvent(item: OfflineEvent): Promise<boolean> {
  const endpoints: Record<string, string> = {
    gps: `${API_BASE_URL}/api/mobile/gps/`,
    heartbeat: `${API_BASE_URL}/api/mobile/heartbeat/`,
    logout: `${API_BASE_URL}/api/auth/logout/`,
    lock: `${API_BASE_URL}/api/mobile-sessions/transition/`,
    attendance: `${API_BASE_URL}/api/attendance/`,
    mobile_event: `${API_BASE_URL}/api/mobile-events/`,
    call_log: `${API_BASE_URL}/api/v1/employee-monitor/calls/ingest/`,
  }
  const url = endpoints[item.event_type] || endpoints.mobile_event
  const res = await postMobileJson(url, {
    ...item.payload,
    event_id: item.event_id,
    client_timestamp: item.client_timestamp,
  })
  return res.ok
}

let flushing = false

export async function flushOfflineQueue(): Promise<void> {
  if (!(await getStoredToken())) return
  if (flushing) return
  flushing = true
  try {
    const me = userId()
    const pending = await listPendingEvents()
    for (const item of pending) {
      // Never upload one user's events under another user's token on a shared phone.
      if (item.user_id != null && me != null && item.user_id !== me) continue
      let ok = false
      try {
        ok = await uploadEvent(item)
      } catch {
        break // network dropped — keep everything, retry on the next online/foreground event
      }
      if (ok) {
        await deleteEvent(item.event_id)
        continue
      }
      // Server rejected it: count it, drop once clearly poison, but keep draining the rest.
      const attempts = await bumpEventAttempts(item.event_id)
      if (attempts >= MAX_UPLOAD_ATTEMPTS) await deleteEvent(item.event_id)
    }
  } finally {
    flushing = false
  }
}
