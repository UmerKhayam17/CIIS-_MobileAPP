import { requireNativeModule } from "expo-modules-core"

export type RecordingFile = {
  /** Stable per-file id (the document's display name) used to de-duplicate uploads. */
  id: string
  /** content:// uri of the document inside the granted tree. */
  uri: string
  name: string
  sizeBytes: number
  /** Last-modified epoch millis — used as the recording time and consent-cutoff check. */
  modified: number
}

type CiisCallRecordingNative = {
  /** The persisted tree uri the user granted, or null if none/again-revoked. */
  getFolderUri(): string | null
  /** True when this app may read audio files the media library already indexed. */
  hasAudioAccess(): boolean
  /** Launch the Android folder picker; resolves to the granted tree uri, or null if cancelled. */
  requestFolderAccess(): Promise<string | null>
  /** Audio files in the granted folder modified at/after sinceMillis (newest first). */
  listRecordings(sinceMillis: number): Promise<RecordingFile[]>
  /** Copy one document to app cache; resolves to a file:// path for upload. */
  copyToCache(uri: string): Promise<string>
  /** Delete a cache file created by copyToCache. */
  deleteCache(path: string): Promise<boolean>
}

export function loadCallRecordingModule(): CiisCallRecordingNative | null {
  try {
    return requireNativeModule<CiisCallRecordingNative>("CiisCallRecording")
  } catch {
    return null
  }
}
