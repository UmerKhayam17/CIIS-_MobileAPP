import { API_BASE_URL, getAuthHeaders, fetchWithTimeout } from "./api"

export type ActivityLogRecord = {
  id: number
  username: string | null
  ip_address: string | null
  country: string | null
  city: string | null
  device: string | null
  os: string | null
  browser: string | null
  action: string
  source?: string
  time: string
}

export type ActivityLogsResponse = {
  count: number
  next: string | null
  previous: string | null
  results: ActivityLogRecord[]
}

export async function fetchActivityLogs(params?: {
  page?: number
  page_size?: number
  username?: string
  source?: string
  date?: string
}): Promise<ActivityLogsResponse> {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set("page", String(params.page))
  if (params?.page_size != null) sp.set("page_size", String(params.page_size))
  if (params?.username) sp.set("username", params.username)
  if (params?.source) sp.set("source", params.source)
  if (params?.date) sp.set("date", params.date)
  const qs = sp.toString()
  const base = `${API_BASE_URL}/api/activity-logs/`
  const res = await fetchWithTimeout(qs ? `${base}?${qs}` : base, { headers: await getAuthHeaders() })
  if (!res.ok) throw new Error("Failed to fetch activity logs")
  return res.json() as Promise<ActivityLogsResponse>
}

export type MobilePhoneSession = {
  id: number
  user_id: number
  username: string
  name: string
  state: "using" | "locked"
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  live_seconds: number
}

export type MobileSessionsResponse = {
  results: MobilePhoneSession[]
  count: number
  totals: { using_seconds: number; locked_seconds: number }
}

export async function fetchMobileSessions(params?: {
  date?: string
  username?: string
}): Promise<MobileSessionsResponse> {
  const sp = new URLSearchParams()
  if (params?.date) sp.set("date", params.date)
  if (params?.username) sp.set("username", params.username)
  const qs = sp.toString()
  const url = qs ? `${API_BASE_URL}/api/mobile-sessions/?${qs}` : `${API_BASE_URL}/api/mobile-sessions/`
  const res = await fetchWithTimeout(url, { headers: await getAuthHeaders() })
  if (!res.ok) throw new Error("Failed to load phone use / away times")
  return res.json() as Promise<MobileSessionsResponse>
}
