import { getJson, removeItem, setJson } from "./storage"
import type { AppUsageUpload } from "./app-usage-api"

const QUEUE_KEY = "ciis_app_usage_queue"
const QUEUE_MAX = 1000

export async function readAppUsageQueue(): Promise<AppUsageUpload[]> {
  const list = await getJson<AppUsageUpload[]>(QUEUE_KEY)
  return Array.isArray(list) ? list : []
}

export async function enqueueAppUsage(items: AppUsageUpload[]): Promise<void> {
  if (!items.length) return
  // Dedup by source_event_id so a window is never queued twice.
  const byId = new Map<string, AppUsageUpload>()
  for (const row of await readAppUsageQueue()) byId.set(row.source_event_id, row)
  for (const row of items) byId.set(row.source_event_id, row)
  await setJson(QUEUE_KEY, [...byId.values()].slice(-QUEUE_MAX))
}

export async function removeQueuedAppUsage(ids: string[]): Promise<void> {
  if (!ids.length) return
  const drop = new Set(ids)
  const next = (await readAppUsageQueue()).filter((row) => !drop.has(row.source_event_id))
  await setJson(QUEUE_KEY, next)
}

export async function clearAppUsageQueue(): Promise<void> {
  await removeItem(QUEUE_KEY)
}
