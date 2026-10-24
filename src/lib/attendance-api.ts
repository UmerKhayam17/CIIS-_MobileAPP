import { API_BASE_URL, getAuthHeaders, fetchWithTimeout } from "./api"

export type AttendanceRecord = {
  id: number
  username: string | null
  staff_name?: string | null
  employee_id?: string | null
  department?: string | null
  date: string
  check_in: string | null
  check_out: string | null
  status?: string
  source?: string
}

export async function fetchAttendance(params?: { date?: string }): Promise<AttendanceRecord[]> {
  const qs = new URLSearchParams()
  if (params?.date) qs.set("date", params.date)
  const url = qs.toString()
    ? `${API_BASE_URL}/api/attendance/?${qs}`
    : `${API_BASE_URL}/api/attendance/`
  const res = await fetchWithTimeout(url, { headers: await getAuthHeaders() })
  if (res.status === 401) throw new Error("Unauthorized")
  if (res.status === 403) throw new Error("You do not have permission to view attendance.")
  if (!res.ok) throw new Error(`Failed to load attendance (${res.status})`)
  const data = await res.json()
  if (Array.isArray(data)) return data
  if (data && Array.isArray((data as { results?: AttendanceRecord[] }).results)) {
    return (data as { results: AttendanceRecord[] }).results
  }
  return []
}
