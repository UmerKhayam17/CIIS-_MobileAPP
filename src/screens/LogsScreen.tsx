import React, { useEffect, useMemo, useState } from "react"
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius } from "../theme"
import {
  fetchActivityLogs,
  fetchMobileSessions,
  type ActivityLogRecord,
  type MobilePhoneSession,
} from "../lib/logs-api"
import { formatDuration, formatTime, shiftIso, todayIso } from "../lib/format"
import { EmptyState, ErrorBanner, Loading } from "../ui"

const PAGE_SIZE = 40

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
            <View>
              <Text style={s.h1}>Mobile logs</Text>
              <Text style={s.sub}>Time each phone spent in the app vs locked, with lock/unlock times.</Text>
            </View>
            <View style={s.dateBar}>
              <Pressable style={s.dateBtn} onPress={() => { setPage(1); setDate((d) => shiftIso(d, -1)) }}>
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </Pressable>
              <Text style={s.dateLabel}>{dateLabel}</Text>
              <Pressable style={s.dateBtn} onPress={() => { setPage(1); setDate((d) => shiftIso(d, 1)) }}>
                <Ionicons name="chevron-forward" size={20} color={colors.text} />
              </Pressable>
            </View>
            <View style={s.searchWrap}>
              <Ionicons name="search" size={16} color={colors.faint} />
              <TextInput style={s.search} placeholder="Search by username" placeholderTextColor={colors.faint} value={username} onChangeText={setUsername} autoCapitalize="none" />
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={[s.totTile, { borderColor: "#bbf7d0", backgroundColor: colors.goodBg }]}>
                <Text style={[s.totLabel, { color: "#166534" }]}>In the app</Text>
                <Text style={[s.totValue, { color: "#14532d" }]}>{formatDuration(usingSec)}</Text>
              </View>
              <View style={[s.totTile, { borderColor: colors.border, backgroundColor: "#f8fafc" }]}>
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
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={s.sessName}>{row.name || row.username}</Text>
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
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={s.eventUser}>{item.username || "Unknown"}</Text>
              <Text style={s.eventTime}>{formatTime(item.time)}</Text>
            </View>
            <Text style={s.eventAction}>{item.action}</Text>
            <Text style={s.eventMeta}>{[item.os, item.device].filter(Boolean).join(" · ")}</Text>
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
  h1: { fontSize: 20, fontWeight: "800", color: colors.text },
  sub: { color: colors.muted, marginTop: 2 },
  dateBar: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 6 },
  dateBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dateLabel: { flex: 1, textAlign: "center", fontWeight: "700", color: colors.text },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 48 },
  search: { flex: 1, color: colors.text },
  totTile: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: 12 },
  totLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  totValue: { fontSize: 22, fontWeight: "800", marginTop: 4 },
  sectionHead: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", marginTop: 4 },
  sessCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14 },
  sessName: { fontWeight: "700", color: colors.text },
  sessDur: { fontWeight: "800", color: colors.text },
  sessMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  eventCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14 },
  eventUser: { fontWeight: "700", color: colors.text },
  eventTime: { fontSize: 11, color: colors.faint },
  eventAction: { color: colors.text, marginTop: 4 },
  eventMeta: { color: colors.faint, fontSize: 11, marginTop: 4 },
  moreBtn: { height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginTop: 6 },
})
