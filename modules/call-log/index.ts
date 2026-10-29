import { Platform } from "react-native"
import { requireOptionalNativeModule } from "expo-modules-core"

export type NativeCall = {
  /** Android CallLog row id — stable per device, used to dedupe. */
  id: string | null
  number: string
  /** Raw CallLog.Calls.TYPE int. */
  type: number
  direction: "inbound" | "outbound" | "missed" | "unknown"
  /** Epoch milliseconds. */
  timestamp: number
  /** Call length in seconds. */
  duration: number
}

type CallLogNativeModule = {
  hasPermission(): boolean
  getCallLog(sinceMillis: number, maxRows: number): Promise<NativeCall[]>
}

/**
 * Null in Expo Go, on the web, and on iOS — i.e. anywhere the native module isn't present.
 * Callers must treat "not supported" as "collect nothing", never as an error.
 */
const CallLog =
  Platform.OS === "android" ? requireOptionalNativeModule<CallLogNativeModule>("CallLog") : null

export function isCallLogSupported(): boolean {
  return CallLog != null
}

export function hasCallLogPermission(): boolean {
  try {
    return CallLog?.hasPermission() ?? false
  } catch {
    return false
  }
}

export async function getCallLog(sinceMillis: number, maxRows = 500): Promise<NativeCall[]> {
  if (!CallLog) return []
  return CallLog.getCallLog(sinceMillis, maxRows)
}
