import { getJson, removeItem, setJson } from "./storage"
import type { DeviceCallUpload } from "./call-api"

const QUEUE_KEY = "ciis_call_upload_queue"
const QUEUE_MAX = 300

export async function readCallQueue(): Promise<DeviceCallUpload[]> {
  const list = await getJson<DeviceCallUpload[]>(QUEUE_KEY)
  return Array.isArray(list) ? list : []
}

export async function enqueueCalls(items: DeviceCallUpload[]): Promise<void> {
  if (!items.length) return
  const byId = new Map<string, DeviceCallUpload>()
  for (const row of await readCallQueue()) byId.set(row.source_event_id, row)
  for (const row of items) byId.set(row.source_event_id, row)
  await setJson(QUEUE_KEY, [...byId.values()].slice(-QUEUE_MAX))
}

export async function removeQueuedCalls(ids: string[]): Promise<void> {
  if (!ids.length) return
  const drop = new Set(ids)
  const next = (await readCallQueue()).filter((row) => !drop.has(row.source_event_id))
  await setJson(QUEUE_KEY, next)
}

export async function clearCallQueue(): Promise<void> {
  await removeItem(QUEUE_KEY)
}
