import React, { useCallback, useEffect, useState } from "react"
import { View, Text, ScrollView, Pressable, Image, StyleSheet, Alert, Platform } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius, shadow, brand } from "../theme"
import { fetchCurrentPolicy, fetchCurrentConsent, submitConsent, type MonitoringPolicy, type ConsentState } from "../lib/consent-api"
import { isUnavailable, type FeatureUnavailable } from "../lib/monitor-api"
import { formatDateTime } from "../lib/format"
import { ErrorBanner, Loading, UnavailableState } from "../ui"

/**
 * Policy disclosure + acknowledgment. This records that the employee was shown the monitoring
 * policy and agreed to it; it is separate from the OS permission prompts, and it can be withdrawn.
 */
export default function ConsentScreen({ onDone }: { onDone?: () => void }) {
  const [policy, setPolicy] = useState<MonitoringPolicy | null>(null)
  const [consent, setConsent] = useState<ConsentState | null>(null)
  const [error, setError] = useState("")
  const [unavailable, setUnavailable] = useState<FeatureUnavailable | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, c] = await Promise.all([fetchCurrentPolicy(), fetchCurrentConsent().catch(() => null)])
      setPolicy(p)
      setConsent(c)
      setError("")
      setUnavailable(null)
    } catch (err) {
      if (isUnavailable(err)) setUnavailable(err)
      else setError(err instanceof Error ? err.message : "Could not load the monitoring policy")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function act(action: "acknowledge" | "withdraw") {
    if (!policy || saving) return
    setSaving(true)
    try {
      const next = await submitConsent({
        policy_id: policy.policy_id,
        action,
        disclosed_categories: policy.categories.map((c) => c.key),
      })
      setConsent(next)
      if (action === "acknowledge") onDone?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save your choice"
      if (Platform.OS === "web") window.alert(msg)
      else Alert.alert("Consent", msg)
    } finally {
      setSaving(false)
    }
  }

  function confirmWithdraw() {
    const msg = "Withdraw consent? The organization's configured response will apply, which may pause tracking for this account."
    if (Platform.OS === "web") {
      if (window.confirm(msg)) void act("withdraw")
      return
    }
    Alert.alert("Withdraw consent?", msg, [
      { text: "Cancel", style: "cancel" },
      { text: "Withdraw", style: "destructive", onPress: () => void act("withdraw") },
    ])
  }

  if (loading) return <View style={s.center}><Loading label="Loading policy" /></View>
  if (unavailable) return <View style={s.center}><UnavailableState reason={unavailable.reason} feature="The monitoring policy" /></View>

  const acknowledged = consent?.status === "acknowledged" && consent.policy_version === policy?.policy_version

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View style={s.hero}>
        <Image source={brand.crest} style={s.watermark} resizeMode="contain" />
        <View style={s.heroAccent} />
        <Text style={s.heroTitle}>Monitoring policy</Text>
        <Text style={s.heroSub}>{brand.org} · {brand.fullName}</Text>
        {policy ? <Text style={s.heroMeta}>Version {policy.policy_version} · effective {formatDateTime(policy.effective_at)}</Text> : null}
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      {acknowledged ? (
        <View style={[s.statusCard, { borderColor: "#bbf7d0", backgroundColor: colors.goodBg }]}>
          <Ionicons name="checkmark-circle" size={20} color={colors.good} />
          <Text style={{ color: "#14532d", flex: 1 }}>
            You acknowledged this policy{consent?.effective_at ? ` on ${formatDateTime(consent.effective_at)}` : ""}.
          </Text>
        </View>
      ) : consent?.status === "withdrawn" ? (
        <View style={[s.statusCard, { borderColor: "#fecaca", backgroundColor: colors.badBg }]}>
          <Ionicons name="hand-left" size={20} color={colors.bad} />
          <Text style={{ color: "#991b1b", flex: 1 }}>You have withdrawn consent. Review the policy below to acknowledge again.</Text>
        </View>
      ) : null}

      {policy?.summary ? (
        <View style={s.card}>
          <Text style={s.cardText}>{policy.summary}</Text>
        </View>
      ) : null}

      <View style={s.card}>
        <Text style={s.cardHead}>What is collected</Text>
        {policy?.categories.map((c) => (
          <View key={c.key} style={s.catRow}>
            <View style={s.catDot} />
            <View style={{ flex: 1 }}>
              <Text style={s.catLabel}>{c.label}</Text>
              <Text style={s.catDesc}>{c.description}</Text>
              {c.retention_days != null ? <Text style={s.catRetention}>Kept for {c.retention_days} days</Text> : null}
            </View>
          </View>
        ))}
      </View>

      {policy?.work_hours || policy?.contact ? (
        <View style={s.card}>
          {policy.work_hours ? <InfoLine icon="time-outline" label="Collected during" value={policy.work_hours} /> : null}
          {policy.contact ? <InfoLine icon="person-outline" label="Questions / data requests" value={policy.contact} /> : null}
        </View>
      ) : null}

      {!acknowledged ? (
        <Pressable style={[s.primary, saving && { opacity: 0.6 }]} onPress={() => void act("acknowledge")} disabled={saving}>
          <Ionicons name="checkmark" size={18} color={colors.navy} />
          <Text style={s.primaryText}>{saving ? "Saving…" : "I acknowledge this policy"}</Text>
        </Pressable>
      ) : (
        <Pressable style={[s.secondary, saving && { opacity: 0.6 }]} onPress={confirmWithdraw} disabled={saving}>
          <Ionicons name="hand-left-outline" size={18} color={colors.bad} />
          <Text style={s.secondaryText}>Withdraw consent</Text>
        </Pressable>
      )}

      <Text style={s.foot}>Acknowledging this policy is separate from the location and notification permissions your phone asks for.</Text>
    </ScrollView>
  )
}

function InfoLine({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 4 }}>
      <Ionicons name={icon} size={16} color={colors.gold} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={s.infoLabel}>{label}</Text>
        <Text style={s.infoValue}>{value}</Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: "center" },
  hero: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 18, overflow: "hidden", ...shadow },
  heroAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.gold },
  watermark: { position: "absolute", right: -40, top: 8, width: 200, height: 100, opacity: 0.08 },
  heroTitle: { color: "#fff", fontSize: 22, fontWeight: "700" },
  heroSub: { color: colors.goldLight, fontSize: 12, fontWeight: "700", marginTop: 2 },
  heroMeta: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 8 },
  statusCard: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: radius.md, padding: 14 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10, ...shadow },
  cardHead: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
  cardText: { color: colors.text, lineHeight: 21 },
  catRow: { flexDirection: "row", gap: 10 },
  catDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold, marginTop: 6 },
  catLabel: { fontWeight: "700", color: colors.text },
  catDesc: { color: colors.muted, fontSize: 13, marginTop: 2, lineHeight: 19 },
  catRetention: { color: colors.faint, fontSize: 12, marginTop: 3 },
  infoLabel: { color: colors.muted, fontSize: 12 },
  infoValue: { color: colors.text, fontWeight: "600", marginTop: 1 },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.gold, borderRadius: radius.md, height: 52 },
  primaryText: { color: colors.navy, fontWeight: "700", fontSize: 16 },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: "#fecaca", borderRadius: radius.md, height: 52 },
  secondaryText: { color: colors.bad, fontWeight: "700", fontSize: 16 },
  foot: { color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 18, marginBottom: 8 },
})
