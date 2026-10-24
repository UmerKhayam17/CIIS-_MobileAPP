import { monitorGet, monitorPost } from "./monitor-api"

export type PolicyCategory = {
  key: string
  label: string
  description: string
  /** How long this category is kept, in days, when known. */
  retention_days?: number | null
}

export type MonitoringPolicy = {
  policy_id: string
  policy_version: string
  effective_at: string
  /** Free-text purpose / who can view, shown on the consent screen. */
  summary?: string
  work_hours?: string
  contact?: string
  categories: PolicyCategory[]
}

export type ConsentState = {
  consent_id: string | null
  status: "acknowledged" | "withdrawn" | "none"
  policy_version: string | null
  effective_at: string | null
}

export function fetchCurrentPolicy(): Promise<MonitoringPolicy> {
  return monitorGet<MonitoringPolicy>("/policy/current/")
}

export function fetchCurrentConsent(): Promise<ConsentState> {
  return monitorGet<ConsentState>("/consents/current/")
}

export function submitConsent(input: {
  policy_id: string
  action: "acknowledge" | "withdraw"
  disclosed_categories: string[]
}): Promise<ConsentState> {
  return monitorPost<ConsentState>("/consents/", input)
}

export type DataCategoryInfo = {
  key: string
  label: string
  purpose: string
  collected: boolean
  retention_days?: number | null
  measurement?: "measured" | "estimated" | "unavailable"
}

export function fetchDataCategories(): Promise<{ categories: DataCategoryInfo[] }> {
  return monitorGet<{ categories: DataCategoryInfo[] }>("/privacy/data-categories/")
}
