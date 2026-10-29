import React, { useEffect, useMemo, useRef, useState } from "react"
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Linking, useWindowDimensions } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius, shadow } from "../theme"
import { fetchGpsHistory, fetchGpsLive, fetchGpsMe, hoursSinceLocalMidnight, type GpsOfficer } from "../lib/gps-api"
import { formatDuration, formatTime, prettyRole, timeAgo } from "../lib/format"
import { summarizeRoute, type RouteSummary } from "../components/route-summary"
import { canViewAllStaff, getCachedUser } from "../lib/auth"
import { Avatar, EmptyState, ErrorBanner, FilterChip, Loading, ScreenTitle, StatusChip } from "../ui"
import LiveMap from "../components/LiveMap"
import { buildMapData, hasFix } from "../components/map-html"

type Range = "today" | "24h" | "48h"
type StatusFilter = "all" | GpsOfficer["status"]

export default function LocationScreen({ route: navRoute }: { route?: { params?: { userId?: number; at?: number } } }) {
  const overview = canViewAllStaff()
  const me = getCachedUser()
  const { height: windowHeight } = useWindowDimensions()
  const scrollRef = useRef<ScrollView>(null)
  const [officers, setOfficers] = useState<GpsOfficer[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [range, setRange] = useState<Range>("today")
  // The route is stored with the officer/range it belongs to, so switching either one
  // hides the old route straight away without an extra state reset.
  const [routeState, setRouteState] = useState<{ key: string; route: RouteSummary | null } | null>(null)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [handledRequest, setHandledRequest] = useState<string | null>(null)

  const hours = range === "today" ? hoursSinceLocalMidnight() : range === "24h" ? 24 : 48
  const requestedId = navRoute?.params?.userId
  const requestedAt = navRoute?.params?.at
  const routeKey = selectedId == null ? null : `${selectedId}-${range}`
  const route = routeKey != null && routeState?.key === routeKey ? routeState.route : null
  const routeLoading = routeKey != null && routeState?.key !== routeKey

  // Opening this tab from a dashboard pin selects that officer.
  const requestKey = requestedId != null ? `${requestedId}-${requestedAt ?? ""}` : null
  if (requestKey != null && requestKey !== handledRequest) {
    setHandledRequest(requestKey)
    setSelectedId(requestedId ?? null)
    setStatusFilter("all")
  }

  useEffect(() => {
    if (requestedId != null) scrollRef.current?.scrollTo({ y: 0, animated: true })
  }, [requestedId, requestedAt])

  useEffect(() => {
    let cancelled = false
    const loadLive = () =>
      (overview ? fetchGpsLive(undefined, true) : fetchGpsMe().then((o) => [o]))
        .then((data) => {
          if (cancelled) return
          setOfficers(data)
          setError("")
          setSelectedId((prev) => {
            if (!overview && me?.id) return data.find((o) => o.userId === me.id)?.userId ?? data[0]?.userId ?? me.id
            if (prev && data.some((o) => o.userId === prev)) return prev
            return (data.find((o) => o.status === "live") ?? data.find(hasFix) ?? data[0])?.userId ?? null
          })
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Could not load locations")
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    void loadLive()
    const live = setInterval(() => void loadLive(), 10000)
    // The route grows while an officer moves, so refresh it on a slower cadence.
    const trail = setInterval(() => setTick((t) => t + 1), 30000)
    return () => {
      cancelled = true
      clearInterval(live)
      clearInterval(trail)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedId == null || routeKey == null) return
    let cancelled = false
    fetchGpsHistory(selectedId, hours)
      .then((pts) => !cancelled && setRouteState({ key: routeKey, route: summarizeRoute(pts) }))
      .catch(() => !cancelled && setRouteState({ key: routeKey, route: null }))
    return () => {
      cancelled = true
    }
  }, [selectedId, routeKey, hours, tick])

  const selected = officers.find((o) => o.userId === selectedId) ?? null

  const counts = useMemo(
    () => ({
      all: officers.length,
      live: officers.filter((o) => o.status === "live").length,
      stale: officers.filter((o) => o.status === "stale").length,
      offline: officers.filter((o) => o.status === "offline").length,
    }),
    [officers],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rank = (st: GpsOfficer["status"]) => (st === "live" ? 0 : st === "stale" ? 1 : 2)
    return [...officers]
      .filter((o) => statusFilter === "all" || o.status === statusFilter)
      .filter((o) => !q || [o.name, o.username, o.role, o.location, o.employeeId].join(" ").toLowerCase().includes(q))
      .sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name))
  }, [officers, search, statusFilter])

  const pinned = useMemo(() => {
    const list = overview ? filtered : officers
    return selected && !list.includes(selected) ? [...list, selected] : list
  }, [overview, filtered, officers, selected])

  const hasRoute = route != null && route.points.length > 0
  const mapData = useMemo(
    () => buildMapData(pinned, selectedId, route, `${selectedId}-${range}-${hasRoute ? 1 : 0}`),
    [pinned, selectedId, route, range, hasRoute],
  )

  function select(id: number) {
    setSelectedId(id)
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  }

  const mapHeight = Math.max(300, Math.round(windowHeight * 0.48))

  return (
    <ScrollView ref={scrollRef} style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ScreenTitle
        title={overview ? "Staff location" : "My location"}
        subtitle={overview ? "Live pins for every officer · tap a pin to see their full route" : "Your GPS position and route"}
      />

      <View style={s.rangeRow}>
        {(["today", "24h", "48h"] as const).map((r) => (
          <Pressable key={r} style={[s.rangeBtn, range === r && s.rangeActive]} onPress={() => setRange(r)}>
            <Text style={[s.rangeText, range === r && { color: colors.goldLight }]}>
              {r === "today" ? "Today" : r === "24h" ? "Last 24h" : "Last 48h"}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      <View>
        <LiveMap data={mapData} height={mapHeight} onSelect={select} />
        {selected ? (
          <View style={s.mapBadge} pointerEvents="none">
            <View style={[s.mapBadgeDot, { backgroundColor: selected.status === "live" ? "#22c55e" : selected.status === "stale" ? "#f59e0b" : "#94a3b8" }]} />
            <Text style={s.mapBadgeText} numberOfLines={1}>
              {selected.name || selected.username}
              {routeLoading && !hasRoute ? " · loading route…" : hasRoute ? ` · ${route.points.length} pts` : " · no route"}
            </Text>
          </View>
        ) : null}
      </View>

      {loading ? <Loading label="Loading locations" /> : null}

      {!loading && officers.length === 0 && !error ? (
        <EmptyState
          icon="location-outline"
          title="No GPS records yet"
          description={overview ? "Staff appear here once they sign in and allow location." : "Allow Location on this phone to share your position."}
        />
      ) : null}

      {selected ? <OfficerPanel officer={selected} route={route} routeLoading={routeLoading} /> : null}

      {!loading && overview && officers.length > 0 ? (
        <View style={s.card}>
          <Text style={s.cardHead}>Officers</Text>
          <View style={s.searchWrap}>
            <Ionicons name="search" size={16} color={colors.faint} />
            <TextInput
              style={s.search}
              placeholder="Search employee, ID, station"
              placeholderTextColor={colors.faint}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {(["all", "live", "stale", "offline"] as const).map((f) => (
              <FilterChip
                key={f}
                label={`${f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)} ${counts[f]}`}
                active={statusFilter === f}
                onPress={() => setStatusFilter(f)}
              />
            ))}
          </ScrollView>
          {filtered.length === 0 ? <Text style={s.muted}>No officers match.</Text> : null}
          {filtered.map((o) => (
            <Pressable key={o.userId} style={[s.officerRow, o.userId === selectedId && s.officerRowActive]} onPress={() => select(o.userId)}>
              <Avatar name={o.name || o.username} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={s.officerName}>{o.name || o.username}</Text>
                <Text style={s.officerMeta}>
                  {[o.employeeId, o.onDuty ? "On duty" : "Off duty", timeAgo(o.recordedAt)].filter(Boolean).join(" · ")}
                </Text>
              </View>
              {o.batteryPct != null ? (
                <View style={s.battery}>
                  <Ionicons
                    name={o.batteryPct < 20 ? "battery-dead" : o.batteryPct < 60 ? "battery-half" : "battery-full"}
                    size={14}
                    color={o.batteryPct < 20 ? colors.bad : colors.muted}
                  />
                  <Text style={s.batteryText}>{o.batteryPct}%</Text>
                </View>
              ) : null}
              <StatusChip status={o.status} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  )
}

function OfficerPanel({ officer, route, routeLoading }: { officer: GpsOfficer; route: RouteSummary | null; routeLoading: boolean }) {
  const fix = hasFix(officer)
  const latest = route?.end ?? null
  return (
    <View style={s.card}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Avatar name={officer.name || officer.username} size={52} />
        <View style={{ flex: 1 }}>
          <Text style={s.detailName}>{officer.name || officer.username}</Text>
          <Text style={s.officerMeta}>
            {[prettyRole(officer.role), officer.employeeId, officer.location?.replace(/_/g, " ")].filter(Boolean).join(" · ")}
          </Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
            <StatusChip status={officer.status} />
            <View style={[s.dutyChip, { backgroundColor: officer.onDuty ? colors.good : colors.faint }]}>
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{officer.onDuty ? "On duty" : "Off duty"}</Text>
            </View>
          </View>
        </View>
        {fix ? (
          <Pressable
            style={s.gmaps}
            onPress={() => void Linking.openURL(`https://www.google.com/maps?q=${officer.latitude},${officer.longitude}`)}
          >
            <Ionicons name="navigate" size={18} color={colors.navy} />
          </Pressable>
        ) : null}
      </View>

      {!fix ? (
        <View style={s.noFix}>
          <Ionicons name="alert-circle" size={16} color="#92400e" />
          <Text style={{ color: "#92400e", flex: 1 }}>No GPS fix yet for this employee.</Text>
        </View>
      ) : null}

      <Text style={s.subHead}>Route summary</Text>
      <View style={s.summaryGrid}>
        <Summary icon="trail-sign" value={route ? `${route.distanceKm.toFixed(2)} km` : "—"} label="Distance" />
        <Summary icon="time" value={route ? formatDuration(route.durationSec) : "—"} label="Tracked" />
        <Summary icon="walk" value={route ? formatDuration(route.movingSec) : "—"} label="Moving" />
        <Summary icon="speedometer" value={route?.avgSpeedKmh != null ? `${route.avgSpeedKmh.toFixed(0)} km/h` : "—"} label="Avg speed" />
        <Summary icon="flash" value={route?.maxSpeedKmh != null ? `${route.maxSpeedKmh.toFixed(0)} km/h` : "—"} label="Top speed" />
        <Summary icon="pause-circle" value={route ? String(route.stops.length) : "—"} label="Stops" />
      </View>

      <Text style={s.subHead}>Current position</Text>
      <View style={s.grid}>
        <Field label="Latitude" value={officer.latitude?.toFixed(5) ?? "—"} />
        <Field label="Longitude" value={officer.longitude?.toFixed(5) ?? "—"} />
        <Field label="Accuracy" value={officer.accuracy != null ? `${Math.round(officer.accuracy)} m` : "—"} />
        <Field label="Speed" value={officer.speedKmh != null ? `${officer.speedKmh.toFixed(0)} km/h` : "—"} />
        <Field label="Last update" value={timeAgo(officer.recordedAt)} />
        <Field label="Battery" value={officer.batteryPct != null ? `${officer.batteryPct}%` : "—"} />
      </View>

      <Text style={s.subHead}>Route timeline</Text>
      {routeLoading && !route ? <Loading /> : null}
      {!routeLoading && (!route || route.points.length === 0) ? (
        <Text style={s.muted}>No GPS points recorded in this period.</Text>
      ) : null}
      {route && route.start ? (
        <View>
          <TimelineItem
            color={colors.good}
            icon="flag"
            title={`Started · ${formatTime(route.start.recordedAt)}`}
            detail={route.start.locationName || `${route.start.latitude.toFixed(5)}, ${route.start.longitude.toFixed(5)}`}
          />
          {route.stops.map((st, i) => (
            <TimelineItem
              key={`${st.from}-${i}`}
              color="#f59e0b"
              label={String(i + 1)}
              title={`Stopped ${formatDuration(st.durationSec)} · ${formatTime(st.from)}–${formatTime(st.to)}`}
              detail={st.locationName || `${st.latitude.toFixed(5)}, ${st.longitude.toFixed(5)}`}
            />
          ))}
          {latest && latest !== route.start ? (
            <TimelineItem
              color={colors.navy}
              icon="location"
              title={`Latest · ${formatTime(latest.recordedAt)}`}
              detail={latest.locationName || `${latest.latitude.toFixed(5)}, ${latest.longitude.toFixed(5)}`}
              last
            />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function Summary({ icon, value, label }: { icon: keyof typeof Ionicons.glyphMap; value: string; label: string }) {
  return (
    <View style={s.summary}>
      <Ionicons name={icon} size={16} color={colors.gold} />
      <Text style={s.summaryValue}>{value}</Text>
      <Text style={s.summaryLabel}>{label}</Text>
    </View>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "47%" }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value}</Text>
    </View>
  )
}

function TimelineItem({
  color,
  icon,
  label,
  title,
  detail,
  last,
}: {
  color: string
  icon?: keyof typeof Ionicons.glyphMap
  label?: string
  title: string
  detail: string
  last?: boolean
}) {
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ alignItems: "center", width: 26 }}>
        <View style={[s.tlDot, { backgroundColor: color }]}>
          {icon ? <Ionicons name={icon} size={12} color="#fff" /> : <Text style={s.tlLabel}>{label}</Text>}
        </View>
        {!last ? <View style={s.tlLine} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 14 }}>
        <Text style={s.tlTitle}>{title}</Text>
        <Text style={s.tlDetail}>{detail}</Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  rangeRow: { flexDirection: "row", gap: 8 },
  rangeBtn: { flex: 1, height: 36, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  rangeActive: { backgroundColor: colors.navy, borderColor: colors.gold },
  rangeText: { fontSize: 12, fontWeight: "700", color: colors.muted },
  mapBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    maxWidth: "70%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(11,26,51,0.9)",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  mapBadgeDot: { width: 8, height: 8, borderRadius: 4 },
  mapBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700", flexShrink: 1 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f7f9fc", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 46 },
  search: { flex: 1, color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10, ...shadow },
  cardHead: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
  muted: { color: colors.muted, fontSize: 13 },
  officerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 6, borderRadius: radius.sm },
  officerRowActive: { backgroundColor: colors.goldBg },
  officerName: { fontWeight: "700", color: colors.text, fontSize: 14 },
  officerMeta: { color: colors.muted, fontSize: 11, marginTop: 1 },
  battery: { flexDirection: "row", alignItems: "center", gap: 2 },
  batteryText: { fontSize: 11, color: colors.muted, fontWeight: "600" },
  detailName: { fontSize: 18, fontWeight: "700", color: colors.text },
  dutyChip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  gmaps: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.goldBg, borderWidth: 1, borderColor: colors.gold, alignItems: "center", justifyContent: "center" },
  noFix: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: "#fde68a", backgroundColor: colors.warnBg, padding: 12 },
  subHead: { fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 1, marginTop: 6 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  summary: { flexGrow: 1, flexBasis: "30%", backgroundColor: colors.navy, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", gap: 2 },
  summaryValue: { color: colors.goldLight, fontSize: 14, fontWeight: "700" },
  summaryLabel: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 10, columnGap: 12 },
  fieldLabel: { fontSize: 11, color: colors.muted },
  fieldValue: { fontSize: 14, fontWeight: "700", color: colors.text },
  tlDot: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  tlLabel: { color: "#fff", fontSize: 11, fontWeight: "700" },
  tlLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  tlTitle: { fontWeight: "700", color: colors.text, fontSize: 13 },
  tlDetail: { color: colors.muted, fontSize: 12, marginTop: 2 },
})
