/**
 * Backend origin the app talks to. Native apps call the API directly — there is no
 * dev proxy and no mixed-content rule like the PWA had, so this must be the real
 * Django origin, reachable from the phones (a public host/IP with a valid TLS cert,
 * or plain http on the LAN for testing).
 *
 * Override per build with EXPO_PUBLIC_API_BASE_URL (expo reads EXPO_PUBLIC_* at build time).
 */
export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || "https://175.107.58.110:2900"
).replace(/\/+$/, "")

export const APP_VERSION = "0.1.0"
