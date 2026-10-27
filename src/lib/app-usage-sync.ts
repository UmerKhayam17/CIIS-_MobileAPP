import { Platform } from "react-native"
import { loadAppUsageModule, type AppUsageRow } from "../../modules/ciis-app-usage/src"
import { getOrCreateDeviceUuid } from "./device"
import {
  MonitorApiError,
  fetchMonitorConsent,
  fetchMonitorPolicy,
  policyAllowsCategory,
} from "./call-api"
import {
  type AppUsageUpload,
  uploadAppUsage,
} from "./app-usage-api"
import { clearAppUsageQueue, enqueueAppUsage, readAppUsageQueue, removeQueuedAppUsage } from "./app-usage-queue"
import { isOptedIn } from "./monitor-prefs"

export type UsageAccess = "granted" | "denied" | "unavailable"

let syncing = false

export function appUsageSupported(): boolean {
  return Platform.OS === "android" && loadAppUsageModule() != null
}

export function usageAccessState(): UsageAccess {
  const native = loadAppUsageModule()
  if (!native || Platform.OS !== "android") return "unavailable"
  return native.hasUsageAccess() ? "granted" : "denied"
}

/** Opens the system "Usage access" settings screen so the employee can grant it. */
export function openUsageAccessSettings(): void {
  loadAppUsageModule()?.openUsageAccessSettings()
}

function toUpload(row: AppUsageRow): AppUsageUpload | null {
  if (!row.packageName || !row.windowStart || !row.windowEnd) return null
  if (!(row.foregroundSeconds > 0)) return null
  return {
    source_event_id: `${row.packageName}:${Math.round(row.windowStart)}:${Math.round(row.windowEnd)}`.slice(0, 120),
    package_name: String(row.packageName).slice(0, 160),
    app_label: String(row.appLabel || row.packageName).slice(0, 200),
    foreground_seconds: Math.max(0, Math.round(Number(row.foregroundSeconds) || 0)),
    launch_count: Math.max(0, Math.round(Number(row.launchCount) || 0)),
    window_start: new Date(row.windowStart).toISOString(),
    window_end: new Date(row.windowEnd).toISOString(),
    last_used_at: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
  }
}

async function flushQueue(deviceUuid: string): Promise<number> {
  const pending = await readAppUsageQueue()
  let uploaded = 0
  for (let i = 0; i < pending.length; i += 100) {
    const chunk = pending.slice(i, i + 100)
    try {
      const result = await uploadAppUsage(deviceUuid, chunk)
      const done = [
        ...result.accepted,
        ...result.duplicates,
        ...result.rejected.map((row) => row.source_event_id),
      ]
      await removeQueuedAppUsage(done)
      uploaded += result.accepted.length
    } catch (err) {
      if (err instanceof MonitorApiError && (err.status === 403 || err.status === 501)) {
        await clearAppUsageQueue()
      }
      break
    }
  }
  return uploaded
}

/** Upload app usage only when this Android phone has Usage access, the policy includes it,
 *  the employee has opted into the category, and they have acknowledged the current policy. */
export async function syncAppUsage(): Promise<{ uploaded: number; skipped: string }> {
  if (syncing) return { uploaded: 0, skipped: "busy" }
  if (Platform.OS !== "android") return { uploaded: 0, skipped: "ios" }
  if (!appUsageSupported()) return { uploaded: 0, skipped: "build" }
  if (!(await isOptedIn("app_usage"))) return { uploaded: 0, skipped: "optout" }
  if (usageAccessState() !== "granted") return { uploaded: 0, skipped: "permission" }

  syncing = true
  try {
    const policy = await fetchMonitorPolicy()
    if (!policyAllowsCategory(policy, "app_usage")) return { uploaded: 0, skipped: "policy" }
    const consent = await fetchMonitorConsent()
    if (consent.status !== "acknowledged" || consent.policy_version !== policy.policy_version || !consent.effective_at) {
      return { uploaded: 0, skipped: "consent" }
    }
    const since = new Date(consent.effective_at).getTime()
    if (!Number.isFinite(since) || since <= 0) return { uploaded: 0, skipped: "consent" }

    const native = loadAppUsageModule()
    if (!native) return { uploaded: 0, skipped: "build" }
    const rows = await native.readUsage(since)
    const fresh = rows.map(toUpload).filter((row): row is AppUsageUpload => row != null)
    await enqueueAppUsage(fresh)
    const uploaded = await flushQueue(await getOrCreateDeviceUuid())
    return { uploaded, skipped: "" }
  } catch (err) {
    if (err instanceof MonitorApiError && (err.status === 403 || err.status === 501)) {
      await clearAppUsageQueue()
      return { uploaded: 0, skipped: err.code || "blocked" }
    }
    return { uploaded: 0, skipped: "network" }
  } finally {
    syncing = false
  }
}
