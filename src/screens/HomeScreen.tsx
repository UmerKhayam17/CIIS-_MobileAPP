import React, { useCallback, useEffect, useMemo, useState } from "react"
import { View, Text, ScrollView, Pressable, Image, RefreshControl, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius, shadow, brand } from "../theme"
import { getCachedUser, canViewAllStaff, displayName, shouldTrackLocation, type AuthUser } from "../lib/auth"
import { fetchGpsHistory, fetchGpsLive, fetchGpsMe, hoursSinceLocalMidnight, type GpsOfficer } from "../lib/gps-api"
import { fetchAttendance, type AttendanceRecord } from "../lib/attendance-api"
import { fetchActivityLogs, fetchMobileSessions, type ActivityLogRecord } from "../lib/logs-api"
import { formatDuration, formatTime, greeting, prettyRole, timeAgo, todayIso } from "../lib/format"
import { summarizeRoute, type RouteSummary } from "../lib/route"
import { useTrackingStatus } from "../lib/location"
import { Avatar, KpiTile, SectionCard, SegmentBar, StatusChip } from "../ui"
import LiveMap from "../components/LiveMap"
import { buildMapData, hasFix } from "../components/map-html"

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void }

export default function HomeScreen({ navigation }: { navigation: Nav }) {
  const user = getCachedUser()
  return canViewAllStaff(user) ? <AdminDashboard user={user} navigation={navigation} /> : <OfficerDashboard user={user} navigation={navigation} />
}

/* ------------------------------------------------------------------ admin */

