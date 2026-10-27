import { type EventSubscription, requireNativeModule } from "expo-modules-core"

export type ScreenShareFrame = {
  /** Local file path (file://) of a captured JPEG frame, ready to upload. */
  uri: string
  capturedAt: number
}

export type ScreenShareStatus = {
  state: "requesting" | "active" | "stopped" | "denied" | "error"
  message?: string
}

type CiisScreenShareNative = {
  /** Android with MediaProjection support. iOS returns false (no cross-app capture). */
  isSupported(): boolean
  /**
   * Starts a screen-share session. Android shows its own consent dialog and a persistent
   * recording indicator for the whole session — this cannot be started silently or hidden.
   * Emits `onFrame` every `intervalMs` and `onStatus` on state changes.
   */
  start(intervalMs: number): Promise<void>
  stop(): Promise<void>
  addListener(event: "onFrame", listener: (f: ScreenShareFrame) => void): EventSubscription
  addListener(event: "onStatus", listener: (s: ScreenShareStatus) => void): EventSubscription
}

const native = (() => {
  try {
    return requireNativeModule<CiisScreenShareNative>("CiisScreenShare")
  } catch {
    return null
  }
})()

export function screenShareSupported(): boolean {
  try {
    return native?.isSupported() ?? false
  } catch {
    return false
  }
}

export function startScreenShare(intervalMs = 4000): Promise<void> {
  if (!native) return Promise.reject(new Error("Screen share needs a development build on Android."))
  return native.start(intervalMs)
}

export function stopScreenShare(): Promise<void> {
  if (!native) return Promise.resolve()
  return native.stop()
}

export function onFrame(listener: (f: ScreenShareFrame) => void): EventSubscription | null {
  return native ? native.addListener("onFrame", listener) : null
}

export function onStatus(listener: (s: ScreenShareStatus) => void): EventSubscription | null {
  return native ? native.addListener("onStatus", listener) : null
}
