import { requireNativeModule } from "expo-modules-core"

export type AppUsageRow = {
  packageName: string
  appLabel: string
  foregroundSeconds: number
  launchCount: number
  windowStart: number
  windowEnd: number
  lastUsedAt: number
}

type CiisAppUsageNative = {
  /** True once the user has granted "Usage access" to CIIS in system settings. */
  hasUsageAccess(): boolean
  /** Opens the system Usage-access settings screen so the user can grant it. */
  openUsageAccessSettings(): void
  /** Foreground usage aggregated per app from `sinceMillis` until now. Throws if access is missing. */
  readUsage(sinceMillis: number): Promise<AppUsageRow[]>
}

export function loadAppUsageModule(): CiisAppUsageNative | null {
  try {
    return requireNativeModule<CiisAppUsageNative>("CiisAppUsage")
  } catch {
    return null
  }
}
