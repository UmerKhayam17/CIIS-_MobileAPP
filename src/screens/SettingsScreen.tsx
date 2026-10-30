import React, { useEffect, useState } from "react"
import { View, Text, Pressable, StyleSheet, Alert, Switch, ScrollView, Platform, ActivityIndicator, Image } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { brand, colors, radius, shadow } from "../theme"
import { Avatar } from "../ui"
import { APP_VERSION } from "../config"
import { displayName, getCachedUser, shouldTrackLocation, clearAuth } from "../lib/auth"
import { prettyRole } from "../lib/format"
import { getOrCreateDeviceUuid } from "../lib/device"
import { getMobileSessionId, loadMobileSessionId, flushOfflineQueue, reportMobileEvent, endMobileSession, logoutMobileSession } from "../lib/mobile"
import { startTracking, stopTracking, useTrackingStatus } from "../lib/location"
import {
  consentCovers,
  fetchMonitorConsent,
  fetchMonitorPolicy,
  policyAllowsCategory,
  setConsentCategory,
  type MonitorPolicy,
} from "../lib/call-api"
import {
  CALL_RECORDING_CATEGORY,
  callRecordingSupported,
  recordingFolderUri,
  requestRecordingAccess,
  requestRecordingFolder,
  syncCallRecordings,
} from "../lib/call-recording-sync"
import { isOptedIn, setOptIn, type MonitorCategoryKey } from "../lib/monitor-prefs"
import { appUsageSupported, openUsageAccessSettings, syncAppUsage, usageAccessState } from "../lib/app-usage-sync"
import { captureInAppScreen } from "../lib/screen-capture"
import { beginScreenShare, endScreenShare, screenShareSupported } from "../lib/screen-share"

export default function SettingsScreen({ onSignOut }: { onSignOut: () => void }) {
  const user = getCachedUser()
  const gps = useTrackingStatus()
  const [deviceUuid, setDeviceUuid] = useState("")
  const [sessionId, setSessionId] = useState("")
  const [signingOut, setSigningOut] = useState(false)

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
    Alert.alert("Sign out?", "Are you sure you want to sign out of CIIS?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void doSignOut() },
    ])
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View style={s.profile}>
        <Image source={brand.crest} style={s.watermark} resizeMode="contain" />
        <View style={s.profileAccent} />
        <Avatar name={displayName(user)} size={60} />
        <View style={{ flex: 1 }}>
          <Text style={s.profileName}>{displayName(user)}</Text>
          <Text style={s.profileRole}>{prettyRole(user?.role)}</Text>
          <Text style={s.profileUser}>@{user?.username}</Text>
        </View>
      </View>

      <Section title="Device" icon="phone-portrait">
        <InfoRow label="Device ID" value={deviceUuid || "—"} />
        <InfoRow label="Session" value={sessionId || "—"} />
      </Section>

      <Section title="Call history" icon="call">
        <Text style={s.muted}>
          Managed on the Calls tab. CIIS does not record call audio. iPhone cellular history cannot be read.
        </Text>
      </Section>

      <MonitoringSection />

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

      <Pressable
        style={({ pressed }) => [s.signOut, (signingOut || pressed) && { opacity: 0.7 }]}
        onPress={confirmSignOut}
        disabled={signingOut}
      >
        <Ionicons name="log-out-outline" size={20} color={colors.bad} />
        <Text style={s.signOutText}>{signingOut ? "Signing out…" : "Sign out"}</Text>
      </Pressable>
      <View style={s.about}>
        <Image source={brand.crest} style={{ width: 96, height: 48 }} resizeMode="contain" />
        <Text style={s.aboutName}>{brand.fullName}</Text>
        <Text style={s.aboutMeta}>
          {brand.org} · v{APP_VERSION}
        </Text>
      </View>
    </ScrollView>
  )
}

/**
 * Employee self-service opt-in for the optional handset features. Everything here is opt-in and
 * reversible: each toggle re-posts the user's consent with the categories they have chosen, and
 * the server refuses any upload for a category that is not both published in the policy and
 * listed in the current acknowledgment. Nothing captures silently.
 */
