import React, { useEffect, useMemo, useState } from "react"
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius, shadow } from "../theme"
import {
  fetchActivityLogs,
  fetchMobileSessions,
  type ActivityLogRecord,
  type MobilePhoneSession,
} from "../lib/logs-api"
import { formatDuration, formatTime, shiftIso, todayIso } from "../lib/format"
import { EmptyState, ErrorBanner, Loading, ScreenTitle } from "../ui"

const PAGE_SIZE = 40

function eventIcon(action: string): keyof typeof Ionicons.glyphMap {
  const a = (action || "").toLowerCase()
  if (a.includes("logout") || a.includes("sign out")) return "log-out-outline"
  if (a.includes("login") || a.includes("sign in")) return "log-in-outline"
  if (a.includes("lock")) return "lock-closed-outline"
  if (a.includes("gps") || a.includes("location")) return "location-outline"
  if (a.includes("duty")) return "shield-checkmark-outline"
  return "pulse-outline"
}

export default function LogsScreen() {
  const [date, setDate] = useState(todayIso())
  const [sessions, setSessions] = useState<MobilePhoneSession[]>([])
  const [usingSec, setUsingSec] = useState(0)
  const [lockedSec, setLockedSec] = useState(0)
  const [rows, setRows] = useState<ActivityLogRecord[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [username, setUsername] = useState("")
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(username.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [username])

  useEffect(() => {
    let cancelled = false
    if (page === 1) setLoading(true)
    void Promise.all([
      page === 1 ? fetchMobileSessions({ date, username: query || undefined }) : Promise.resolve(null),
      fetchActivityLogs({ page, page_size: PAGE_SIZE, username: query || undefined, source: "mobile", date }),
    ])
      .then(([phone, logs]) => {
        if (cancelled) return
        if (phone) {
          setSessions(phone.results)
          setUsingSec(phone.totals.using_seconds)
          setLockedSec(phone.totals.locked_seconds)
        }
        setRows((prev) => {
          const merged = page === 1 ? logs.results : [...prev, ...logs.results]
          // De-dup by id so shifting server pages can't produce duplicate keys.
          const seen = new Set<number>()
          return merged.filter((r) => (seen.has(r.id) ? false : seen.add(r.id)))
        })
        setCount(logs.count)
        setError("")
      })
      .catch((err) => {
        if (cancelled) return
        if (page === 1) {
          setSessions([])
          setRows([])
          setCount(0)
        }
        setError(err instanceof Error ? err.message : "Could not load logs")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, date, page])

  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
  const hasMore = rows.length < count

  const data = useMemo(() => (loading && page === 1 ? [] : rows), [loading, page, rows])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={data}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <ScreenTitle title="Mobile logs" subtitle="Time each phone spent in the app vs locked, with lock/unlock times." />
            <View style={s.dateBar}>
              <Pressable style={s.dateBtn} onPress={() => { setPage(1); setDate((d) => shiftIso(d, -1)) }}>
                <Ionicons name="chevron-back" size={20} color={colors.gold} />
              </Pressable>
              <View style={s.dateCenter}>
                <Ionicons name="calendar-outline" size={16} color={colors.goldLight} />
                <Text style={s.dateLabel}>{dateLabel}</Text>
              </View>
              <Pressable style={s.dateBtn} onPress={() => { setPage(1); setDate((d) => shiftIso(d, 1)) }}>
                <Ionicons name="chevron-forward" size={20} color={colors.gold} />
              </Pressable>
            </View>
            <View style={s.searchWrap}>
              <Ionicons name="search" size={16} color={colors.faint} />
              <TextInput style={s.search} placeholder="Search by username" placeholderTextColor={colors.faint} value={username} onChangeText={setUsername} autoCapitalize="none" />
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={[s.totTile, { borderColor: "#bbf7d0", backgroundColor: colors.goodBg }]}>
                <Ionicons name="phone-portrait" size={18} color="#166534" />
                <Text style={[s.totLabel, { color: "#166534" }]}>In the app</Text>
                <Text style={[s.totValue, { color: "#14532d" }]}>{formatDuration(usingSec)}</Text>
              </View>
              <View style={[s.totTile, { borderColor: colors.border, backgroundColor: colors.chipBg }]}>
                <Ionicons name="lock-closed" size={18} color={colors.muted} />
                <Text style={[s.totLabel, { color: colors.muted }]}>Phone locked</Text>
                <Text style={[s.totValue, { color: colors.text }]}>{formatDuration(lockedSec)}</Text>
              </View>
            </View>
            {error ? <ErrorBanner message={error} /> : null}
            {loading && page === 1 ? <Loading /> : null}
            {!loading && sessions.length > 0 ? (
              <Text style={s.sectionHead}>Lock & unlock timeline</Text>
            ) : null}
            {sessions.map((row) => {
              const away = row.state === "locked"
              const seconds = row.ended_at ? row.duration_seconds ?? row.live_seconds : row.live_seconds
              return (
                <View key={`sess-${row.id}`} style={[s.sessCard, away ? {} : { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={[s.sessIcon, { backgroundColor: away ? colors.chipBg : colors.goodBg }]}>
                      <Ionicons name={away ? "lock-closed" : "phone-portrait"} size={14} color={away ? colors.muted : colors.good} />
                    </View>
                    <Text style={[s.sessName, { flex: 1 }]}>{row.name || row.username}</Text>
                    <Text style={s.sessDur}>{formatDuration(seconds)}</Text>
                  </View>
                  <Text style={s.sessMeta}>
                    {away ? "Phone locked" : "Using the app"} · {formatTime(row.started_at)}
                    {row.ended_at ? ` – ${formatTime(row.ended_at)}` : " – still open"}
                  </Text>
                </View>
              )
            })}
            {!loading && sessions.length === 0 && rows.length === 0 && !error ? (
              <EmptyState icon="list-outline" title="No phone activity" description="No lock/use sessions or events for this date." />
            ) : null}
            {rows.length > 0 ? <Text style={s.sectionHead}>Events</Text> : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.eventCard}>
            <View style={s.eventIcon}>
              <Ionicons name={eventIcon(item.action)} size={16} color={colors.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text style={s.eventAction}>{item.action}</Text>
                <Text style={s.eventTime}>{formatTime(item.time)}</Text>
              </View>
              <Text style={s.eventUser}>{item.username || "Unknown"}</Text>
              {item.os || item.device ? <Text style={s.eventMeta}>{[item.os, item.device].filter(Boolean).join(" · ")}</Text> : null}
            </View>
          </View>
        )}
        ListFooterComponent={
          !loading && hasMore ? (
            <Pressable style={s.moreBtn} onPress={() => setPage((p) => p + 1)}>
              <Text style={{ fontWeight: "700", color: colors.text }}>Load more ({rows.length} of {count})</Text>
            </Pressable>
          ) : null
        }
      />
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
  totTile: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: 12, gap: 4 },
  totLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  totValue: { fontSize: 22, fontWeight: "700", marginTop: 4 },
  sectionHead: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 1, marginTop: 4 },
  sessCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14 },
  sessName: { fontWeight: "700", color: colors.text },
  sessIcon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  sessDur: { fontWeight: "700", color: colors.text },
  sessMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  eventCard: { flexDirection: "row", gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14, ...shadow },
  eventIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  eventUser: { color: colors.muted, fontSize: 12, marginTop: 2 },
  eventTime: { fontSize: 11, color: colors.faint },
  eventAction: { color: colors.text, fontWeight: "600", flex: 1 },
  eventMeta: { color: colors.faint, fontSize: 11, marginTop: 4 },
  moreBtn: { height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginTop: 6 },
})
