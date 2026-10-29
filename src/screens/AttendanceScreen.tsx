import React, { useEffect, useMemo, useState } from "react"
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius, shadow } from "../theme"
import { fetchAttendance, type AttendanceRecord } from "../lib/attendance-api"
import { formatDuration, formatTime, shiftIso, todayIso } from "../lib/format"
import { canViewAllStaff } from "../lib/auth"
import { Avatar, EmptyState, ErrorBanner, FilterChip, KpiTile, Loading, ScreenTitle } from "../ui"

type Bucket = "all" | "present" | "late" | "absent"

function bucketOf(r: AttendanceRecord): Exclude<Bucket, "all"> | null {
  const sx = (r.status || "").toLowerCase()
  if (sx.includes("absent")) return "absent"
  if (sx.includes("late")) return "late"
  if (r.check_in || sx.includes("present") || sx.includes("check")) return "present"
  return null
}

function statusStyle(status?: string) {
  const sx = (status || "").toLowerCase()
  if (sx.includes("absent")) return { bg: colors.badBg, fg: "#991b1b", bar: colors.bad }
  if (sx.includes("late")) return { bg: colors.warnBg, fg: "#92400e", bar: colors.gold }
  if (sx.includes("present") || sx.includes("check")) return { bg: colors.goodBg, fg: "#166534", bar: colors.good }
  return { bg: "#f1f5f9", fg: "#334155", bar: colors.faint }
}

function workedSeconds(r: AttendanceRecord): number | null {
  if (!r.check_in) return null
  const start = new Date(r.check_in).getTime()
  const end = r.check_out ? new Date(r.check_out).getTime() : r.date === todayIso() ? Date.now() : NaN
  return end > start ? (end - start) / 1000 : null
}

export default function AttendanceScreen() {
  const overview = canViewAllStaff()
  const [date, setDate] = useState(todayIso())
  const [rows, setRows] = useState<AttendanceRecord[]>([])
  const [query, setQuery] = useState("")
  const [bucket, setBucket] = useState<Bucket>("all")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchAttendance({ date })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setError("")
      })
      .catch((err) => {
        if (cancelled) return
        setRows([])
        setError(err instanceof Error ? err.message : "Could not load attendance")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [date, reload])

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.staff_name, r.username, r.employee_id, r.department, r.status].join(" ").toLowerCase().includes(q),
    )
  }, [rows, query])

  const filtered = useMemo(() => (bucket === "all" ? searched : searched.filter((r) => bucketOf(r) === bucket)), [searched, bucket])

  const summary = useMemo(
    () => ({
      total: searched.length,
      present: searched.filter((r) => r.check_in).length,
      out: searched.filter((r) => r.check_out).length,
      onTime: searched.filter((r) => bucketOf(r) === "present").length,
      late: searched.filter((r) => bucketOf(r) === "late").length,
      absent: searched.filter((r) => bucketOf(r) === "absent").length,
    }),
    [searched],
  )

  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={loading || error ? [] : filtered}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 2 }}>
            <ScreenTitle
              title={overview ? "Staff attendance" : "My attendance"}
              subtitle={overview ? "Check-in / check-out for employees you supervise" : "Your check-in and check-out"}
            />
            <View style={s.dateBar}>
              <Pressable style={s.dateBtn} onPress={() => setDate((d) => shiftIso(d, -1))}>
                <Ionicons name="chevron-back" size={20} color={colors.gold} />
              </Pressable>
              <View style={s.dateCenter}>
                <Ionicons name="calendar-outline" size={16} color={colors.goldLight} />
                <Text style={s.dateLabel}>{dateLabel}</Text>
              </View>
              <Pressable style={s.dateBtn} onPress={() => setDate((d) => shiftIso(d, 1))}>
                <Ionicons name="chevron-forward" size={20} color={colors.gold} />
              </Pressable>
            </View>
            {overview ? (
              <View style={s.searchWrap}>
                <Ionicons name="search" size={16} color={colors.faint} />
                <TextInput
                  style={s.search}
                  placeholder="Search name, ID, department"
                  placeholderTextColor={colors.faint}
                  value={query}
                  onChangeText={setQuery}
                />
              </View>
            ) : null}
            {!error && !loading ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <KpiTile icon="people" label="Records" value={summary.total} tone={colors.primary} />
                <KpiTile icon="log-in" label="Checked in" value={summary.present} tone={colors.good} />
                <KpiTile icon="log-out" label="Checked out" value={summary.out} tone="#2563eb" />
              </View>
            ) : null}
            {overview && !error && !loading ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <FilterChip label={`All ${summary.total}`} active={bucket === "all"} onPress={() => setBucket("all")} />
                <FilterChip label={`Present ${summary.onTime}`} active={bucket === "present"} onPress={() => setBucket("present")} />
                <FilterChip label={`Late ${summary.late}`} active={bucket === "late"} onPress={() => setBucket("late")} />
                <FilterChip label={`Absent ${summary.absent}`} active={bucket === "absent"} onPress={() => setBucket("absent")} />
              </View>
            ) : null}
            {error ? <ErrorBanner message={error} /> : null}
            {loading ? <Loading /> : null}
          </View>
        }
        ListEmptyComponent={
          !loading && !error ? (
            <EmptyState icon="document-text-outline" title="No attendance" description={overview ? "No check-ins for this date." : "You have no check-in recorded for this date."} />
          ) : null
        }
        renderItem={({ item }) => {
          const st = statusStyle(item.status)
          const worked = workedSeconds(item)
          return (
            <View style={s.card}>
              <View style={[s.cardBar, { backgroundColor: st.bar }]} />
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Avatar name={item.staff_name || item.username} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={s.cardName}>{item.staff_name || item.username || "Unknown"}</Text>
                    {item.status ? (
                      <View style={[s.statusChip, { backgroundColor: st.bg }]}>
                        <Text style={{ color: st.fg, fontSize: 11, fontWeight: "700" }}>{item.status}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={s.cardMeta}>{[item.employee_id, item.department, item.source].filter(Boolean).join(" · ")}</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    <TimeBox label="In" icon="log-in-outline" value={formatTime(item.check_in)} />
                    <TimeBox label="Out" icon="log-out-outline" value={formatTime(item.check_out)} />
                    <TimeBox label={item.check_out ? "Worked" : "So far"} icon="hourglass-outline" value={worked != null ? formatDuration(worked) : "—"} />
                  </View>
                </View>
              </View>
            </View>
          )
        }}
      />
    </View>
  )
}

function TimeBox({ label, icon, value }: { label: string; icon: keyof typeof Ionicons.glyphMap; value: string }) {
  return (
    <View style={s.timeBox}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Ionicons name={icon} size={12} color={colors.gold} />
        <Text style={s.timeLabel}>{label}</Text>
      </View>
      <Text style={s.timeValue}>{value}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  dateBar: { flexDirection: "row", alignItems: "center", backgroundColor: colors.navy, borderRadius: radius.md, padding: 6, ...shadow },
  dateBtn: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.07)", alignItems: "center", justifyContent: "center" },
  dateCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  dateLabel: { fontWeight: "700", color: "#fff" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 48 },
  search: { flex: 1, color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, paddingLeft: 18, overflow: "hidden", ...shadow },
  cardBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  cardName: { fontWeight: "700", color: colors.text, flexShrink: 1 },
  cardMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  statusChip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  timeBox: { flex: 1, backgroundColor: colors.chipBg, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  timeLabel: { fontSize: 10, fontWeight: "700", color: colors.faint, textTransform: "uppercase" },
  timeValue: { fontSize: 14, fontWeight: "700", color: colors.text },
})
