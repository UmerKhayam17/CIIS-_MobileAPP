import { API_BASE_URL } from "../config"
import { getItem } from "./storage"

export { API_BASE_URL }

const AUTH_TOKEN_KEY = "pakistan_customs_token"

/** In-memory copy so hot paths (GPS ping) don't await storage every time. */
let tokenCache: string | null = null

export function setTokenCache(token: string | null) {
  tokenCache = token
}

export async function getStoredToken(): Promise<string | null> {
  if (tokenCache !== null) return tokenCache
  const token = await getItem(AUTH_TOKEN_KEY)
  tokenCache = token
  return token
}

/** Synchronous best-effort token for fire-and-forget calls; may be null before the first load. */
export function getCachedToken(): string | null {
  return tokenCache
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getStoredToken()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Token ${token}`
  return headers
}

export function apiUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`
  return `${API_BASE_URL}${suffix}`
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true
  const message = err instanceof Error ? err.message : String(err)
  return /network request failed|failed to fetch|networkerror|load failed|timeout|aborted/i.test(message)
}

/** fetch with a hard timeout — mobile networks hang, and the queue loops must not stall. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20000,
): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

export const AUTH_TOKEN_KEY_NAME = AUTH_TOKEN_KEY
