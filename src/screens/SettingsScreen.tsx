import React, { useEffect, useState } from "react"
import { View, Text, Pressable, ScrollView, Image, StyleSheet, Alert, Platform } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius, shadow, brand } from "../theme"
import { Avatar } from "../ui"
import { APP_VERSION } from "../config"
import { displayName, getCachedUser, shouldTrackLocation, clearAuth } from "../lib/auth"
import { prettyRole } from "../lib/format"
import { getOrCreateDeviceUuid, deviceDetails } from "../lib/device"
import { getMobileSessionId, loadMobileSessionId, flushOfflineQueue, reportMobileEvent, endMobileSession, logoutMobileSession } from "../lib/mobile"
import { startTracking, stopTracking, useTrackingStatus } from "../lib/location"
import ConsentScreen from "./ConsentScreen"
import PrivacyScreen from "./PrivacyScreen"

type SubView = "main" | "consent" | "privacy"

export default function SettingsScreen({ onSignOut }: { onSignOut: () => void }) {
  const user = getCachedUser()
  const gps = useTrackingStatus()
  const [deviceUuid, setDeviceUuid] = useState("")
  const [sessionId, setSessionId] = useState("")
  const [signingOut, setSigningOut] = useState(false)
  const [view, setView] = useState<SubView>("main")
  const device = deviceDetails()

  useEffect(() => {
    void getOrCreateDeviceUuid().then(setDeviceUuid)
    void loadMobileSessionId().then(() => setSessionId(getMobileSessionId()))
  }, [])

  const label =
    !shouldTrackLocation(user)
      ? { title: "Not required", detail: "This role does not share live GPS." }
      : gps.lifecycle === "GPS_PERMISSION_DENIED"
        ? { title: "Disabled", detail: "Location permission is required for field-duty tracking." }
        : gps.lifecycle === "GPS_OFFLINE"
          ? { title: "Offline", detail: "Points are saved on this phone and upload when online." }
          : gps.running && gps.lastFixAt && Date.now() - gps.lastFixAt < 120000
            ? { title: "Active", detail: gps.background ? "Sharing in the background." : "Sharing while the app is open." }
            : { title: "Paused", detail: "GPS resumes while the app is allowed to use Location." }
  const tone = label.title === "Active" ? colors.good : label.title === "Disabled" ? colors.warn : colors.faint

  async function doSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await flushOfflineQueue()
      await Promise.allSettled([
        stopTracking({ endDuty: shouldTrackLocation(user) }),
        reportMobileEvent("logout"),
        endMobileSession(),
      ])
      await logoutMobileSession()
    } finally {
      await clearAuth()
      setSigningOut(false)
      onSignOut()
    }
  }

  function confirmSignOut() {
    // Alert.alert has no buttons on react-native-web, so fall back to the browser's confirm.
    if (Platform.OS === "web") {
      if (window.confirm("Are you sure you want to sign out of CIIS?")) void doSignOut()
      return
    }
    Alert.alert("Sign out?", "Are you sure you want to sign out of CIIS?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void doSignOut() },
    ])
  }

  if (view !== "main") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Pressable style={s.backBar} onPress={() => setView("main")}>
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
          <Text style={s.backText}>{view === "consent" ? "Monitoring policy" : "Privacy"}</Text>
        </Pressable>
        {view === "consent" ? <ConsentScreen /> : <PrivacyScreen onOpenConsent={() => setView("consent")} />}
      </View>
    )
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View style={s.profile}>
        <View style={s.profileAccent} />
        <Avatar name={displayName(user)} size={60} />
        <View style={{ flex: 1 }}>
          <Text style={s.profileName}>{displayName(user)}</Text>
          <Text style={s.profileRole}>{prettyRole(user?.role)}</Text>
          <Text style={s.profileUser}>@{user?.username}</Text>
        </View>
      </View>

      <Section title="GPS" icon="navigate">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tone }} />
          <Text style={s.big}>{label.title}</Text>
        </View>
        <Text style={s.muted}>{label.detail}</Text>
        {shouldTrackLocation(user) ? (
          <Pressable style={s.secondaryBtn} onPress={() => void startTracking()}>
            <Ionicons name="refresh" size={16} color={colors.primary} />
            <Text style={s.secondaryText}>Refresh GPS</Text>
          </Pressable>
        ) : null}
      </Section>

      <Section title="Privacy & monitoring" icon="shield-checkmark">
        <NavRow icon="document-text-outline" label="Monitoring policy & consent" onPress={() => setView("consent")} />
        <NavRow icon="eye-outline" label="What data is collected" onPress={() => setView("privacy")} />
      </Section>

      <Section title="Device" icon="phone-portrait">
        <Row label="Model" value={device.model} />
        <Row label="Manufacturer" value={device.manufacturer} />
        <Row label="OS" value={device.os} />
        <Row label="Device ID" value={deviceUuid || "—"} />
        <Row label="Session" value={sessionId || "—"} />
        <Text style={s.deviceNote}>
          Phones no longer let apps read the Wi-Fi MAC address, so the Device ID above is used to
          identify this device.
        </Text>
      </Section>

      <Pressable style={[s.signOut, signingOut && { opacity: 0.6 }]} onPress={confirmSignOut} disabled={signingOut}>
        <Ionicons name="log-out-outline" size={20} color={colors.bad} />
        <Text style={s.signOutText}>{signingOut ? "Signing out…" : "Sign out"}</Text>
      </Pressable>

      <View style={s.about}>
        <Image source={brand.crest} style={{ width: 96, height: 48 }} resizeMode="contain" />
        <Text style={s.aboutName}>{brand.fullName}</Text>
        <Text style={s.aboutMeta}>{brand.org} · v{APP_VERSION}</Text>
      </View>
    </ScrollView>
  )
}

