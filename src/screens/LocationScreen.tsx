import React, { useEffect, useMemo, useState } from "react"
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native"
import { WebView } from "react-native-webview"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius } from "../theme"
import {
  fetchGpsHistory,
  fetchGpsLive,
  fetchGpsMe,
  hoursSinceLocalMidnight,
  trailDistanceKm,
  type GpsHistoryPoint,
  type GpsOfficer,
} from "../lib/gps-api"
import { formatTime, prettyRole, timeAgo } from "../lib/format"
import { canViewAllStaff, getCachedUser } from "../lib/auth"
import { Avatar, EmptyState, ErrorBanner, Loading, StatusChip } from "../ui"

function hasFix(o: GpsOfficer) {
  return o.latitude != null && o.longitude != null && !(o.latitude === 0 && o.longitude === 0)
}

function leafletHtml(lat: number, lng: number, trail: GpsHistoryPoint[]): string {
  const pts = trail.filter((p) => p.latitude != null && p.longitude != null).map((p) => [p.latitude, p.longitude])
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#map{height:100%;margin:0}</style></head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
var map=L.map('map').setView([${lat},${lng}],15);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var trail=${JSON.stringify(pts)};
if(trail.length>1){var line=L.polyline(trail,{color:'#1d4ed8',weight:4}).addTo(map);map.fitBounds(line.getBounds().pad(0.25));}
L.circleMarker([${lat},${lng}],{radius:8,color:'#16a34a',fillColor:'#16a34a',fillOpacity:1}).addTo(map);
</script></body></html>`
}

export default function LocationScreen() {
  const overview = canViewAllStaff()
  const me = getCachedUser()
  const [officers, setOfficers] = useState<GpsOfficer[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [range, setRange] = useState<"today" | "24h" | "48h">("today")
  const [trail, setTrail] = useState<GpsHistoryPoint[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  const hours = range === "today" ? hoursSinceLocalMidnight() : range === "24h" ? 24 : 48

  async function loadLive() {
    try {
      const data = overview ? await fetchGpsLive(undefined, true) : [await fetchGpsMe()]
      setOfficers(data)
      setError("")
      setSelectedId((prev) => {
        if (!overview && me?.id) return data.find((o) => o.userId === me.id)?.userId ?? data[0]?.userId ?? me.id
        if (prev && data.some((o) => o.userId === prev)) return prev
        return (data.find((o) => o.status === "live") ?? data.find(hasFix) ?? data[0])?.userId ?? null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load locations")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadLive()
    const id = setInterval(() => void loadLive(), 10000)
    return () => clearInterval(id)
  }, [])

  const selected = officers.find((o) => o.userId === selectedId) ?? null

  useEffect(() => {
    if (selectedId == null) {
      setTrail([])
      return
    }
    let cancelled = false
    fetchGpsHistory(selectedId, hours)
      .then((pts) => !cancelled && setTrail(pts))
      .catch(() => !cancelled && setTrail([]))
    return () => {
      cancelled = true
    }
  }, [selectedId, hours])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = [...officers].sort((a, b) => {
      const rank = (st: GpsOfficer["status"]) => (st === "live" ? 0 : st === "stale" ? 1 : 2)
      return rank(a.status) - rank(b.status) || a.name.localeCompare(b.name)
    })
    if (!q) return list
    return list.filter((o) => [o.name, o.username, o.role, o.location, o.employeeId].join(" ").toLowerCase().includes(q))
  }, [officers, search])

  const km = trailDistanceKm(trail)

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={s.h1}>{overview ? "Staff location" : "My location"}</Text>

      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["today", "24h", "48h"] as const).map((r) => (
          <Pressable key={r} style={[s.rangeBtn, range === r && s.rangeActive]} onPress={() => setRange(r)}>
            <Text style={[s.rangeText, range === r && { color: "#fff" }]}>{r === "today" ? "Today" : r === "24h" ? "Last 24h" : "Last 48h"}</Text>
          </Pressable>
        ))}
      </View>

      {overview ? (
        <View style={s.searchWrap}>
          <Ionicons name="search" size={16} color={colors.faint} />
          <TextInput style={s.search} placeholder="Search employee, ID, station" placeholderTextColor={colors.faint} value={search} onChangeText={setSearch} />
        </View>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <Loading /> : null}

      {!loading && officers.length === 0 && !error ? (
        <EmptyState icon="location-outline" title="No GPS records yet" description={overview ? "Staff appear here once they sign in and allow location." : "Allow Location on this phone to share your position."} />
      ) : null}

      {!loading && overview && filtered.length > 0 ? (
        <View style={s.card}>
          <Text style={s.cardHead}>Officers ({filtered.length})</Text>
          {filtered.map((o) => (
            <Pressable key={o.userId} style={[s.officerRow, o.userId === selectedId && { backgroundColor: colors.chipBg }]} onPress={() => setSelectedId(o.userId)}>
              <Avatar name={o.name || o.username} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={s.officerName}>{o.name || o.username}</Text>
                <Text style={s.officerMeta}>{[o.employeeId, timeAgo(o.recordedAt)].filter(Boolean).join(" · ")}</Text>
              </View>
              <StatusChip status={o.status} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {selected ? (
        <View style={s.card}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <Avatar name={selected.name} size={52} />
            <View style={{ flex: 1 }}>
              <Text style={s.detailName}>{selected.name}</Text>
              <Text style={s.officerMeta}>{[prettyRole(selected.role), selected.location?.replace(/_/g, " ")].filter(Boolean).join(" · ")}</Text>
              <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                <StatusChip status={selected.status} />
                <View style={[s.dutyChip, { backgroundColor: selected.onDuty ? colors.good : colors.faint }]}>
                  <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{selected.onDuty ? "On duty" : "Off duty"}</Text>
                </View>
              </View>
            </View>
          </View>

          {hasFix(selected) ? (
            <View style={s.mapWrap}>
              <WebView
                style={{ flex: 1 }}
                originWhitelist={["*"]}
                source={{ html: leafletHtml(selected.latitude as number, selected.longitude as number, trail) }}
              />
            </View>
          ) : (
            <View style={s.noFix}>
              <Text style={{ color: "#92400e" }}>No GPS fix yet for this employee.</Text>
            </View>
          )}

          <View style={s.grid}>
            <Field label="Latitude" value={selected.latitude?.toFixed(5) ?? "—"} />
            <Field label="Longitude" value={selected.longitude?.toFixed(5) ?? "—"} />
            <Field label="Accuracy" value={selected.accuracy != null ? `${Math.round(selected.accuracy)} m` : "—"} />
            <Field label="Speed" value={selected.speedKmh != null ? `${selected.speedKmh.toFixed(0)} km/h` : "—"} />
            <Field label="Last update" value={timeAgo(selected.recordedAt)} />
            <Field label="Battery" value={selected.batteryPct != null ? `${selected.batteryPct}%` : "—"} />
          </View>

          <View style={s.routeStats}>
            <Stat value={`${km.toFixed(1)} km`} label="Distance" />
            <Stat value={String(trail.length)} label="GPS points" />
            <Stat value={formatTime(selected.dutyStartedAt)} label="Duty started" />
          </View>
        </View>
      ) : null}
    </ScrollView>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "48%" }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value}</Text>
    </View>
  )
}
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={s.fieldValue}>{value}</Text>
      <Text style={s.fieldLabel}>{label}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  h1: { fontSize: 20, fontWeight: "800", color: colors.text },
  rangeBtn: { flex: 1, height: 36, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  rangeActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  rangeText: { fontSize: 12, fontWeight: "700", color: colors.muted },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 48 },
  search: { flex: 1, color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  cardHead: { fontSize: 13, fontWeight: "700", color: colors.text },
  officerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderRadius: radius.sm, paddingHorizontal: 4 },
  officerName: { fontWeight: "700", color: colors.text, fontSize: 14 },
  officerMeta: { color: colors.muted, fontSize: 11, marginTop: 1 },
  detailName: { fontSize: 18, fontWeight: "800", color: colors.text },
  dutyChip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  mapWrap: { height: 220, borderRadius: radius.sm, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  noFix: { borderRadius: radius.sm, borderWidth: 1, borderColor: "#fde68a", backgroundColor: colors.warnBg, padding: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 10, columnGap: 10 },
  fieldLabel: { fontSize: 11, color: colors.muted },
  fieldValue: { fontSize: 14, fontWeight: "700", color: colors.text },
  routeStats: { flexDirection: "row", backgroundColor: "#f8fafc", borderRadius: radius.sm, padding: 12 },
})
