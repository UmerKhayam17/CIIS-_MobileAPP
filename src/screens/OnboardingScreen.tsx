import React, { useEffect, useState } from "react"
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Platform } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius } from "../theme"
import { fetchMonitorPolicy, policyAllowsCategory, policyAllowsHandset, type MonitorPolicy } from "../lib/call-api"
import { markOnboardingComplete, optInCategoriesFor, runGuidedConsent } from "../lib/onboarding"
import { CALL_RECORDING_CATEGORY, callRecordingSupported } from "../lib/call-recording-sync"

const CATEGORY_LABELS: Record<string, string> = {
  app_usage: "App usage — which apps you use and for how long during work sessions.",
  in_app_screens: "CIIS screenshots — pictures of the CIIS app's own screens only.",
  screen_share: "Screen share — only when you start it yourself.",
  android_call_history: "Call history — numbers, times and durations of calls. No call audio.",
  android_call_recording:
    "Call recordings — the audio files your phone's own dialer saves for work calls. CIIS uploads those files; it does not record calls itself.",
}

export default function OnboardingScreen({
  userId,
  onDone,
}: {
  userId: number | null
  onDone: () => void
}) {
  const [policy, setPolicy] = useState<MonitorPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    void (async () => {
      try {
        setPolicy(await fetchMonitorPolicy())
      } catch {
        setPolicy(null)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const disclosed = optInCategoriesFor(policy)
  const wantsCalls = policyAllowsHandset(policy) && Platform.OS === "android"
  const wantsRecordings = policyAllowsCategory(policy, CALL_RECORDING_CATEGORY) && callRecordingSupported()
  const activeKeys = [
    ...disclosed,
    ...(wantsCalls ? ["android_call_history"] : []),
    ...(wantsRecordings ? [CALL_RECORDING_CATEGORY] : []),
  ]

  async function accept() {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await runGuidedConsent(policy)
      await markOnboardingComplete(userId)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your acknowledgment. Try again.")
      setBusy(false)
    }
  }

  async function skip() {
    await markOnboardingComplete(userId)
    onDone()
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    )
  }

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.logo}>
          <Ionicons name="shield-checkmark" size={34} color={colors.primary} />
        </View>
        <Text style={s.title}>Monitoring & privacy</Text>
        <Text style={s.sub}>
          Please read and accept before CIIS collects anything from this phone.
        </Text>

        {policy ? (
          <View style={s.card}>
            {policy.summary ? <Text style={s.summary}>{policy.summary}</Text> : null}
            {policy.work_hours ? <Text style={s.meta}>Work hours: {policy.work_hours}</Text> : null}
            {policy.contact ? <Text style={s.meta}>Questions: {policy.contact}</Text> : null}
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.meta}>Monitoring is not set up on this deployment yet.</Text>
          </View>
        )}

        {activeKeys.length ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>By accepting, you agree to share:</Text>
            {activeKeys.map((k) => (
              <View key={k} style={s.bullet}>
                <Ionicons name="checkmark-circle" size={18} color={colors.good} />
                <Text style={s.bulletText}>{CATEGORY_LABELS[k] || k}</Text>
              </View>
            ))}
            <Text style={s.note}>
              After you accept, Android will ask you to allow call history and to turn on Usage access
              for app usage{wantsRecordings ? ", and to pick the folder your phone saves call recordings to" : ""}.
              These are one-time steps you control, and you can turn any of them off later in Settings.
            </Text>
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.meta}>
              No optional monitoring is enabled right now. You can continue; nothing extra is collected.
            </Text>
          </View>
        )}

        {error ? <Text style={s.error}>{error}</Text> : null}
      </ScrollView>

      <View style={s.footer}>
        <Pressable style={[s.primary, busy && s.disabled]} onPress={accept} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.primaryText}>{activeKeys.length ? "Accept & continue" : "Continue"}</Text>
          )}
        </Pressable>
        <Pressable style={s.secondary} onPress={skip} disabled={busy}>
          <Text style={s.secondaryText}>Not now</Text>
        </Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 24, gap: 14 },
  logo: { alignSelf: "center", marginTop: 12 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, textAlign: "center" },
  sub: { fontSize: 14, color: colors.muted, textAlign: "center", marginBottom: 4 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: colors.text, marginBottom: 4 },
  summary: { fontSize: 14, color: colors.text, lineHeight: 20 },
  meta: { fontSize: 13, color: colors.muted },
  bullet: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  bulletText: { flex: 1, fontSize: 14, color: colors.text, lineHeight: 20 },
  note: { fontSize: 12, color: colors.muted, lineHeight: 18, marginTop: 6 },
  error: { color: "#b91c1c", fontSize: 14, textAlign: "center" },
  footer: { padding: 20, gap: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card },
  primary: { backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: 15, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  disabled: { opacity: 0.6 },
  secondary: { paddingVertical: 10, alignItems: "center" },
  secondaryText: { color: colors.muted, fontWeight: "700", fontSize: 14 },
})
