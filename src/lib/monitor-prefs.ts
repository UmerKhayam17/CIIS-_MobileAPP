import { getJson, setJson } from "./storage"

/**
 * Per-category opt-in, stored on this device. This mirrors the categories the employee
 * disclosed when they acknowledged the policy (BYOD: each category is opted into separately,
 * and can be withdrawn on its own). The server is authoritative — it re-checks the consent
 * row on every upload — but the client uses these flags to avoid collecting before opt-in.
 */
export type MonitorCategoryKey = "app_usage" | "in_app_screens" | "screen_share"

const KEY = "ciis_monitor_optin"

export async function readOptIns(): Promise<Record<string, boolean>> {
  return (await getJson<Record<string, boolean>>(KEY)) || {}
}

export async function isOptedIn(category: MonitorCategoryKey): Promise<boolean> {
  return Boolean((await readOptIns())[category])
}

export async function setOptIn(category: MonitorCategoryKey, value: boolean): Promise<void> {
  const current = await readOptIns()
  current[category] = value
  await setJson(KEY, current)
}

/** The categories currently opted in, as a list for the consent `disclosed_categories` payload. */
export async function optedInCategories(): Promise<string[]> {
  const current = await readOptIns()
  return Object.keys(current).filter((k) => current[k])
}
