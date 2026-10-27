import React, { useEffect, useState } from "react"
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius } from "../theme"
import { getCachedUser, canViewAllStaff, displayName, shouldTrackLocation } from "../lib/auth"
import { fetchGpsLive, fetchGpsMe } from "../lib/gps-api"
import { fetchAttendance } from "../lib/attendance-api"
import { fetchActivityLogs } from "../lib/logs-api"
import { greeting, todayIso, formatTime } from "../lib/format"
import { useTrackingStatus } from "../lib/location"

export default function HomeScreen({ navigation }: { navigation: any }) {
  const user = getCachedUser()
  const overview = canViewAllStaff(user)
  const tracking = shouldTrackLocation(user)
  const gps = useTrackingStatus()
  const [onDuty, setOnDuty] = useState<number | null>(null)
  const [liveGps, setLiveGps] = useState<number | null>(null)
  const [logCount, setLogCount] = useState<number | null>(null)
  const [present, setPresent] = useState<number | null>(null)
  const [myOnDuty, setMyOnDuty] = useState<boolean | null>(null)
  const [myCheckIn, setMyCheckIn] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (overview) {
      void Promise.allSettled([
        fetchGpsLive(undefined, true),
        fetchActivityLogs({ page: 1, page_size: 1, source: "mobile", date: todayIso() }),
        fetchAttendance({ date: todayIso() }),
      ]).then(([g, logs, att]) => {
        if (cancelled) return
        if (g.status === "fulfilled") {
          setOnDuty(g.value.filter((o) => o.onDuty).length)
          setLiveGps(g.value.filter((o) => o.status === "live" && o.hasFix !== false && o.latitude != null).length)
        }
        if (logs.status === "fulfilled") setLogCount(logs.value.count)
        if (att.status === "fulfilled") setPresent(att.value.filter((r) => r.check_in).length)
      })
    } else {
      void Promise.allSettled([fetchGpsMe(), fetchAttendance({ date: todayIso() })]).then(([me, att]) => {
        if (cancelled) return
        if (me.status === "fulfilled") setMyOnDuty(me.value.onDuty)
        if (att.status === "fulfilled") {
          const uname = user?.username
          const mine = att.value.find((r) => r.check_in && (!uname || r.username === uname)) ?? att.value[0]
          setMyCheckIn(mine?.check_in ?? null)
        }
      })
    }
    return () => {
      cancelled = true
    }
  }, [overview])

  const gpsCopy = !tracking
    ? "Location is not tracked for this account."
    : gps.error
      ? gps.error
      : gps.lastFixAt
        ? "This phone is sharing your location while you are on duty."
        : gps.running
          ? "Waiting for a GPS fix — allow Location when asked."
          : "Allow location when asked so your position can be recorded."

  const links = overview
    ? [
        { to: "Logs", title: "Mobile logs", desc: "Time in the app vs away on staff phones", icon: "list-outline" as const },
        { to: "Location", title: "Staff location", desc: "Live GPS for every officer you supervise", icon: "location-outline" as const },
        { to: "Attendance", title: "Staff attendance", desc: "Check-in and check-out for all employees", icon: "document-text-outline" as const },
        { to: "Calls", title: "Call history", desc: "Android work-phone calls and company phone-system calls", icon: "call-outline" as const },
      ]
    : [
        { to: "Location", title: "My location", desc: "Your GPS position and today's route", icon: "location-outline" as const },
        { to: "Attendance", title: "My attendance", desc: "Your check-in and check-out", icon: "document-text-outline" as const },
        { to: "Calls", title: "Call history", desc: "Calls uploaded from this phone or the company phone system", icon: "call-outline" as const },
      ]

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 18 }}>
      <View style={s.hero}>
        <Text style={s.greet}>{greeting()}</Text>
        <Text style={s.name}>{displayName(user) || "Officer"}</Text>
        <Text style={s.heroSub}>
          {overview
            ? "You can see every officer's location and attendance for your station."
            : "You can see your own location and attendance on this phone."}
        </Text>
        <Text style={s.heroGps}>{gpsCopy}</Text>
        <View style={s.statRow}>
          {overview ? (
            <>
              <Stat label="On duty" value={onDuty} />
              <Stat label="Live GPS" value={liveGps} />
              <Stat label="Checked in" value={present} />
            </>
          ) : (
            <>
              <Stat label="Today" text={myOnDuty == null ? "—" : myOnDuty ? "On duty" : "Off duty"} />
              <Stat label="Check-in" text={myCheckIn ? formatTime(myCheckIn) : "Not in"} />
            </>
          )}
        </View>
      </View>

      {overview && logCount != null ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>Staff overview · {logCount} mobile events today</Text>
      ) : null}

      <View style={{ gap: 12 }}>
        {links.map((l) => (
          <Pressable key={l.to} style={s.link} onPress={() => navigation.navigate(l.to)}>
            <View style={s.linkIcon}>
              <Ionicons name={l.icon} size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.linkTitle}>{l.title}</Text>
              <Text style={s.linkDesc}>{l.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.faint} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  )
}

function Stat({ label, value, text }: { label: string; value?: number | null; text?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{text ?? (value == null ? "—" : value)}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  hero: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 20 },
  greet: { color: "#93c5fd", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  name: { color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 2 },
  heroSub: { color: "rgba(255,255,255,0.75)", marginTop: 6 },
  heroGps: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 8 },
  statRow: { flexDirection: "row", gap: 8, marginTop: 18 },
  stat: { flex: 1, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  statValue: { color: "#fff", fontSize: 18, fontWeight: "800" },
  statLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 2 },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  linkIcon: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.chipBg, alignItems: "center", justifyContent: "center" },
  linkTitle: { fontWeight: "700", color: colors.text, fontSize: 15 },
  linkDesc: { color: colors.muted, fontSize: 13, marginTop: 2 },
})
