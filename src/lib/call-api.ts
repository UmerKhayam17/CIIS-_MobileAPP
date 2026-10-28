import { API_BASE_URL, fetchWithTimeout, getAuthHeaders, getStoredToken } from "./api"

const ROOT = `${API_BASE_URL}/api/v1/employee-monitor`

export type MonitorCategory = {
  key: string
  label: string
  description?: string
  collected?: boolean
}

export type MonitorPolicy = {
  policy_id: string
  policy_version: string
  summary: string
  work_hours: string
  contact: string
  categories: MonitorCategory[]
}

export type MonitorConsent = {
  consent_id: string | null
  status: "acknowledged" | "withdrawn" | "none"
  policy_version: string | null
  effective_at: string | null
  /** Absent on older servers, which did not report the per-category opt-ins. */
  disclosed_categories?: string[]
}

export type CallRecord = {
  id: string
  username: string | null
  name: string | null
  direction: "inbound" | "outbound" | "missed" | "unknown"
  masked_number: string | null
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  source: string
  source_label: string
  sim_slot: string | null
  recording_status: string
}

export type CallListResponse = {
  results: CallRecord[]
  count: number
  total_duration_seconds: number
}

export type DeviceCallUpload = {
  source_event_id: string
  direction: CallRecord["direction"]
  number: string
  started_at: string
  duration_seconds: number
  sim_slot: string
}

export class MonitorApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
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

export function policyAllowsCategory(policy: MonitorPolicy | null, key: string): boolean {
  return Boolean(policy?.categories?.some((c) => c.key === key && c.collected !== false))
}

export function policyAllowsHandset(policy: MonitorPolicy | null): boolean {
  return policyAllowsCategory(policy, "android_call_history")
}

export async function fetchMonitorPolicy(): Promise<MonitorPolicy> {
  const res = await authJson("/policy/current/")
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as MonitorPolicy
}

export async function fetchMonitorConsent(): Promise<MonitorConsent> {
  const res = await authJson("/consents/current/")
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as MonitorConsent
}

export async function postMonitorConsent(
  policyId: string,
  action: "acknowledge" | "withdraw",
  disclosedCategories: string[],
): Promise<MonitorConsent> {
  const res = await authJson("/consents/", {
    method: "POST",
    body: JSON.stringify({
      policy_id: policyId,
      action,
      disclosed_categories: disclosedCategories,
    }),
  })
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as MonitorConsent
}

/**
 * Opt one category in or out without touching the others. The server keeps a single
 * "latest wins" consent row, so posting only this category would silently withdraw the rest.
 */
export async function setConsentCategory(
  policy: MonitorPolicy,
  category: string,
  enabled: boolean,
): Promise<MonitorConsent> {
  const current = await fetchMonitorConsent()
  const kept =
    current.status === "acknowledged" && current.policy_version === policy.policy_version
      ? current.disclosed_categories ?? []
      : []
  const next = enabled ? Array.from(new Set([...kept, category])) : kept.filter((c) => c !== category)
  return postMonitorConsent(policy.policy_id, next.length ? "acknowledge" : "withdraw", next)
}

/** True when the current consent covers this category under this policy. */
export function consentCovers(consent: MonitorConsent | null, policy: MonitorPolicy | null, category: string): boolean {
  if (!consent || !policy) return false
  if (consent.status !== "acknowledged" || consent.policy_version !== policy.policy_version) return false
  return consent.disclosed_categories?.includes(category) ?? true
}

export async function fetchCallRecords(params?: { date?: string; username?: string }): Promise<CallListResponse> {
  const sp = new URLSearchParams()
  if (params?.date) sp.set("date", params.date)
  if (params?.username) sp.set("username", params.username)
  const qs = sp.toString()
  const res = await authJson(qs ? `/calls/?${qs}` : "/calls/")
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as CallListResponse
}

export type DeviceRecordingUpload = {
  sourceRecordingId: string
  sourceCallEventId?: string
  recordedAt: string
  durationSeconds?: number
  contentType: string
  fileUri: string
  fileName: string
}

/**
 * Upload one call recording the phone's own dialer made. Multipart, so we set the auth token
 * header ourselves and let fetch build the multipart boundary (getAuthHeaders forces JSON).
 * Returns the server status; a duplicate (already uploaded) resolves to "duplicate".
 */
export async function uploadDeviceRecording(
  deviceUuid: string,
  rec: DeviceRecordingUpload,
): Promise<{ status: string; id?: string }> {
  const token = await getStoredToken()
  const headers: Record<string, string> = { Accept: "application/json" }
  if (token) headers["Authorization"] = `Token ${token}`

  const form = new FormData()
  form.append("device_uuid", deviceUuid)
  form.append("source_recording_id", rec.sourceRecordingId)
  if (rec.sourceCallEventId) form.append("source_call_event_id", rec.sourceCallEventId)
  form.append("recorded_at", rec.recordedAt)
  if (rec.durationSeconds != null) form.append("duration_seconds", String(rec.durationSeconds))
  form.append("content_type", rec.contentType)
  // React Native's FormData file shape.
  form.append("file", { uri: rec.fileUri, name: rec.fileName, type: rec.contentType } as unknown as Blob)

  // Audio is larger than metadata; allow more time than the default.
  const res = await fetchWithTimeout(`${ROOT}/recordings/device-upload/`, { method: "POST", headers, body: form }, 60000)
  if (res.status === 200 || res.status === 201) return (await res.json()) as { status: string; id?: string }
  throw await parseError(res)
}

export async function uploadDeviceCalls(
  deviceUuid: string,
  events: DeviceCallUpload[],
): Promise<{ accepted: string[]; duplicates: string[]; rejected: { source_event_id: string }[] }> {
  const res = await authJson("/calls/device-sync/", {
    method: "POST",
    body: JSON.stringify({ device_uuid: deviceUuid, events }),
  })
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as { accepted: string[]; duplicates: string[]; rejected: { source_event_id: string }[] }
}
