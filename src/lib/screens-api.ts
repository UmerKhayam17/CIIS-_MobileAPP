import { API_BASE_URL, getStoredToken, fetchWithTimeout } from "./api"
import { MonitorApiError } from "./call-api"

const ROOT = `${API_BASE_URL}/api/v1/employee-monitor`

export type ScreenKind = "in_app_screen" | "screen_share"

export type ScreenCaptureRecord = {
  id: string
  username: string | null
  name: string | null
  kind: ScreenKind
  route: string | null
  content_type: string
  size_bytes: number | null
  captured_at: string | null
  status: string
  can_view: boolean
}

export type UploadScreenInput = {
  kind: ScreenKind
  sourceCaptureId: string
  uri: string
  contentType?: string
  route?: string
  sessionId?: string
  capturedAt?: string
}

async function parseError(res: Response): Promise<MonitorApiError> {
  let code = ""
  let message = `Upload failed (${res.status})`
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

/** Upload one capture as multipart/form-data. The bytes never touch the row — the server
 *  writes them to private storage and records only metadata. */
export async function uploadScreenCapture(input: UploadScreenInput): Promise<{ id?: string; status: string }> {
  const token = await getStoredToken()
  const form = new FormData()
  form.append("kind", input.kind)
  form.append("source_capture_id", input.sourceCaptureId)
  if (input.sessionId) form.append("session_id", input.sessionId)
  if (input.route) form.append("route", input.route)
  if (input.capturedAt) form.append("captured_at", input.capturedAt)
  const contentType = input.contentType || "image/jpeg"
  form.append("content_type", contentType)
  // React Native resolves { uri, name, type } to a file part.
  form.append("file", {
    uri: input.uri,
    name: `${input.sourceCaptureId}.${contentType.includes("png") ? "png" : contentType.includes("mp4") ? "mp4" : "jpg"}`,
    type: contentType,
  } as unknown as Blob)

  const res = await fetchWithTimeout(
    `${ROOT}/screens/upload/`,
    {
      method: "POST",
      headers: token ? { Authorization: `Token ${token}` } : {},
      body: form,
    },
    30000,
  )
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as { id?: string; status: string }
}

export async function fetchScreenCaptures(params?: {
  date?: string
  username?: string
  kind?: ScreenKind
}): Promise<{ results: ScreenCaptureRecord[]; count: number }> {
  const sp = new URLSearchParams()
  if (params?.date) sp.set("date", params.date)
  if (params?.username) sp.set("username", params.username)
  if (params?.kind) sp.set("kind", params.kind)
  const token = await getStoredToken()
  const qs = sp.toString()
  const res = await fetchWithTimeout(qs ? `${ROOT}/screens/?${qs}` : `${ROOT}/screens/`, {
    headers: token ? { Authorization: `Token ${token}` } : {},
  })
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as { results: ScreenCaptureRecord[]; count: number }
}
