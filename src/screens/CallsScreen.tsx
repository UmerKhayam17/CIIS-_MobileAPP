import React, { useCallback, useEffect, useMemo, useState } from "react"
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, Linking, Alert, Platform } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius, shadow } from "../theme"
import { fetchCalls, type CallRecord } from "../lib/calls-api"
import { requestPlayback } from "../lib/recordings-api"
import { isUnavailable, type FeatureUnavailable } from "../lib/monitor-api"
import { formatDuration, formatTime, todayIso } from "../lib/format"
import { canViewAllStaff } from "../lib/auth"
import { EmptyState, ErrorBanner, FilterChip, KpiTile, Loading, ScreenTitle, UnavailableState } from "../ui"

type DirFilter = "all" | "inbound" | "outbound" | "missed"
type RangeKey = "today" | "7d" | "30d"

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
]

const DIR_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }> = {
  inbound: { icon: "arrow-down-outline", color: colors.good, label: "Incoming" },
  outbound: { icon: "arrow-up-outline", color: colors.primary, label: "Outgoing" },
  missed: { icon: "close-outline", color: colors.bad, label: "Missed" },
  unknown: { icon: "help-outline", color: colors.faint, label: "Unknown" },
}

const REC_META: Record<string, { label: string; bg: string; fg: string }> = {
  available: { label: "Recording", bg: colors.goodBg, fg: "#166534" },
  pending: { label: "Processing", bg: colors.warnBg, fg: "#92400e" },
  failed: { label: "Rec. failed", bg: colors.badBg, fg: "#991b1b" },
  not_recorded: { label: "Not recorded", bg: "#f1f5f9", fg: "#334155" },
  unavailable: { label: "No source", bg: "#f1f5f9", fg: "#64748b" },
}

