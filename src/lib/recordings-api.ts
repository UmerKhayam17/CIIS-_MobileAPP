import { monitorGet } from "./monitor-api"

export type RecordingStatus = "available" | "pending" | "failed" | "not_recorded" | "unavailable"

export type RecordingRecord = {
  id: string
  call_id?: string | null
  source: string
  source_label?: string
  recorded_at: string | null
  duration_seconds: number | null
  status: RecordingStatus
  /** True when this account is permitted to play it; playback still goes through a short-lived URL. */
  can_play: boolean
}

export type RecordingsPage = {
  results: RecordingRecord[]
  count: number
  next_cursor?: string | null
}

export function fetchRecordings(params?: { date?: string; username?: string; cursor?: string }): Promise<RecordingsPage> {
  const sp = new URLSearchParams()
  if (params?.date) sp.set("date", params.date)
  if (params?.username) sp.set("username", params.username)
  if (params?.cursor) sp.set("cursor", params.cursor)
  const qs = sp.toString()
  return monitorGet<RecordingsPage>(`/recordings/${qs ? `?${qs}` : ""}`)
}

/**
 * Ask the server for a short-lived, authorized playback URL for one recording. The app never
 * holds a permanent audio URL or storage credentials; the link expires quickly and the server
 * audits every playback request.
 */
export function requestPlayback(recordingId: string): Promise<{ url: string; expires_at: string }> {
  return monitorGet<{ url: string; expires_at: string }>(`/recordings/${recordingId}/playback/`)
}
