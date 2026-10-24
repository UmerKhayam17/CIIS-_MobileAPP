import { monitorGet } from "./monitor-api"

export type CallDirection = "inbound" | "outbound" | "missed" | "unknown"

export type CallRecord = {
  id: string
  direction: CallDirection
  /** Masked number, e.g. "+92 3** *** **21". The app never requests full numbers by default. */
  masked_number: string | null
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  /** Where this record came from, e.g. "company_pbx" — always shown so nothing looks device-sniffed. */
  source: string
  source_label?: string
  recording_status: "available" | "not_recorded" | "pending" | "failed" | "unavailable"
  recording_id?: string | null
}

export type CallsPage = {
  results: CallRecord[]
  count: number
  next_cursor?: string | null
}

export function fetchCalls(params?: { date?: string; username?: string; cursor?: string }): Promise<CallsPage> {
  const sp = new URLSearchParams()
  if (params?.date) sp.set("date", params.date)
  if (params?.username) sp.set("username", params.username)
  if (params?.cursor) sp.set("cursor", params.cursor)
  const qs = sp.toString()
  return monitorGet<CallsPage>(`/calls/${qs ? `?${qs}` : ""}`)
}
