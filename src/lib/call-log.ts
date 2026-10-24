import { Platform, PermissionsAndroid } from "react-native"
import { API_BASE_URL, getAuthHeaders, getStoredToken, fetchWithTimeout, isNetworkError } from "./api"
import { getItem, setItem, removeItem } from "./storage"
import { getOrCreateDeviceUuid } from "./device"
import { getCachedUser, shouldTrackLocation } from "./auth"
import { getMobileSessionId, loadMobileSessionId } from "./mobile"
import { createOfflineEvent, enqueueOfflineEvent } from "./queue"
import { getCallLog, hasCallLogPermission, isCallLogSupported, type NativeCall } from "../../modules/call-log"

/**
 * Call-log collection for field staff (Android only). The device call log — number, direction,
 * time and duration, never audio — is read and uploaded to the employee-monitoring backend so
 * the admin's Calls screen can show it.
 *
 * Guardrails, all of which must pass before a single row is read:
 *  - Android only, and only when the native module is present (a dev build, not Expo Go / web).
 *  - Only for roles that are field-tracked (same rule as GPS); desk/admin accounts are skipped.
 *  - Only after the signed-in user has acknowledged the on-device disclosure (CallLogConsent).
 *  - Only with the READ_CALL_LOG runtime permission granted.
 * A cursor (newest timestamp uploaded) means each call is sent once; offline batches buffer to
 * the shared queue and upload when the phone is back online, exactly like GPS points.
 */

const CURSOR_KEY = "ciis_calllog_cursor"
const CONSENT_KEY = "ciis_calllog_consent"
const MAX_ROWS = 500

const INGEST_URL = `${API_BASE_URL}/api/v1/employee-monitor/calls/ingest/`

export type CallLogConsent = "granted" | "declined" | "none"

export async function getCallLogConsent(): Promise<CallLogConsent> {
  const v = await getItem(CONSENT_KEY)
  return v === "granted" || v === "declined" ? v : "none"
}

export async function setCallLogConsent(value: CallLogConsent): Promise<void> {
  if (value === "none") await removeItem(CONSENT_KEY)
  else await setItem(CONSENT_KEY, value)
}

/** Does this account get its calls collected? Same population as GPS tracking. */
export function shouldCollectCalls(): boolean {
  return Platform.OS === "android" && isCallLogSupported() && shouldTrackLocation()
}

/** Prompt for READ_CALL_LOG if not already granted. Returns whether it is granted now. */
export async function ensureCallLogPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false
  if (hasCallLogPermission()) return true
  try {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
      {
        title: "CIIS call records",
        message: "CIIS records your call log (numbers, time and duration) while you are on duty.",
        buttonPositive: "Allow",
        buttonNegative: "Not now",
      },
    )
    return res === PermissionsAndroid.RESULTS.GRANTED
  } catch {
    return false
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `call_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

/** Shape sent to the backend. Full number is sent; the backend masks it for display. */
function toRecord(c: NativeCall) {
  return {
    client_id: c.id,
    number: c.number,
    direction: c.direction,
    started_at: new Date(c.timestamp).toISOString(),
    duration_seconds: c.duration,
  }
}

async function postCallBatch(body: Record<string, unknown>): Promise<void> {
  const res = await fetchWithTimeout(INGEST_URL, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`call ingest failed (${res.status})`)
}

let running = false

/**
 * Read any call-log entries newer than the cursor and upload them. Safe to call often
 * (on login, on foreground): it returns early whenever a guardrail fails or nothing is new,
 * and never throws to its caller.
 */
export async function syncCallLog(): Promise<void> {
  if (running) return
  if (!shouldCollectCalls()) return
  if (!(await getStoredToken())) return
  if ((await getCallLogConsent()) !== "granted") return
  if (!(await ensureCallLogPermission())) return

  running = true
  try {
    await loadMobileSessionId()
    const cursor = Number((await getItem(CURSOR_KEY)) || "0")

    let calls: NativeCall[]
    try {
      calls = await getCallLog(cursor, MAX_ROWS)
    } catch {
      return // permission revoked mid-session or provider error — try again next time
    }
    if (!calls.length) return

    const deviceUuid = await getOrCreateDeviceUuid()
    const maxTs = calls.reduce((m, c) => Math.max(m, c.timestamp), cursor)
    const payload: Record<string, unknown> = {
      calls: calls.map(toRecord),
      device_uuid: deviceUuid,
      session_id: getMobileSessionId(),
      event_id: newId(),
      client_timestamp: new Date().toISOString(),
    }

    try {
      await postCallBatch(payload)
      await setItem(CURSOR_KEY, String(maxTs))
    } catch (err) {
      if (isNetworkError(err)) {
        // Buffer the batch; the cursor still advances so the queue owns these rows and we
        // don't re-read them next pass (matches how GPS advances lastSent on enqueue).
        await enqueueOfflineEvent(
          createOfflineEvent("call_log", deviceUuid, getMobileSessionId(), payload, getCachedUser()?.id ?? null),
        )
        await setItem(CURSOR_KEY, String(maxTs))
      }
      // A non-network failure (e.g. backend module off) leaves the cursor untouched: retry later.
    }
  } finally {
    running = false
  }
}

/** Called on sign-out so the next user on a shared phone starts clean. */
export async function resetCallLogState(): Promise<void> {
  await removeItem(CURSOR_KEY)
  await removeItem(CONSENT_KEY)
}
