import { apiUrl, fetchWithTimeout } from "./api"
import { deviceFingerprint } from "./device"
import type { AuthUser } from "./auth"

export type LoginResponse = {
  token: string
  user: AuthUser
  mobile_session?: {
    session_id: string
    status: string
    device_uuid: string
    device_id?: number
    gps_required?: boolean
  }
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await fetchWithTimeout(apiUrl("/api/auth/login/"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: username.trim(),
      password,
      ...(await deviceFingerprint()),
    }),
  })

  if (!res.ok) {
    let message = "Invalid username or password."
    try {
      const data = (await res.json()) as {
        detail?: string
        non_field_errors?: string[]
        username?: string[]
        password?: string[]
        device_uuid?: string | string[]
      }
      if (typeof data.detail === "string") message = data.detail
      else if (data.non_field_errors?.[0]) message = data.non_field_errors[0]
      else if (data.username?.[0]) message = data.username[0]
      else if (data.password?.[0]) message = data.password[0]
      else if (data.device_uuid) message = Array.isArray(data.device_uuid) ? data.device_uuid[0] : data.device_uuid
    } catch {
      /* keep default */
    }
    throw new Error(message)
  }

  return (await res.json()) as LoginResponse
}