function MonitoringSection() {
  const [policy, setPolicy] = useState<MonitorPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [opts, setOpts] = useState<Record<MonitorCategoryKey, boolean>>({
    app_usage: false,
    in_app_screens: false,
    screen_share: false,
  })
  const [busy, setBusy] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [note, setNote] = useState("")
  const [recOn, setRecOn] = useState(false)
  const [recFolder, setRecFolder] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const p = await fetchMonitorPolicy()
        setPolicy(p)
        const consent = await fetchMonitorConsent().catch(() => null)
        setRecOn(consentCovers(consent, p, CALL_RECORDING_CATEGORY))
        setRecFolder(recordingFolderUri())
      } catch {
        setPolicy(null)
      } finally {
        setOpts({
          app_usage: await isOptedIn("app_usage"),
          in_app_screens: await isOptedIn("in_app_screens"),
          screen_share: await isOptedIn("screen_share"),
        })
        setLoading(false)
      }
    })()
  }, [])

  if (loading) {
    return (
      <Section title="Monitoring & privacy" icon="shield-checkmark">
        <ActivityIndicator color={colors.gold} />
      </Section>
    )
  }
  if (!policy) {
    return (
      <Section title="Monitoring & privacy" icon="shield-checkmark">
        <Text style={s.muted}>Monitoring is not set up on this deployment.</Text>
      </Section>
    )
  }

  async function toggle(category: MonitorCategoryKey, value: boolean) {
    if (busy) return
    setBusy(true)
    setNote("")
    try {
      await setOptIn(category, value)
      await setConsentCategory(policy!, category, value)
      setOpts((prev) => ({ ...prev, [category]: value }))
      if (category === "app_usage" && value) {
        if (usageAccessState() === "denied") {
          setNote("Turn on Usage access for CIIS to let app-usage collection start.")
        } else {
          void syncAppUsage()
        }
      }
    } catch (err) {
      await setOptIn(category, !value) // roll back the local flag on failure
      setNote(err instanceof Error ? err.message : "Could not update your choice.")
    } finally {
      setBusy(false)
    }
  }

  async function toggleRecordings(value: boolean) {
    if (busy) return
    setBusy(true)
    setNote("")
    try {
      await setConsentCategory(policy!, CALL_RECORDING_CATEGORY, value)
      setRecOn(value)
      if (value) {
        const allowed = await requestRecordingAccess()
        setRecFolder(recordingFolderUri())
        if (!allowed) setNote("Allow audio access so CIIS can find this phone's call recordings.")
        else await runRecordingSync()
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not update your choice.")
    } finally {
      setBusy(false)
    }
  }

  async function chooseRecordingFolder() {
    const folder = await requestRecordingFolder()
    if (folder) {
      setRecFolder(folder)
      await runRecordingSync()
    }
  }

  async function runRecordingSync() {
    setNote("Checking for new call recordings…")
    const r = await syncCallRecordings()
    setNote(recordingSyncMessage(r.uploaded, r.skipped))
  }

  async function toggleShare() {
    if (sharing) {
      await endScreenShare()
      setSharing(false)
      return
    }
    const res = await beginScreenShare()
    if (res.ok) setSharing(true)
    else setNote(shareSkipMessage(res.skipped))
  }

  const androidUsage = appUsageSupported()
  const showScreenShare = screenShareSupported() && policyAllowsCategory(policy, "screen_share")

  return (
    <Section title="Monitoring & privacy" icon="shield-checkmark">
      <Text style={[s.muted, { marginBottom: 4 }]}>
        These are optional and off until you turn them on. You can switch any of them off at any time.
      </Text>

      {policyAllowsCategory(policy, "app_usage") ? (
        <ToggleRow
          label="App usage (Android)"
          detail={
            Platform.OS !== "android"
              ? "Not available on iPhone."
              : !androidUsage
                ? "Needs the full app (not Expo Go)."
                : "App names and time in each app during work sessions. Not the content inside apps."
          }
          value={opts.app_usage}
          disabled={busy || Platform.OS !== "android" || !androidUsage}
          onValueChange={(v) => void toggle("app_usage", v)}
        />
      ) : null}

      {opts.app_usage && androidUsage && usageAccessState() === "denied" ? (
        <Pressable style={s.secondaryBtn} onPress={() => openUsageAccessSettings()}>
          <Ionicons name="settings-outline" size={16} color={colors.primary} />
          <Text style={s.secondaryText}>Grant Usage access</Text>
        </Pressable>
      ) : null}

      {policyAllowsCategory(policy, "in_app_screens") ? (
        <ToggleRow
          label="Screenshots of the CIIS app"
          detail="Screens inside CIIS only. Never any other app on your phone."
          value={opts.in_app_screens}
          disabled={busy}
          onValueChange={(v) => void toggle("in_app_screens", v)}
        />
      ) : null}

      {opts.in_app_screens ? (
        <Pressable
          style={s.secondaryBtn}
          onPress={() =>
            void captureInAppScreen("Settings").then((r) =>
              setNote(r.ok ? "Screenshot uploaded." : shareSkipMessage(r.skipped)),
            )
          }
        >
          <Ionicons name="camera-outline" size={16} color={colors.primary} />
          <Text style={s.secondaryText}>Capture this screen now</Text>
        </Pressable>
      ) : null}

      {policyAllowsCategory(policy, "screen_share") ? (
        <ToggleRow
          label="Screen share (you start it)"
          detail={
            Platform.OS !== "android" || !screenShareSupported()
              ? "Android only, in the full app. Android shows a recording indicator the whole time."
              : "You start it; Android shows a recording indicator the whole time. Stop it anytime."
          }
          value={opts.screen_share}
          disabled={busy || Platform.OS !== "android" || !screenShareSupported()}
          onValueChange={(v) => void toggle("screen_share", v)}
        />
      ) : null}

      {opts.screen_share && showScreenShare ? (
        <Pressable style={[s.secondaryBtn, sharing && { backgroundColor: colors.badBg }]} onPress={() => void toggleShare()}>
          <Ionicons name={sharing ? "stop-circle-outline" : "tv-outline"} size={16} color={sharing ? colors.bad : colors.primary} />
          <Text style={[s.secondaryText, sharing && { color: colors.bad }]}>{sharing ? "Stop screen share" : "Start screen share"}</Text>
        </Pressable>
      ) : null}

      {policyAllowsCategory(policy, CALL_RECORDING_CATEGORY) ? (
        <ToggleRow
          label="Call recordings (Android)"
          detail={
            !callRecordingSupported()
              ? "Android only, in the full app."
              : "After you allow audio access, CIIS finds the recordings your phone's dialer already saves and uploads calls from then on. CIIS never records calls itself."
          }
          value={recOn}
          disabled={busy || !callRecordingSupported()}
          onValueChange={(v) => void toggleRecordings(v)}
        />
      ) : null}

      {recOn && callRecordingSupported() ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Pressable style={s.secondaryBtn} onPress={() => void runRecordingSync()} disabled={busy}>
            <Ionicons name="cloud-upload-outline" size={16} color={colors.primary} />
            <Text style={s.secondaryText}>Sync now</Text>
          </Pressable>
          <Pressable style={s.secondaryBtn} onPress={() => void chooseRecordingFolder()} disabled={busy}>
            <Ionicons name="folder-open-outline" size={16} color={colors.primary} />
            <Text style={s.secondaryText}>{recFolder ? "Change folder" : "Pick folder if not found"}</Text>
          </Pressable>
        </View>
      ) : null}

      {note ? (
        <View style={s.note}>
          <Ionicons name="information-circle" size={16} color={colors.primary} />
          <Text style={s.noteText}>{note}</Text>
        </View>
      ) : null}
    </Section>
  )
}

