import { requireNativeModule } from "expo-modules-core"

export type DeviceCallRow = {
  id: string
  number: string
  direction: "inbound" | "outbound" | "missed" | "unknown"
  startedAt: number
  durationSeconds: number
  simSlot: string
}

type CiisCallLogNative = {
  readCallLog(sinceMillis: number): Promise<DeviceCallRow[]>
}

export function loadCallLogModule(): CiisCallLogNative | null {
  try {
    return requireNativeModule<CiisCallLogNative>("CiisCallLog")
  } catch {
    return null
  }
}