function Section({ title, icon, children }: { title: string; icon: keyof typeof Ionicons.glyphMap; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <View style={s.sectionIcon}>
          <Ionicons name={icon} size={14} color={colors.gold} />
        </View>
        <Text style={s.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  )
}

function NavRow({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable style={s.navRow} onPress={onPress}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={s.navLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.faint} />
    </Pressable>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={1} ellipsizeMode="middle">
        {value}
      </Text>
    </View>
  )
}

const s = StyleSheet.create({
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.navy,
    borderRadius: radius.lg,
    padding: 18,
    overflow: "hidden",
    ...shadow,
  },
  profileAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.gold },
  profileName: { color: "#fff", fontSize: 19, fontWeight: "700" },
  profileRole: { color: colors.goldLight, fontSize: 13, fontWeight: "700", marginTop: 2 },
  profileUser: { color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 2 },
  section: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 16, gap: 6, ...shadow },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  sectionIcon: { width: 24, height: 24, borderRadius: 6, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
  big: { fontSize: 17, fontWeight: "700", color: colors.text },
  muted: { color: colors.muted },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#f0f3f8" },
  navRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f0f3f8" },
  navLabel: { flex: 1, color: colors.text, fontWeight: "600", fontSize: 14 },
  backBar: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  backText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
  rowLabel: { color: colors.muted, fontSize: 13 },
  rowValue: { color: colors.text, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  deviceNote: { color: colors.faint, fontSize: 11, lineHeight: 16, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#f0f3f8" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: colors.chipBg,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    height: 40,
  },
  secondaryText: { fontWeight: "700", color: colors.primary },
  signOut: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: radius.md,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  signOutText: { color: colors.bad, fontWeight: "700", fontSize: 16 },
  about: { alignItems: "center", paddingVertical: 16, gap: 4 },
  aboutName: { color: colors.text, fontSize: 12, fontWeight: "700", marginTop: 6 },
  aboutMeta: { color: colors.faint, fontSize: 11 },
})
