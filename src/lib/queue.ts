import { getJson, setJson, removeItem } from "./storage"

const QUEUE_KEY = "ciis_offline_queue"
const QUEUE_MAX = 500
export const MAX_UPLOAD_ATTEMPTS = 6

export type OfflineEventType =
  | "gps"
  | "heartbeat"
  | "lock"
  | "attendance"
  | "logout"
  | "mobile_event"

export type OfflineEvent = {
  event_id: string
  event_type: OfflineEventType
  device_uuid: string
  session_id: string
  /** Creator's user id — events only flush for the user signed in now (shared-phone safety). */
  user_id: number | null
  client_timestamp: string
  payload: Record<string, unknown>
  attempts: number
}

function newEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function createOfflineEvent(
  event_type: OfflineEventType,
  device_uuid: string,
  session_id: string,
  payload: Record<string, unknown>,
  user_id: number | null,
): OfflineEvent {
  return {
    event_id: (payload.event_id as string) || newEventId(),
    event_type,
    device_uuid,
    session_id,
    user_id,
    client_timestamp: new Date().toISOString(),
    payload,
    attempts: 0,
  }
}

async function readQueue(): Promise<OfflineEvent[]> {
  const list = await getJson<OfflineEvent[]>(QUEUE_KEY)
  return Array.isArray(list) ? list : []
}

async function writeQueue(items: OfflineEvent[]): Promise<void> {
  // Keep the newest QUEUE_MAX so a long offline stretch can't blow up storage.
  await setJson(QUEUE_KEY, items.slice(-QUEUE_MAX))
}

export async function enqueueOfflineEvent(event: OfflineEvent): Promise<void> {
  const items = await readQueue()
  // Dedup by event_id so a point can never be stored twice.
  const next = items.filter((e) => e.event_id !== event.event_id)
  next.push(event)
  await writeQueue(next)
}

export async function listPendingEvents(): Promise<OfflineEvent[]> {
  const items = await readQueue()
  return items.sort((a, b) => a.client_timestamp.localeCompare(b.client_timestamp))
}

export async function deleteEvent(eventId: string): Promise<void> {
  const items = await readQueue()
  await writeQueue(items.filter((e) => e.event_id !== eventId))
}

/** Record one failed attempt; returns the new count (big number if the row is gone). */
export async function bumpEventAttempts(eventId: string): Promise<number> {
  const items = await readQueue()
  const row = items.find((e) => e.event_id === eventId)
  if (!row) return Number.MAX_SAFE_INTEGER
  row.attempts = (row.attempts ?? 0) + 1
  await writeQueue(items)
  return row.attempts
}

export async function clearAllEvents(): Promise<void> {
  await removeItem(QUEUE_KEY)
}
