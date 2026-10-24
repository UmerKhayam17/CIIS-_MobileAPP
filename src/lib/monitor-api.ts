import { API_BASE_URL, getAuthHeaders, fetchWithTimeout, isNetworkError } from "./api"

/**
 * Employee-monitoring API (consent, calls, recordings, privacy).
 *
 * These endpoints live in the backend's `employee_monitoring` Django module. Until that module
 * is deployed, or when a deployment has the feature switched off, the calls below resolve to a
 * `FeatureUnavailable` marker instead of throwing, so each screen can show an honest
 * "not available" state rather than a crash or a fake empty list.
 */
export const MONITOR_BASE = `${API_BASE_URL}/api/v1/employee-monitor`

export class FeatureUnavailable extends Error {
  constructor(public reason: "disabled" | "offline" | "forbidden" = "disabled") {
    super("This feature is not available on this deployment.")
    this.name = "FeatureUnavailable"
  }
}

export function isUnavailable(err: unknown): err is FeatureUnavailable {
  return err instanceof FeatureUnavailable
}

type Json = Record<string, unknown>

/** GET helper that maps "backend not there yet / off / not allowed" onto FeatureUnavailable. */
export async function monitorGet<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${MONITOR_BASE}${path}`, { headers: await getAuthHeaders() })
  } catch (err) {
    if (isNetworkError(err)) throw new FeatureUnavailable("offline")
    throw err
  }
  // 404 => module/endpoint not deployed; 501 => disabled; 403 => not permitted for this role.
  if (res.status === 404 || res.status === 501) throw new FeatureUnavailable("disabled")
  if (res.status === 403) throw new FeatureUnavailable("forbidden")
  if (!res.ok) throw new Error(await readError(res, "Request failed"))
  return (await res.json()) as T
}

export async function monitorPost<T>(path: string, body: Json): Promise<T> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${MONITOR_BASE}${path}`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify(body),
    })
  } catch (err) {
    if (isNetworkError(err)) throw new FeatureUnavailable("offline")
    throw err
  }
  if (res.status === 404 || res.status === 501) throw new FeatureUnavailable("disabled")
  if (res.status === 403) throw new FeatureUnavailable("forbidden")
  if (!res.ok) throw new Error(await readError(res, "Request failed"))
  return (await res.json()) as T
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string }; detail?: string }
    return data.error?.message || data.detail || fallback
  } catch {
    return fallback
  }
}
