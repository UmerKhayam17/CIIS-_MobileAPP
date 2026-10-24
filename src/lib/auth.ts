import { getItem, setItem, removeItem, getJson, setJson } from "./storage"
import { setTokenCache } from "./api"
import { clearAllEvents } from "./queue"
import { resetCallLogState } from "./call-log"

const AUTH_TOKEN_KEY = "pakistan_customs_token"
const AUTH_USER_KEY = "pakistan_customs_user"
const AUTH_SESSION_KEY = "pakistan_customs_auth"
const REMEMBERED_USERNAME_KEY = "ciis_remembered_username"
const SESSION_KEY = "ciis_mobile_session_id"
const LOG_QUEUE_KEY = "ciis_mobile_log_queue"

export type AuthUser = {
  id: number
  username: string
  email: string
  role: string
  phone: string
  location?: string
  full_name?: string
  designation?: string
  employee_id?: string
  is_active?: boolean
}

/** Cached user so screens can read role synchronously after the first load. */
let userCache: AuthUser | null = null

export async function setAuthenticatedWithToken(token: string, user: AuthUser): Promise<void> {
  setTokenCache(token)
  userCache = user
  await setItem(AUTH_TOKEN_KEY, token)
  await setJson(AUTH_USER_KEY, user)
  await setItem(AUTH_SESSION_KEY, "true")
  if (user.username) await setItem(REMEMBERED_USERNAME_KEY, user.username)
}

export async function loadStoredUser(): Promise<AuthUser | null> {
  if (userCache) return userCache
  userCache = await getJson<AuthUser>(AUTH_USER_KEY)
  return userCache
}

export function getCachedUser(): AuthUser | null {
  return userCache
}

export async function getRememberedUsername(): Promise<string> {
  return (await getItem(REMEMBERED_USERNAME_KEY)) || ""
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await getItem(AUTH_SESSION_KEY)
  const token = await getItem(AUTH_TOKEN_KEY)
  return session === "true" && Boolean(token)
}

export async function clearAuth(): Promise<void> {
  setTokenCache(null)
  userCache = null
  await removeItem(AUTH_TOKEN_KEY)
  await removeItem(AUTH_USER_KEY)
  await removeItem(AUTH_SESSION_KEY)
  await removeItem(SESSION_KEY)
  await removeItem(LOG_QUEUE_KEY)
  // Wipe the buffered events so nothing uploads under the next user on a shared phone.
  await clearAllEvents()
  // Drop the call-log cursor + disclosure so the next user starts clean and re-consents.
  await resetCallLogState()
}

export function displayName(user: AuthUser | null): string {
  if (!user) return ""
  return user.full_name?.trim() || user.username
}

/** Desk / IT / HR accounts use the app as a dashboard — do not track their GPS. */
const DESK_ROLES = new Set([
  "ADMIN",
  "IT_SUPERADMIN",
  "LOCATION_ADMIN",
  "IT_ADMIN",
  "HR",
  "AUDITOR",
  "PRAL",
  "RECEPTIONIST",
])

const STAFF_OVERVIEW_ROLES = new Set([
  "ADMIN",
  "IT_SUPERADMIN",
  "LOCATION_ADMIN",
  "HR",
  "IT_ADMIN",
  "OPERATION_MANAGER",
  "COLLECTOR",
  "DEPUTY_COLLECTOR",
  "ASSISTANT_COLLECTOR",
])

export function shouldTrackLocation(user: AuthUser | null = userCache): boolean {
  if (!user?.role) return true
  return !DESK_ROLES.has(user.role.toUpperCase())
}

export function canViewAllStaff(user: AuthUser | null = userCache): boolean {
  if (!user?.role) return false
  return STAFF_OVERVIEW_ROLES.has(user.role.toUpperCase())
}
