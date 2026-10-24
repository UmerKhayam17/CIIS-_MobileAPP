/**
 * Backend origin the app talks to. Native apps call the API directly — there is no
 * dev proxy and no mixed-content rule like the PWA had, so this must be the real
 * Django origin, reachable from the phones (a public host/IP with a valid TLS cert,
 * or plain http on the LAN for testing).
 *
 * Override per build with EXPO_PUBLIC_API_BASE_URL (expo reads EXPO_PUBLIC_* at build time).
 */
const CONFIGURED_API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || "https://175.107.58.110:2900"
).replace(/\/+$/, "")

/**
 * On web the app may be opened via http://localhost:<port> OR via the LAN IP
 * (http://192.168.x.x:<port>) from another device on the same Wi-Fi. A backend
 * pinned to "localhost" only works in the first case, because in a phone's
 * browser "localhost" is the phone itself. So when the configured backend host
 * is a loopback dev host, rewrite it to the host the page was actually loaded
 * from — keeping the backend's own scheme and port. This makes login work from
 * both localhost and the IP with no rebuild. A real (non-loopback) configured
 * host, e.g. a production API, is always used as-is.
 */
function resolveApiBaseUrl(): string {
  if (typeof window !== "undefined" && window.location && window.location.hostname) {
    try {
      const u = new URL(CONFIGURED_API_BASE_URL)
      const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1"
      if (loopback) {
        u.hostname = window.location.hostname
        return u.toString().replace(/\/+$/, "")
      }
    } catch {
      // Malformed URL — fall through to the configured value.
    }
  }
  return CONFIGURED_API_BASE_URL
}

export const API_BASE_URL = resolveApiBaseUrl()

export const APP_VERSION = "0.1.0"

/**
 * CARTO basemaps API key (from dashboard.basemaps.carto.com) used for the map tiles.
 * Set via EXPO_PUBLIC_MAP_KEY. Like all EXPO_PUBLIC_* values it is embedded in the client
 * bundle, which is expected for a tile key — restrict it by domain/usage in the CARTO dashboard.
 */
export const MAP_KEY = process.env.EXPO_PUBLIC_MAP_KEY || ""