function AdminDashboard({ user, navigation }: { user: AuthUser | null; navigation: Nav }) {
  const [officers, setOfficers] = useState<GpsOfficer[] | null>(null)
  const [attendance, setAttendance] = useState<AttendanceRecord[] | null>(null)
  const [events, setEvents] = useState<ActivityLogRecord[]>([])
  const [eventCount, setEventCount] = useState<number | null>(null)
  const [phone, setPhone] = useState<{ using: number; locked: number } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    const date = todayIso()
    const [g, att, logs, sess] = await Promise.allSettled([
      fetchGpsLive(undefined, true),
      fetchAttendance({ date }),
      fetchActivityLogs({ page: 1, page_size: 6, source: "mobile", date }),
      fetchMobileSessions({ date }),
    ])
    if (g.status === "fulfilled") setOfficers(g.value)
    if (att.status === "fulfilled") setAttendance(att.value)
    if (logs.status === "fulfilled") {
      setEvents(logs.value.results)
      setEventCount(logs.value.count)
    }
    if (sess.status === "fulfilled") setPhone({ using: sess.value.totals.using_seconds, locked: sess.value.totals.locked_seconds })
    setUpdatedAt(new Date())
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 30000)
    return () => clearInterval(id)
  }, [load])

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const list = officers ?? []
  const live = list.filter((o) => o.status === "live").length
  const stale = list.filter((o) => o.status === "stale").length
  const offline = list.filter((o) => o.status === "offline").length
  const onDuty = list.filter((o) => o.onDuty).length
  const withFix = list.filter(hasFix).length

  const att = attendance ?? []
  const checkedIn = att.filter((r) => r.check_in).length
  const checkedOut = att.filter((r) => r.check_out).length
  const late = att.filter((r) => (r.status || "").toLowerCase().includes("late")).length
  const absent = att.filter((r) => (r.status || "").toLowerCase().includes("absent")).length
  const attPct = att.length ? Math.round((checkedIn / att.length) * 100) : 0

  const attention = list
    .filter((o) => (o.onDuty && o.status !== "live") || (o.batteryPct != null && o.batteryPct < 20 && o.onDuty))
    .slice(0, 5)

  const mapData = useMemo(() => buildMapData(list, null, null, `all-${withFix > 0 ? 1 : 0}`), [officers])

  const openOfficer = (userId: number) => navigation.navigate("Location", { userId, at: Date.now() })

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.gold} colors={[colors.gold]} />}
    >
      <View style={s.hero}>
        <Image source={brand.crest} style={s.watermark} resizeMode="contain" />
        <View style={s.heroAccent} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar name={displayName(user)} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={s.greet}>{greeting()}</Text>
            <Text style={s.name} numberOfLines={1}>{displayName(user) || "Admin"}</Text>
            <Text style={s.role}>{prettyRole(user?.role)} · Command overview</Text>
          </View>
        </View>
        <View style={s.heroFoot}>
          <View style={[s.liveDot, { backgroundColor: "#4ade80" }]} />
          <Text style={s.heroFootText}>
            {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            {updatedAt ? ` · updated ${formatTime(updatedAt.toISOString())}` : ""}
          </Text>
        </View>
      </View>

      <View style={s.kpiGrid}>
        <KpiTile icon="people" label="Total staff" value={officers ? list.length : null} tone={colors.primary} />
        <KpiTile icon="shield-checkmark" label="On duty" value={officers ? onDuty : null} tone={colors.gold} />
        <KpiTile icon="radio" label="Live GPS" value={officers ? live : null} tone={colors.good} />
        <KpiTile icon="log-in" label="Checked in" value={attendance ? checkedIn : null} sub={attendance ? `of ${att.length} records` : undefined} tone="#2563eb" />
        <KpiTile icon="cloud-offline" label="Not live" value={officers ? stale + offline : null} sub={officers ? `${stale} stale · ${offline} offline` : undefined} tone={colors.warn} />
        <KpiTile icon="pulse" label="Mobile events" value={eventCount} sub="today" tone="#7c3aed" />
      </View>

      <SectionCard title="Live staff map" icon="map" action="Full map" onAction={() => navigation.navigate("Location")}>
        <LiveMap data={mapData} height={280} onSelect={openOfficer} />
        <Text style={s.hint}>
          {withFix} of {list.length} officers have a GPS fix · tap a pin to open their route
        </Text>
      </SectionCard>

      <SectionCard title="Field status" icon="navigate">
        <SegmentBar
          segments={[
            { label: "Live", value: live, color: "#22c55e" },
            { label: "Stale", value: stale, color: "#f59e0b" },
            { label: "Offline", value: offline, color: "#94a3b8" },
          ]}
        />
      </SectionCard>

      <SectionCard title="Attendance today" icon="calendar" action="Details" onAction={() => navigation.navigate("Attendance")}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
          <Text style={s.bigPct}>{attPct}%</Text>
          <Text style={s.bigPctLabel}>checked in</Text>
        </View>
        <SegmentBar
          segments={[
            { label: "Checked in", value: Math.max(0, checkedIn - late), color: colors.good },
            { label: "Late", value: late, color: colors.gold },
            { label: "Absent", value: absent, color: colors.bad },
            { label: "No record", value: Math.max(0, att.length - checkedIn - absent), color: "#cbd5e1" },
          ]}
        />
        <Text style={s.hint}>{checkedOut} checked out so far</Text>
      </SectionCard>

      {phone ? (
        <SectionCard title="Phone usage today" icon="phone-portrait" action="Logs" onAction={() => navigation.navigate("Logs")}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={[s.usage, { backgroundColor: colors.goodBg }]}>
              <Text style={[s.usageLabel, { color: "#166534" }]}>In the app</Text>
              <Text style={[s.usageValue, { color: "#14532d" }]}>{formatDuration(phone.using)}</Text>
            </View>
            <View style={[s.usage, { backgroundColor: colors.chipBg }]}>
              <Text style={[s.usageLabel, { color: colors.muted }]}>Phone locked</Text>
              <Text style={s.usageValue}>{formatDuration(phone.locked)}</Text>
            </View>
          </View>
        </SectionCard>
      ) : null}

      <SectionCard title="Needs attention" icon="warning">
        {attention.length === 0 ? (
          <View style={s.allGood}>
            <Ionicons name="checkmark-circle" size={18} color={colors.good} />
            <Text style={{ color: colors.text, flex: 1 }}>Every on-duty officer is live with enough battery.</Text>
          </View>
        ) : (
          attention.map((o) => (
            <Pressable key={o.userId} style={s.personRow} onPress={() => openOfficer(o.userId)}>
              <Avatar name={o.name || o.username} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={s.personName}>{o.name || o.username}</Text>
                <Text style={s.personMeta}>
                  {[
                    o.status !== "live" ? `GPS ${o.status} · ${timeAgo(o.recordedAt)}` : null,
                    o.batteryPct != null && o.batteryPct < 20 ? `Battery ${o.batteryPct}%` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <StatusChip status={o.status} />
            </Pressable>
          ))
        )}
      </SectionCard>

      <SectionCard title="Recent activity" icon="time" action="All logs" onAction={() => navigation.navigate("Logs")}>
        {events.length === 0 ? (
          <Text style={s.hint}>No mobile activity yet today.</Text>
        ) : (
          events.map((e, i) => (
            <View key={e.id} style={s.event}>
              <View style={s.eventRail}>
                <View style={s.eventDot} />
                {i < events.length - 1 ? <View style={s.eventLine} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: 10 }}>
                <Text style={s.eventText}>
                  <Text style={{ fontWeight: "700" }}>{e.username || "Unknown"}</Text> · {e.action}
                </Text>
                <Text style={s.personMeta}>
                  {formatTime(e.time)}
                  {e.device ? ` · ${e.device}` : ""}
                </Text>
              </View>
            </View>
          ))
        )}
      </SectionCard>
    </ScrollView>
  )
}

