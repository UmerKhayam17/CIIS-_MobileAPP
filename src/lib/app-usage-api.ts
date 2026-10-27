import { API_BASE_URL, fetchWithTimeout, getAuthHeaders } from "./api"
import { MonitorApiError } from "./call-api"

const ROOT = `${API_BASE_URL}/api/v1/employee-monitor`

export type AppUsageUpload = {
  source_event_id: string
  package_name: string
  app_label: string
  foreground_seconds: number
  launch_count: number
  window_start: string
  window_end: string
  last_used_at?: string | null
}

export type AppUsageRecord = {
  id: string
  username: string | null
  name: string | null
  package_name: string
  app_label: string
  foreground_seconds: number
  launch_count: number
  window_start: string | null
  window_end: string | null
  last_used_at: string | null
}

export type AppUsageListResponse = {
  results: AppUsageRecord[]
  count: number
  total_foreground_seconds: number
}

async function parseError(res: Response): Promise<MonitorApiError> {
  let code = ""
  let message = `Request failed (${res.status})`
  try {
    const data = (await res.json()) as { detail?: string; error?: { code?: string; message?: string } }
    if (data.error?.message) {
      code = data.error.code || ""
      message = data.error.message
    } else if (typeof data.detail === "string") {
      message = data.detail
    }
  } catch {
    /* keep default */
  }
  if (res.status === 501 && !code) code = "feature_disabled"
  return new MonitorApiError(res.status, code, message)
}

async function authJson(path: string, init?: RequestInit): Promise<Response> {
  const headers = await getAuthHeaders()
  return fetchWithTimeout(`${ROOT}${path}`, { ...init, headers: { ...headers, ...(init?.headers || {}) } })
}

export async function uploadAppUsage(
  deviceUuid: string,
  events: AppUsageUpload[],
): Promise<{ accepted: string[]; duplicates: string[]; rejected: { source_event_id: string }[] }> {
  const res = await authJson("/app-usage/device-sync/", {
    method: "POST",
    body: JSON.stringify({ device_uuid: deviceUuid, events }),
  })
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as {
    accepted: string[]
    duplicates: string[]
    rejected: { source_event_id: string }[]
  }
}

export async function fetchAppUsage(params?: { date?: string; username?: string }): Promise<AppUsageListResponse> {
  const sp = new URLSearchParams()
  if (params?.date) sp.set("date", params.date)
  if (params?.username) sp.set("username", params.username)
  const qs = sp.toString()
  const res = await authJson(qs ? `/app-usage/?${qs}` : "/app-usage/")
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as AppUsageListResponse
}