export default function CallsScreen() {
  const overview = canViewAllStaff()
  // Default to a 7-day window: a freshly-synced phone uploads its past call history dated on
  // earlier days, so a "today only" default would look empty even when records exist.
  const [range, setRange] = useState<RangeKey>("7d")
  const [rows, setRows] = useState<CallRecord[]>([])
  const [dir, setDir] = useState<DirFilter>("all")
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const [unavailable, setUnavailable] = useState<FeatureUnavailable | null>(null)
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = range === "today" ? { date: todayIso() } : { days: range === "7d" ? 7 : 30 }
      const page = await fetchCalls(params)
      setRows(page.results)
      setError("")
      setUnavailable(null)
    } catch (err) {
      setRows([])
      if (isUnavailable(err)) setUnavailable(err)
      else setError(err instanceof Error ? err.message : "Could not load calls")
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void load()
  }, [load])

  async function play(rec: CallRecord) {
    if (!rec.recording_id || playing) return
    setPlaying(rec.id)
    try {
      const { url } = await requestPlayback(rec.recording_id)
      await Linking.openURL(url)
    } catch (err) {
      const msg = isUnavailable(err) ? "Playback isn't available on this deployment." : err instanceof Error ? err.message : "Could not open recording."
      if (Platform.OS === "web") window.alert(msg)
      else Alert.alert("Recording", msg)
    } finally {
      setPlaying(null)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => dir === "all" || r.direction === dir)
      .filter((r) => !q || [r.masked_number, r.source_label, r.source].join(" ").toLowerCase().includes(q))
  }, [rows, dir, query])

  const summary = useMemo(
    () => ({
      total: rows.length,
      recorded: rows.filter((r) => r.recording_status === "available").length,
      talk: rows.reduce((n, r) => n + (r.duration_seconds ?? 0), 0),
    }),
    [rows],
  )

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={loading || error || unavailable ? [] : filtered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 2 }}>
            <ScreenTitle
              title={overview ? "Staff calls" : "My calls"}
              subtitle="Numbers, direction, time and duration from the phone call log — never audio."
            />
            <View style={s.rangeBar}>
              {RANGES.map((r) => (
                <Pressable
                  key={r.key}
                  style={[s.rangeBtn, range === r.key && s.rangeBtnActive]}
                  onPress={() => setRange(r.key)}
                >
                  <Text style={[s.rangeText, range === r.key && s.rangeTextActive]}>{r.label}</Text>
                </Pressable>
              ))}
            </View>

            {!loading && !error && !unavailable ? (
              <>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <KpiTile icon="call" label="Calls" value={summary.total} tone={colors.primary} />
                  <KpiTile icon="recording-outline" label="Recorded" value={summary.recorded} tone={colors.good} />
                  <KpiTile icon="time" label="Talk time" value={formatDuration(summary.talk)} tone={colors.gold} />
                </View>
                {overview ? (
                  <View style={s.searchWrap}>
                    <Ionicons name="search" size={16} color={colors.faint} />
                    <TextInput style={s.search} placeholder="Search number or source" placeholderTextColor={colors.faint} value={query} onChangeText={setQuery} />
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {(["all", "inbound", "outbound", "missed"] as const).map((d) => (
                    <FilterChip key={d} label={d === "all" ? "All" : DIR_META[d].label} active={dir === d} onPress={() => setDir(d)} />
                  ))}
                </View>
              </>
            ) : null}

            {error ? <ErrorBanner message={error} /> : null}
            {loading ? <Loading label="Loading calls" /> : null}
            {unavailable ? <UnavailableState reason={unavailable.reason} feature="Call records" /> : null}
          </View>
        }
        ListEmptyComponent={
          !loading && !error && !unavailable ? (
            <EmptyState icon="call-outline" title="No calls" description="No call records for this period yet." />
          ) : null
        }
        renderItem={({ item }) => {
          const d = DIR_META[item.direction] ?? DIR_META.unknown
          const rec = REC_META[item.recording_status] ?? REC_META.unavailable
          const canPlay = item.recording_status === "available" && !!item.recording_id
          return (
            <View style={s.card}>
              <View style={[s.dirIcon, { backgroundColor: `${d.color}1a` }]}>
                <Ionicons name={d.icon} size={18} color={d.color} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={s.number}>{item.masked_number || "Unknown number"}</Text>
                  <Text style={s.time}>{formatTime(item.started_at)}</Text>
                </View>
                <Text style={s.meta}>
                  {d.label}
                  {item.duration_seconds != null ? ` · ${formatDuration(item.duration_seconds)}` : ""}
                  {item.source_label ? ` · ${item.source_label}` : ""}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <View style={[s.recChip, { backgroundColor: rec.bg }]}>
                    <Text style={{ color: rec.fg, fontSize: 11, fontWeight: "700" }}>{rec.label}</Text>
                  </View>
                  {canPlay ? (
                    <Pressable style={s.playBtn} onPress={() => void play(item)} disabled={playing === item.id}>
                      <Ionicons name={playing === item.id ? "hourglass-outline" : "play"} size={14} color={colors.navy} />
                      <Text style={s.playText}>{playing === item.id ? "Opening…" : "Play"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          )
        }}
      />
    </View>
  )
}

const s = StyleSheet.create({
  rangeBar: { flexDirection: "row", alignItems: "center", backgroundColor: colors.navy, borderRadius: radius.md, padding: 6, gap: 6, ...shadow },
  rangeBtn: { flex: 1, height: 40, borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.07)", alignItems: "center", justifyContent: "center" },
  rangeBtnActive: { backgroundColor: colors.gold },
  rangeText: { fontWeight: "700", color: "rgba(255,255,255,0.82)", fontSize: 13 },
  rangeTextActive: { color: colors.navy },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 46 },
  search: { flex: 1, color: colors.text },
  card: { flexDirection: "row", gap: 12, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, ...shadow },
  dirIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  number: { fontWeight: "700", color: colors.text, fontSize: 15, flexShrink: 1 },
  time: { color: colors.faint, fontSize: 12 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  recChip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  playBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.goldLight, borderRadius: radius.pill, paddingHorizontal: 12, height: 28 },
  playText: { color: colors.navy, fontWeight: "700", fontSize: 12 },
})