/* ---------------------------------------------------------------- officer */

function OfficerDashboard({ user, navigation }: { user: AuthUser | null; navigation: Nav }) {
  const tracking = shouldTrackLocation(user)
  const gps = useTrackingStatus()
  const [me, setMe] = useState<GpsOfficer | null>(null)
  const [route, setRoute] = useState<RouteSummary | null>(null)
  const [myCheckIn, setMyCheckIn] = useState<string | null>(null)
  const [myCheckOut, setMyCheckOut] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const [mine, att] = await Promise.allSettled([fetchGpsMe(), fetchAttendance({ date: todayIso() })])
    if (mine.status === "fulfilled") {
      setMe(mine.value)
      const id = mine.value.userId ?? user?.id
      if (id != null) {
        try {
          setRoute(summarizeRoute(await fetchGpsHistory(id, hoursSinceLocalMidnight())))
        } catch {
          setRoute(null)
        }
      }
    }
    if (att.status === "fulfilled") {
      const uname = user?.username
      const row = att.value.find((r) => r.check_in && (!uname || r.username === uname)) ?? att.value[0]
      setMyCheckIn(row?.check_in ?? null)
      setMyCheckOut(row?.check_out ?? null)
    }
  }, [user?.id, user?.username])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 60000)
    return () => clearInterval(id)
  }, [load])

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const gpsCopy = !tracking
    ? "Location is not tracked for this account."
    : gps.error
      ? gps.error
      : gps.lastFixAt
        ? "This phone is sharing your location while you are on duty."
        : gps.running
          ? "Waiting for a GPS fix — allow Location when asked."
          : "Allow location when asked so your position can be recorded."

  const mapData = useMemo(
    () => buildMapData(me ? [me] : [], me?.userId ?? null, route, `me-${route && route.points.length ? 1 : 0}-${me && hasFix(me) ? 1 : 0}`),
    [me, route],
  )

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.gold} colors={[colors.gold]} />}
    >
      <View style={s.hero}>
        <Image source={brand.crest} style={s.watermark} resizeMode="contain" />
        <View style={s.heroAccent} />
        <Text style={s.greet}>{greeting()}</Text>
        <Text style={s.name}>{displayName(user) || "Officer"}</Text>
        <Text style={s.role}>{prettyRole(user?.role)}</Text>
        <View style={s.gpsRow}>
          <View style={[s.liveDot, { backgroundColor: gps.lastFixAt && !gps.error ? "#4ade80" : colors.goldLight }]} />
          <Text style={s.heroGps}>{gpsCopy}</Text>
        </View>
        <View style={s.statRow}>
          <HeroStat label="Today" text={me == null ? "—" : me.onDuty ? "On duty" : "Off duty"} />
          <HeroStat label="Check-in" text={myCheckIn ? formatTime(myCheckIn) : "Not in"} />
          <HeroStat label="Check-out" text={myCheckOut ? formatTime(myCheckOut) : "—"} />
        </View>
      </View>

      {tracking ? (
        <SectionCard title="My route today" icon="map" action="Details" onAction={() => navigation.navigate("Location")}>
          <LiveMap data={mapData} height={240} />
          <View style={s.routeStats}>
            <RouteStat value={route ? `${route.distanceKm.toFixed(1)} km` : "—"} label="Distance" />
            <RouteStat value={route ? formatDuration(route.movingSec) : "—"} label="Moving" />
            <RouteStat value={route ? String(route.stops.length) : "—"} label="Stops" />
          </View>
        </SectionCard>
      ) : null}

      <Text style={s.sectionHead}>Quick access</Text>
      <View style={{ gap: 12, marginTop: -4 }}>
        {[
          { to: "Location", title: "My location", desc: "Your GPS position and today's route", icon: "location-outline" as const },
          { to: "Attendance", title: "My attendance", desc: "Your check-in and check-out", icon: "calendar-outline" as const },
        ].map((l) => (
          <Pressable key={l.to} style={s.link} onPress={() => navigation.navigate(l.to)}>
            <View style={s.linkIcon}>
              <Ionicons name={l.icon} size={22} color={colors.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>{l.title}</Text>
              <Text style={s.linkDesc}>{l.desc}</Text>
            </View>
            <View style={s.chevron}>
              <Ionicons name="chevron-forward" size={16} color={colors.primary} />
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  )
}

function HeroStat({ label, text }: { label: string; text: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{text}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  )
}

function RouteStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={s.routeValue}>{value}</Text>
      <Text style={s.routeLabel}>{label}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  hero: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 18, overflow: "hidden", ...shadow },
  heroAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.gold },
  watermark: { position: "absolute", right: -40, top: 6, width: 220, height: 110, opacity: 0.08 },
  greet: { color: colors.goldLight, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 },
  name: { color: "#fff", fontSize: 22, fontWeight: "700", marginTop: 2 },
  role: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 },
  heroFoot: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)" },
  heroFootText: { color: "rgba(255,255,255,0.75)", fontSize: 12 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  gpsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8 },
  heroGps: { color: "rgba(255,255,255,0.85)", fontSize: 12, flex: 1 },
  statRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  stat: { flex: 1, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(201,162,39,0.35)", paddingVertical: 10, alignItems: "center" },
  statValue: { color: colors.goldLight, fontSize: 15, fontWeight: "700" },
  statLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 2, fontWeight: "600" },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  hint: { color: colors.muted, fontSize: 12 },
  bigPct: { fontSize: 30, fontWeight: "700", color: colors.primary, lineHeight: 34 },
  bigPctLabel: { color: colors.muted, fontWeight: "700", marginBottom: 4 },
  usage: { flex: 1, borderRadius: radius.sm, padding: 12 },
  usageLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  usageValue: { fontSize: 20, fontWeight: "700", color: colors.text, marginTop: 4 },
  allGood: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.goodBg, borderRadius: radius.sm, padding: 12 },
  personRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  personName: { fontWeight: "700", color: colors.text },
  personMeta: { color: colors.muted, fontSize: 12, marginTop: 1 },
  event: { flexDirection: "row", gap: 10 },
  eventRail: { width: 12, alignItems: "center" },
  eventDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold, marginTop: 4, borderWidth: 2, borderColor: colors.goldBg },
  eventLine: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 2 },
  eventText: { color: colors.text, fontSize: 13 },
  routeStats: { flexDirection: "row", backgroundColor: colors.navy, borderRadius: radius.sm, paddingVertical: 12 },
  routeValue: { color: colors.goldLight, fontSize: 15, fontWeight: "700" },
  routeLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 2 },
  sectionHead: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
  link: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 16, ...shadow },
  linkIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  linkTitle: { fontWeight: "700", color: colors.text, fontSize: 15 },
  linkDesc: { color: colors.muted, fontSize: 13, marginTop: 2 },
  chevron: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.chipBg, alignItems: "center", justifyContent: "center" },
})
