import React, { useEffect, useState } from "react"
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Platform, Image } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { brand, colors, radius, shadow } from "../theme"
import { Loading } from "../ui"
import { fetchMonitorPolicy, policyAllowsCategory, policyAllowsHandset, type MonitorPolicy } from "../lib/call-api"
import { markOnboardingComplete, optInCategoriesFor, runGuidedConsent } from "../lib/onboarding"
import { CALL_RECORDING_CATEGORY, callRecordingSupported } from "../lib/call-recording-sync"

const CATEGORY_LABELS: Record<string, string> = {
  app_usage: "App usage — which apps you use and for how long during work sessions.",
  in_app_screens: "CIIS screenshots — pictures of the CIIS app's own screens only.",
  screen_share: "Screen share — only when you start it yourself.",
  android_call_history: "Call history — numbers, times and durations of calls. No call audio.",
  android_call_recording:
    "Call recordings — the audio files your phone's own dialer saves for work calls. After you allow audio access, CIIS finds that folder itself and uploads those files. It does not record calls itself.",
}

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  app_usage: "apps-outline",
  in_app_screens: "image-outline",
  screen_share: "tv-outline",
  android_call_history: "call-outline",
  android_call_recording: "mic-outline",
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
        <Loading label="Loading policy" />
      </View>
    )
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.hero}>
          <Image source={brand.crest} style={s.watermark} resizeMode="contain" />
          <View style={s.heroAccent} />
          <Text style={s.heroTitle}>Monitoring & privacy</Text>
          <Text style={s.heroSub}>
            {brand.org} · {brand.fullName}
          </Text>
          <Text style={s.heroMeta}>Please read and accept before CIIS collects anything from this phone.</Text>
        </View>

        {policy ? (
          policy.summary || policy.work_hours || policy.contact ? (
            <View style={s.card}>
              {policy.summary ? <Text style={s.cardText}>{policy.summary}</Text> : null}
              {policy.work_hours ? <InfoLine icon="time-outline" label="Work hours" value={policy.work_hours} /> : null}
              {policy.contact ? <InfoLine icon="person-outline" label="Questions" value={policy.contact} /> : null}
            </View>
          ) : null
        ) : (
          <View style={[s.statusCard, { borderColor: colors.border, backgroundColor: colors.chipBg }]}>
            <Ionicons name="construct-outline" size={20} color={colors.muted} />
            <Text style={{ color: colors.muted, flex: 1 }}>Monitoring is not set up on this deployment yet.</Text>
          </View>
        )}

        {activeKeys.length ? (
          <View style={s.card}>
            <Text style={s.cardHead}>By accepting, you agree to share</Text>
            {activeKeys.map((k) => (
              <View key={k} style={s.line}>
                <Ionicons name={CATEGORY_ICONS[k] || "checkmark-circle-outline"} size={18} color={colors.gold} style={{ marginTop: 1 }} />
                <Text style={s.lineText}>{CATEGORY_LABELS[k] || k}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={[s.statusCard, { borderColor: "#bbf7d0", backgroundColor: colors.goodBg }]}>
            <Ionicons name="checkmark-circle" size={20} color={colors.good} />
            <Text style={{ color: "#14532d", flex: 1 }}>
              No optional monitoring is enabled right now. You can continue; nothing extra is collected.
            </Text>
          </View>
        )}

        {activeKeys.length ? (
          <Text style={s.note}>
            After you accept, Android will ask you to allow call history and to turn on Usage access
            for app usage{wantsRecordings ? ", and to allow audio access so CIIS can find this phone's call recordings" : ""}.
            These are one-time steps you control, and you can turn any of them off later in Settings.
          </Text>
        ) : null}

        {error ? (
          <View style={[s.statusCard, { borderColor: "#fecaca", backgroundColor: colors.badBg }]}>
            <Ionicons name="alert-circle" size={20} color={colors.bad} />
            <Text style={{ color: "#991b1b", flex: 1 }}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={s.footer}>
        <Pressable style={[s.primary, busy && s.disabled]} onPress={accept} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.navy} />
          ) : (
            <>
              <Ionicons name="checkmark" size={18} color={colors.navy} />
              <Text style={s.primaryText}>{activeKeys.length ? "Accept & continue" : "Continue"}</Text>
            </>
          )}
        </Pressable>
        <Pressable style={[s.secondary, busy && s.disabled]} onPress={skip} disabled={busy}>
          <Text style={s.secondaryText}>Not now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

function InfoLine({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 2 }}>
      <Ionicons name={icon} size={16} color={colors.gold} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={s.infoLabel}>{label}</Text>
        <Text style={s.infoValue}>{value}</Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: "center", backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 24, gap: 14 },
  hero: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 18, overflow: "hidden", ...shadow },
  heroAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.gold },
  watermark: { position: "absolute", right: -40, top: 8, width: 200, height: 100, opacity: 0.08 },
  heroTitle: { color: "#fff", fontSize: 22, fontWeight: "700" },
  heroSub: { color: colors.goldLight, fontSize: 12, fontWeight: "700", marginTop: 2 },
  heroMeta: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 8, lineHeight: 19 },
  statusCard: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: radius.md, padding: 14 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10, ...shadow },
  cardHead: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
  cardText: { color: colors.text, lineHeight: 21 },
  infoLabel: { color: colors.muted, fontSize: 12 },
  infoValue: { color: colors.text, fontWeight: "600", marginTop: 1 },
  line: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 3 },
  lineText: { flex: 1, color: colors.text, lineHeight: 20 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 19, paddingHorizontal: 4 },
  footer: { padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    height: 52,
  },
  primaryText: { color: colors.navy, fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.6 },
  secondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    height: 48,
  },
  secondaryText: { color: colors.muted, fontWeight: "700", fontSize: 15 },
})