function recordingSyncMessage(uploaded: number, skipped: string): string {
  if (uploaded > 0) return `Uploaded ${uploaded} call recording${uploaded === 1 ? "" : "s"}.`
  switch (skipped) {
    case "":
      return "No new call recordings found on this phone since you turned this on. Turn on call recording in the phone dialer, then make a call."
    case "folder":
    case "permission":
      return "Allow audio access so CIIS can find this phone's call recordings."
    case "consent":
      return "Turn on Call recordings first."
    case "policy":
      return "Call recordings are not enabled in the current policy."
    case "network":
      return "Can't reach the server. Recordings will upload when you're back online."
    case "busy":
      return "A sync is already running."
    case "build":
      return "This needs the full app, not Expo Go."
    default:
      return `Recordings could not upload (${skipped}).`
  }
}

function ToggleRow({
  label,
  detail,
  value,
  disabled,
  onValueChange,
}: {
  label: string
  detail: string
  value: boolean
  disabled?: boolean
  onValueChange: (v: boolean) => void
}) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={s.toggleLabel}>{label}</Text>
        <Text style={s.toggleDetail}>{detail}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: "#cbd5e1", true: colors.primary }}
        thumbColor={value ? colors.gold : "#f8fafc"}
      />
    </View>
  )
}

function shareSkipMessage(skipped?: string): string {
  switch (skipped) {
    case "optout":
      return "Turn this on first."
    case "policy":
      return "This is not enabled in the current policy."
    case "consent":
      return "Acknowledge the monitoring policy first."
    case "build":
      return "This needs the full app, not Expo Go."
    default:
      return "Could not start right now."
  }
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={1} ellipsizeMode="middle">
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
  watermark: { position: "absolute", right: -40, top: 8, width: 200, height: 100, opacity: 0.08 },
  profileName: { color: "#fff", fontSize: 19, fontWeight: "700" },
  profileRole: { color: colors.goldLight, fontSize: 13, fontWeight: "700", marginTop: 2 },
  profileUser: { color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 2 },
  section: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 16, gap: 6, ...shadow },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  sectionIcon: { width: 24, height: 24, borderRadius: 6, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
  big: { fontSize: 17, fontWeight: "700", color: colors.text },
  muted: { color: colors.muted, lineHeight: 20 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#f0f3f8" },
  infoLabel: { color: colors.muted, fontSize: 13 },
  infoValue: { color: colors.text, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f0f3f8" },
  toggleLabel: { fontWeight: "600", color: colors.text, fontSize: 14 },
  toggleDetail: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    alignSelf: "flex-start",
    backgroundColor: colors.chipBg,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    height: 40,
  },
  secondaryText: { fontWeight: "700", color: colors.primary },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 6 },
  noteText: { flex: 1, color: colors.primary, fontWeight: "600", fontSize: 13, lineHeight: 18 },
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
