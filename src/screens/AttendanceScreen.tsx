import React, { useEffect, useMemo, useState } from "react"
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius } from "../theme"
import { fetchAttendance, type AttendanceRecord } from "../lib/attendance-api"
import { formatTime, shiftIso, todayIso } from "../lib/format"
import { canViewAllStaff } from "../lib/auth"
import { Avatar, EmptyState, ErrorBanner, Loading } from "../ui"

function statusStyle(status?: string) {
  const sx = (status || "").toLowerCase()
  if (sx.includes("absent")) return { bg: colors.badBg, fg: "#991b1b" }
  if (sx.includes("late")) return { bg: colors.warnBg, fg: "#92400e" }
  if (sx.includes("present") || sx.includes("check")) return { bg: colors.goodBg, fg: "#166534" }
  return { bg: "#f1f5f9", fg: "#334155" }
}

export default function AttendanceScreen() {
  const overview = canViewAllStaff()
  const [date, setDate] = useState(todayIso())
  const [rows, setRows] = useState<AttendanceRecord[]>([])
  const [query, setQuery] = useState("")
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.staff_name, r.username, r.employee_id, r.department, r.status].join(" ").toLowerCase().includes(q),
    )
  }, [rows, query])

  const summary = useMemo(
    () => ({
      total: filtered.length,
      present: filtered.filter((r) => r.check_in).length,
      out: filtered.filter((r) => r.check_out).length,
    }),
    [filtered],
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
            <View>
              <Text style={s.h1}>{overview ? "Staff attendance" : "My attendance"}</Text>
              <Text style={s.sub}>{overview ? "Check-in / check-out for employees you supervise" : "Your check-in and check-out"}</Text>
            </View>
            <View style={s.dateBar}>
              <Pressable style={s.dateBtn} onPress={() => setDate((d) => shiftIso(d, -1))}>
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </Pressable>
              <Text style={s.dateLabel}>{dateLabel}</Text>
              <Pressable style={s.dateBtn} onPress={() => setDate((d) => shiftIso(d, 1))}>
                <Ionicons name="chevron-forward" size={20} color={colors.text} />
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
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Tile label="Records" value={summary.total} />
                <Tile label="Checked in" value={summary.present} />
                <Tile label="Checked out" value={summary.out} />
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
          return (
            <View style={s.card}>
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
                    <TimeBox label="In" value={formatTime(item.check_in)} />
                    <TimeBox label="Out" value={formatTime(item.check_out)} />
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

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.tile}>
      <Text style={s.tileValue}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  )
}
function TimeBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.timeBox}>
      <Text style={s.timeLabel}>{label}</Text>
      <Text style={s.timeValue}>{value}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  h1: { fontSize: 20, fontWeight: "800", color: colors.text },
  sub: { color: colors.muted, marginTop: 2 },
  dateBar: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 6 },
  dateBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dateLabel: { flex: 1, textAlign: "center", fontWeight: "700", color: colors.text },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 48 },
  search: { flex: 1, color: colors.text },
  tile: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, alignItems: "center" },
  tileValue: { fontSize: 18, fontWeight: "800", color: colors.text },
  tileLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14 },
  cardName: { fontWeight: "700", color: colors.text, flexShrink: 1 },
  cardMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  statusChip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  timeBox: { flex: 1, backgroundColor: "#f8fafc", borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  timeLabel: { fontSize: 10, fontWeight: "700", color: colors.faint, textTransform: "uppercase" },
  timeValue: { fontSize: 14, fontWeight: "700", color: colors.text },
})
