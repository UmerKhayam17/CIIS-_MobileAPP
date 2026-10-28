import { Platform } from "react-native"
import { loadCallRecordingModule, type RecordingFile } from "../../modules/ciis-call-recording/src"
import { isNetworkError } from "./api"
import { getItem, setItem } from "./storage"
import { getOrCreateDeviceUuid } from "./device"
import {
  MonitorApiError,
  consentCovers,
  fetchMonitorConsent,
  fetchMonitorPolicy,
  policyAllowsCategory,
  uploadDeviceRecording,
} from "./call-api"

export const CALL_RECORDING_CATEGORY = "android_call_recording"
const SYNCED_KEY = "ciis_synced_recordings_v1"
const MAX_TRACKED = 500

let syncing = false

export function callRecordingSupported(): boolean {
  return Platform.OS === "android" && loadCallRecordingModule() != null
}

/** The call-recordings folder the user granted, or null if none chosen yet. */
export function recordingFolderUri(): string | null {
  return loadCallRecordingModule()?.getFolderUri() ?? null
}

/** Launch the system folder picker so the user grants read access to their call-recordings folder. */
export async function requestRecordingFolder(): Promise<string | null> {
  const native = loadCallRecordingModule()
  if (!native) return null
  return native.requestFolderAccess()
}

async function readSynced(): Promise<Set<string>> {
  try {
    const raw = await getItem(SYNCED_KEY)
    const arr = raw ? (JSON.parse(raw) as string[]) : []
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

async function writeSynced(ids: Set<string>): Promise<void> {
  // Keep only the most recent ids so the marker can't grow without bound.
  const trimmed = Array.from(ids).slice(-MAX_TRACKED)
  try {
    await setItem(SYNCED_KEY, JSON.stringify(trimmed))
  } catch {
    /* best effort */
  }
}

function mimeFor(file: RecordingFile): string {
  const name = file.name.toLowerCase()
  if (name.endsWith(".mp3")) return "audio/mpeg"
  if (name.endsWith(".m4a") || name.endsWith(".mp4") || name.endsWith(".aac")) return "audio/mp4"
  if (name.endsWith(".amr")) return "audio/amr"
  if (name.endsWith(".wav")) return "audio/wav"
  if (name.endsWith(".ogg") || name.endsWith(".opus")) return "audio/ogg"
  if (name.endsWith(".3gp")) return "audio/3gpp"
  return "application/octet-stream"
}

/**
 * Upload the recordings the phone's own dialer made, for calls at/after consent. Only runs when
 * this Android build supports it, a folder has been granted, the policy collects the category and
 * the user's current consent discloses it. The app never records a call itself.
 */
export async function syncCallRecordings(): Promise<{ uploaded: number; skipped: string }> {
  if (syncing) return { uploaded: 0, skipped: "busy" }
  if (Platform.OS === "ios") return { uploaded: 0, skipped: "ios" }
  const native = loadCallRecordingModule()
  if (!native) return { uploaded: 0, skipped: "build" }
  if (!native.getFolderUri()) return { uploaded: 0, skipped: "folder" }

  syncing = true
  try {
    const policy = await fetchMonitorPolicy()
    if (!policyAllowsCategory(policy, CALL_RECORDING_CATEGORY)) return { uploaded: 0, skipped: "policy" }
    const consent = await fetchMonitorConsent()
    if (!consentCovers(consent, policy, CALL_RECORDING_CATEGORY) || !consent.effective_at) {
      return { uploaded: 0, skipped: "consent" }
    }
    const since = new Date(consent.effective_at).getTime()
    if (!Number.isFinite(since) || since <= 0) return { uploaded: 0, skipped: "consent" }

    const files = await native.listRecordings(since)
    if (!files.length) return { uploaded: 0, skipped: "" }

    const synced = await readSynced()
    const deviceUuid = await getOrCreateDeviceUuid()
    let uploaded = 0

    for (const file of files) {
      if (synced.has(file.id)) continue
      if (!file.sizeBytes) continue
      let cachePath: string | null = null
      try {
        cachePath = await native.copyToCache(file.uri)
        const result = await uploadDeviceRecording(deviceUuid, {
          sourceRecordingId: String(file.id).slice(0, 120),
          recordedAt: new Date(file.modified).toISOString(),
          contentType: mimeFor(file),
          fileUri: cachePath,
          fileName: file.name || `${file.id}`,
        })
        synced.add(file.id)
        if (result.status !== "duplicate") uploaded += 1
      } catch (err) {
        // A recording from before consent is permanently rejected — mark it so we stop retrying.
        if (err instanceof MonitorApiError && err.code === "BEFORE_CONSENT") {
          synced.add(file.id)
          continue
        }
        if (err instanceof MonitorApiError && (err.status === 403 || err.status === 501)) {
          return { uploaded, skipped: err.code || "blocked" }
        }
        if (isNetworkError(err)) return { uploaded, skipped: "network" }
        return { uploaded, skipped: `error: ${err instanceof Error ? err.message : String(err)}` }
      } finally {
        if (cachePath) await native.deleteCache(cachePath).catch(() => undefined)
      }
    }

    await writeSynced(synced)
    return { uploaded, skipped: "" }
  } catch (err) {
    if (err instanceof MonitorApiError && (err.status === 403 || err.status === 501)) {
      return { uploaded: 0, skipped: err.code || "blocked" }
    }
    if (isNetworkError(err)) return { uploaded: 0, skipped: "network" }
    return { uploaded: 0, skipped: `error: ${err instanceof Error ? err.message : String(err)}` }
  } finally {
    syncing = false
  }
}
