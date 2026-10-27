import React, { useEffect, useState } from "react"
import { View, Text, Pressable, StyleSheet, Alert, Switch, ScrollView, Platform, ActivityIndicator } from "react-native"
import { colors, radius } from "../theme"
import { displayName, getCachedUser, shouldTrackLocation, clearAuth } from "../lib/auth"
import { prettyRole } from "../lib/format"
import { getOrCreateDeviceUuid } from "../lib/device"
import { getMobileSessionId, loadMobileSessionId, flushOfflineQueue, reportMobileEvent, endMobileSession, logoutMobileSession } from "../lib/mobile"
import { startTracking, stopTracking, useTrackingStatus } from "../lib/location"
import {
  fetchMonitorPolicy,
  policyAllowsCategory,
  postMonitorConsent,
  type MonitorPolicy,
} from "../lib/call-api"
import { isOptedIn, optedInCategories, setOptIn, type MonitorCategoryKey } from "../lib/monitor-prefs"
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
      <Section title="Account">
        <Text style={s.big}>{displayName(user)}</Text>
        <Text style={s.muted}>{prettyRole(user?.role)}</Text>
        <Text style={s.muted}>{user?.username}</Text>
      </Section>

      <Section title="Device">
        <Text style={s.mono}>UUID {deviceUuid}</Text>
        <Text style={s.muted}>Session {sessionId || "—"}</Text>
      </Section>

      <Section title="Call history">
        <Text style={s.muted}>
          Managed on the Calls tab. CIIS does not record call audio. iPhone cellular history cannot be read.
        </Text>
      </Section>

      <MonitoringSection />

      <Section title="GPS">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tone }} />
          <Text style={s.big}>{label.title}</Text>
        </View>
        <Text style={s.muted}>{label.detail}</Text>
        {shouldTrackLocation(user) ? (
          <Pressable style={s.secondaryBtn} onPress={() => void startTracking()}>
            <Text style={s.secondaryText}>Refresh GPS</Text>
          </Pressable>
        ) : null}
      </Section>

      <Pressable style={[s.signOut, signingOut && { opacity: 0.6 }]} onPress={confirmSignOut} disabled={signingOut}>
        <Text style={s.signOutText}>{signingOut ? "Signing out…" : "Sign out"}</Text>
      </Pressable>
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

  useEffect(() => {
    void (async () => {
      try {
        const p = await fetchMonitorPolicy()
        setPolicy(p)
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
      <Section title="Monitoring & privacy">
        <ActivityIndicator color={colors.primary} />
      </Section>
    )
  }
  if (!policy) {
    return (
      <Section title="Monitoring & privacy">
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
      const cats = await optedInCategories()
      // Latest consent row wins; re-send the full set the employee has chosen.
      await postMonitorConsent(policy!.policy_id, cats.length ? "acknowledge" : "withdraw", cats)
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
    <Section title="Monitoring & privacy">
      <Text style={s.muted}>
        These are optional and off until you turn them on. You can switch any of them off at any time.
      </Text>

      {policyAllowsCategory(policy, "app_usage") ? (
        <Row
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
          <Text style={s.secondaryText}>Grant Usage access</Text>
        </Pressable>
      ) : null}

      {policyAllowsCategory(policy, "in_app_screens") ? (
        <Row
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
          <Text style={s.secondaryText}>Capture this screen now</Text>
        </Pressable>
      ) : null}

      {policyAllowsCategory(policy, "screen_share") ? (
        <Row
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
        <Pressable style={[s.secondaryBtn, sharing && { backgroundColor: "#fee2e2" }]} onPress={() => void toggleShare()}>
          <Text style={s.secondaryText}>{sharing ? "Stop screen share" : "Start screen share"}</Text>
        </Pressable>
      ) : null}

      {note ? <Text style={[s.muted, { color: colors.primary }]}>{note}</Text> : null}
    </Section>
  )
}

function Row({
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
        <Text style={{ fontWeight: "700", color: colors.text }}>{label}</Text>
        <Text style={s.muted}>{detail}</Text>
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onValueChange} />
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

const s = StyleSheet.create({
  section: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 16, gap: 4 },
  sectionTitle: { fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", marginBottom: 4 },
  big: { fontSize: 17, fontWeight: "800", color: colors.text },
  muted: { color: colors.muted },
  mono: { color: colors.text, fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  secondaryBtn: { marginTop: 10, alignSelf: "flex-start", backgroundColor: "#f1f5f9", borderRadius: radius.sm, paddingHorizontal: 16, height: 40, justifyContent: "center" },
  secondaryText: { fontWeight: "700", color: colors.text },
  signOut: { backgroundColor: colors.primary, borderRadius: radius.md, height: 50, alignItems: "center", justifyContent: "center", marginTop: 6 },
  signOutText: { color: "#fff", fontWeight: "700", fontSize: 16 },
})
