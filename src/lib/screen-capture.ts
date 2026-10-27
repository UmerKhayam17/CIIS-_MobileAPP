import { captureScreen } from "react-native-view-shot"
import { getOrCreateDeviceUuid } from "./device"
import { MonitorApiError, fetchMonitorConsent, fetchMonitorPolicy, policyAllowsCategory } from "./call-api"
import { uploadScreenCapture } from "./screens-api"
import { isOptedIn } from "./monitor-prefs"

let busy = false

/**
 * Capture a screenshot of the CIIS app's own current screen and upload it.
 *
 * `captureScreen` only sees CIIS's own UI — the OS does not let an app screenshot other apps —
 * so this never captures anything outside CIIS. Gated on the in-app-screens opt-in plus the
 * active policy and a current acknowledgment, exactly like the other handset features.
 */
export async function captureInAppScreen(route?: string): Promise<{ ok: boolean; skipped?: string }> {
  if (busy) return { ok: false, skipped: "busy" }
  if (!(await isOptedIn("in_app_screens"))) return { ok: false, skipped: "optout" }

  busy = true
  try {
    const policy = await fetchMonitorPolicy()
    if (!policyAllowsCategory(policy, "in_app_screens")) return { ok: false, skipped: "policy" }
    const consent = await fetchMonitorConsent()
    if (consent.status !== "acknowledged" || consent.policy_version !== policy.policy_version) {
      return { ok: false, skipped: "consent" }
    }

    const uri = await captureScreen({ format: "jpg", quality: 0.6, result: "tmpfile" })
    const capturedAt = new Date().toISOString()
    const deviceUuid = await getOrCreateDeviceUuid()
    await uploadScreenCapture({
      kind: "in_app_screen",
      sourceCaptureId: `${deviceUuid}:${Date.now()}`,
      uri,
      contentType: "image/jpeg",
      route,
      capturedAt,
    })
    return { ok: true }
  } catch (err) {
    if (err instanceof MonitorApiError) return { ok: false, skipped: err.code || "blocked" }
    return { ok: false, skipped: "error" }
  } finally {
    busy = false
  }
}
