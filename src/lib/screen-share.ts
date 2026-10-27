import {
  onFrame,
  onStatus,
  screenShareSupported,
  startScreenShare,
  stopScreenShare,
  type ScreenShareStatus,
} from "../../modules/ciis-screen-share/src"
import { getOrCreateDeviceUuid } from "./device"
import { fetchMonitorConsent, fetchMonitorPolicy, policyAllowsCategory } from "./call-api"
import { uploadScreenCapture } from "./screens-api"
import { isOptedIn } from "./monitor-prefs"

export { screenShareSupported }

type StatusListener = (s: ScreenShareStatus) => void

let frameSub: { remove: () => void } | null = null
let statusSub: { remove: () => void } | null = null
let sessionId = ""

/**
 * Start a visible, employee-initiated screen-share session. Gated on the `screen_share` opt-in,
 * the active policy, and a current acknowledgment. Android still shows its own consent dialog and
 * recording indicator — this call cannot bypass or hide either. Captured frames upload as they
 * arrive. Returns a skip reason if the session could not be started.
 */
export async function beginScreenShare(onStatusChange?: StatusListener): Promise<{ ok: boolean; skipped?: string }> {
  if (!screenShareSupported()) return { ok: false, skipped: "build" }
  if (!(await isOptedIn("screen_share"))) return { ok: false, skipped: "optout" }

  const policy = await fetchMonitorPolicy().catch(() => null)
  if (!policy || !policyAllowsCategory(policy, "screen_share")) return { ok: false, skipped: "policy" }
  const consent = await fetchMonitorConsent().catch(() => null)
  if (!consent || consent.status !== "acknowledged" || consent.policy_version !== policy.policy_version) {
    return { ok: false, skipped: "consent" }
  }

  const deviceUuid = await getOrCreateDeviceUuid()
  sessionId = `${deviceUuid}:${Date.now()}`
  let seq = 0

  frameSub = onFrame((f) => {
    const capturedAt = new Date(f.capturedAt || Date.now()).toISOString()
    void uploadScreenCapture({
      kind: "screen_share",
      sourceCaptureId: `${sessionId}:${seq++}`,
      uri: f.uri,
      contentType: "image/jpeg",
      sessionId,
      capturedAt,
    }).catch(() => {
      /* a dropped frame is fine; the next one uploads */
    })
  })
  if (onStatusChange) statusSub = onStatus(onStatusChange)

  await startScreenShare(4000)
  return { ok: true }
}

export async function endScreenShare(): Promise<void> {
  await stopScreenShare()
  frameSub?.remove()
  frameSub = null
  statusSub?.remove()
  statusSub = null
  sessionId = ""
}
