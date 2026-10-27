import { PermissionsAndroid, Platform } from "react-native"
import { loadCallLogModule, type DeviceCallRow } from "../../modules/ciis-call-log/src"
import { getOrCreateDeviceUuid } from "./device"
import {
  MonitorApiError,
  fetchMonitorConsent,
  fetchMonitorPolicy,
  policyAllowsHandset,
  uploadDeviceCalls,
  type DeviceCallUpload,
} from "./call-api"
import { clearCallQueue, enqueueCalls, readCallQueue, removeQueuedCalls } from "./call-queue"

const READ_CALL_LOG = "android.permission.READ_CALL_LOG" as const

export type CallPermission = "granted" | "denied" | "blocked" | "unavailable"

let syncing = false

export function androidCallLogSupported(): boolean {
  return Platform.OS === "android" && loadCallLogModule() != null
}

export async function callLogPermission(): Promise<CallPermission> {
  if (!androidCallLogSupported()) return "unavailable"
  const granted = await PermissionsAndroid.check(READ_CALL_LOG)
  return granted ? "granted" : "denied"
}

export async function requestCallLogPermission(): Promise<CallPermission> {
  if (!androidCallLogSupported()) return "unavailable"
  const result = await PermissionsAndroid.request(READ_CALL_LOG, {
    title: "Call history",
    message:
      "CIIS uploads incoming, outgoing and missed call numbers, times and durations from this work phone after you allow it. CIIS does not record call audio.",
    buttonPositive: "Allow",
    buttonNegative: "Don't allow",
  })
  if (result === PermissionsAndroid.RESULTS.GRANTED) return "granted"
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return "blocked"
  return "denied"
}

function toUpload(row: DeviceCallRow): DeviceCallUpload | null {
  if (!row.id || !row.startedAt) return null
  const direction = row.direction === "inbound" || row.direction === "outbound" || row.direction === "missed" ? row.direction : "unknown"
  return {
    source_event_id: String(row.id).slice(0, 40),
    direction,
    number: String(row.number || "").slice(0, 64),
    started_at: new Date(row.startedAt).toISOString(),
    duration_seconds: Math.max(0, Math.round(Number(row.durationSeconds) || 0)),
    sim_slot: String(row.simSlot || "").slice(0, 120),
  }
}

async function flushQueue(deviceUuid: string): Promise<number> {
  const pending = await readCallQueue()
  let uploaded = 0
  for (let i = 0; i < pending.length; i += 50) {
    const chunk = pending.slice(i, i + 50)
    try {
      const result = await uploadDeviceCalls(deviceUuid, chunk)
      const done = [
        ...result.accepted,
        ...result.duplicates,
        ...result.rejected.map((row) => row.source_event_id),
      ]
      await removeQueuedCalls(done)
      uploaded += result.accepted.length
    } catch (err) {
      if (err instanceof MonitorApiError && (err.status === 403 || err.status === 501)) {
        await clearCallQueue()
      }
      break
    }
  }
  return uploaded
}

/** Upload call history only when this Android phone already has permission and a current acknowledgment. */
export async function syncPermittedCallLogs(): Promise<{ uploaded: number; skipped: string }> {
  if (syncing) return { uploaded: 0, skipped: "busy" }
  if (Platform.OS === "ios") return { uploaded: 0, skipped: "ios" }
  if (!androidCallLogSupported()) return { uploaded: 0, skipped: "build" }
  if ((await callLogPermission()) !== "granted") return { uploaded: 0, skipped: "permission" }

  syncing = true
  try {
    const policy = await fetchMonitorPolicy()
    if (!policyAllowsHandset(policy)) return { uploaded: 0, skipped: "policy" }
    const consent = await fetchMonitorConsent()
    if (consent.status !== "acknowledged" || consent.policy_version !== policy.policy_version || !consent.effective_at) {
      return { uploaded: 0, skipped: "consent" }
    }
    const since = new Date(consent.effective_at).getTime()
    if (!Number.isFinite(since) || since <= 0) return { uploaded: 0, skipped: "consent" }

    const native = loadCallLogModule()
    if (!native) return { uploaded: 0, skipped: "build" }
    const rows = await native.readCallLog(since)
    const fresh = rows.map(toUpload).filter((row): row is DeviceCallUpload => row != null)
    await enqueueCalls(fresh)
    const uploaded = await flushQueue(await getOrCreateDeviceUuid())
    return { uploaded, skipped: "" }
  } catch (err) {
    if (err instanceof MonitorApiError && (err.status === 403 || err.status === 501)) {
      await clearCallQueue()
      return { uploaded: 0, skipped: err.code || "blocked" }
    }
    return { uploaded: 0, skipped: "network" }
  } finally {
    syncing = false
  }
}
