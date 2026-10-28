import { Platform } from "react-native"
import { getItem, setItem } from "./storage"
import {
  fetchMonitorPolicy,
  policyAllowsCategory,
  policyAllowsHandset,
  postMonitorConsent,
  type MonitorPolicy,
} from "./call-api"
import { setOptIn, type MonitorCategoryKey } from "./monitor-prefs"
import {
  androidCallLogSupported,
  callLogPermission,
  requestCallLogPermission,
  syncPermittedCallLogs,
} from "./call-sync"
import {
  appUsageSupported,
  openUsageAccessSettings,
  syncAppUsage,
  usageAccessState,
} from "./app-usage-sync"

/**
 * One-time guided consent, run right after the employee accepts the terms. It records their
 * acknowledgment for every category the policy collects on this phone, then walks them through
 * the two grants Android will not let an app set on its own:
 *   - call history: a runtime permission dialog we can trigger (they tap Allow),
 *   - app usage: a "special access" toggle we can only deep-link to (they flip it in Settings).
 * Nothing is captured until those are granted; this just removes the hunting-through-menus step.
 */

const DONE_PREFIX = "ciis_onboarded_v1:"

/** True once this user has completed (or skipped) the guided consent on this device. */
export async function onboardingComplete(userId: number | null | undefined): Promise<boolean> {
  if (!userId) return true // no user yet -> nothing to gate
  return (await getItem(DONE_PREFIX + userId)) === "1"
}

export async function markOnboardingComplete(userId: number | null | undefined): Promise<void> {
  if (!userId) return
  await setItem(DONE_PREFIX + userId, "1")
}

/** The BYOD categories this phone could opt into, given what the policy currently collects. */
export function optInCategoriesFor(policy: MonitorPolicy | null): MonitorCategoryKey[] {
  const keys: MonitorCategoryKey[] = ["app_usage", "in_app_screens", "screen_share"]
  return keys.filter((k) => policyAllowsCategory(policy, k))
}

export type GuidedConsentResult = {
  callLog: "granted" | "denied" | "blocked" | "unavailable" | "skipped"
  appUsage: "granted" | "needs-settings" | "unavailable" | "skipped"
}

/**
 * Acknowledge the policy and request the two grants. `policy` may be passed in (the screen
 * already loaded it) to avoid a second fetch. Safe to re-run.
 */
export async function runGuidedConsent(policy?: MonitorPolicy | null): Promise<GuidedConsentResult> {
  const p = policy ?? (await fetchMonitorPolicy())

  // Disclose every category the policy collects: the Android BYOD features plus call history.
  const disclosed = optInCategoriesFor(p)
  const wantsCalls = policyAllowsHandset(p) && Platform.OS === "android"
  const categories = [...disclosed, ...(wantsCalls ? ["android_call_history"] : [])]

  if (categories.length) {
    await postMonitorConsent(p.policy_id, "acknowledge", categories)
    for (const key of disclosed) await setOptIn(key, true)
  }

  const result: GuidedConsentResult = { callLog: "skipped", appUsage: "skipped" }

  // 1) Call history — triggers the OS permission dialog.
  if (wantsCalls) {
    if (!androidCallLogSupported()) {
      result.callLog = "unavailable"
    } else if ((await callLogPermission()) === "granted") {
      result.callLog = "granted"
    } else {
      result.callLog = await requestCallLogPermission()
    }
  }

  // 2) App usage — deep-link to the Usage-access screen when it is not already granted.
  if (disclosed.includes("app_usage")) {
    if (!appUsageSupported()) {
      result.appUsage = "unavailable"
    } else if (usageAccessState() === "granted") {
      result.appUsage = "granted"
    } else {
      openUsageAccessSettings()
      result.appUsage = "needs-settings"
    }
  }

  // Kick off a first sync for whatever is already granted.
  void syncPermittedCallLogs()
  void syncAppUsage()

  return result
}
