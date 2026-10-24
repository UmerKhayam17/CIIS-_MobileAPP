import React, { useCallback, useEffect, useState } from "react"
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius, shadow } from "../theme"
import { fetchDataCategories, type DataCategoryInfo } from "../lib/consent-api"
import { isUnavailable, type FeatureUnavailable } from "../lib/monitor-api"
import { ErrorBanner, Loading, UnavailableState } from "../ui"

const MEASURE: Record<string, { label: string; color: string }> = {
  measured: { label: "Measured", color: colors.good },
  estimated: { label: "Estimated", color: colors.warn },
  unavailable: { label: "Unavailable", color: colors.faint },
}

/** What data is collected, why, and for how long — the employee's own transparency view. */
export default function PrivacyScreen({ onOpenConsent }: { onOpenConsent?: () => void }) {
  const [cats, setCats] = useState<DataCategoryInfo[]>([])
  const [error, setError] = useState("")
  const [unavailable, setUnavailable] = useState<FeatureUnavailable | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { categories } = await fetchDataCategories()
      setCats(categories)
      setError("")
      setUnavailable(null)
    } catch (err) {
      setCats([])
      if (isUnavailable(err)) setUnavailable(err)
      else setError(err instanceof Error ? err.message : "Could not load data categories")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View style={s.intro}>
        <View style={s.introIcon}>
          <Ionicons name="shield-checkmark" size={20} color={colors.gold} />
        </View>
        <Text style={s.introTitle}>Your privacy</Text>
        <Text style={s.introText}>
          This is everything the app can collect for your account, what it is used for, and how long it is kept. Data comes from your
          work session and approved sources — never from reading your private messages, passwords, or personal browsing.
        </Text>
      </View>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <Loading label="Loading" /> : null}
      {unavailable ? <UnavailableState reason={unavailable.reason} feature="Data categories" /> : null}

      {!loading && !unavailable && cats.map((c) => {
        const m = c.measurement ? MEASURE[c.measurement] : null
        return (
          <View key={c.key} style={s.card}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={[s.statusDot, { backgroundColor: c.collected ? colors.good : colors.faint }]} />
              <Text style={s.catLabel}>{c.label}</Text>
              <View style={{ flex: 1 }} />
              <View style={[s.badge, { backgroundColor: c.collected ? colors.goodBg : "#f1f5f9" }]}>
                <Text style={{ color: c.collected ? "#166534" : "#64748b", fontSize: 11, fontWeight: "700" }}>
                  {c.collected ? "Collected" : "Not collected"}
                </Text>
              </View>
            </View>
            <Text style={s.purpose}>{c.purpose}</Text>
            <View style={{ flexDirection: "row", gap: 16, marginTop: 6 }}>
              {c.retention_days != null ? (
                <Meta icon="time-outline" text={`Kept ${c.retention_days} days`} />
              ) : null}
              {m ? <Meta icon="analytics-outline" text={m.label} color={m.color} /> : null}
            </View>
          </View>
        )
      })}

      <Pressable style={s.linkBtn} onPress={onOpenConsent}>
        <Ionicons name="document-text-outline" size={18} color={colors.primary} />
        <Text style={s.linkText}>View policy & consent</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.faint} />
      </Pressable>

      <Text style={s.foot}>To request withdrawal or removal of your data, use the policy screen or contact the listed administrator.</Text>
    </ScrollView>
  )
}

function Meta({ icon, text, color }: { icon: keyof typeof Ionicons.glyphMap; text: string; color?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Ionicons name={icon} size={13} color={color ?? colors.faint} />
      <Text style={{ fontSize: 12, color: color ?? colors.muted, fontWeight: "600" }}>{text}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  intro: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 16, ...shadow },
  introIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  introTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  introText: { color: colors.muted, marginTop: 6, lineHeight: 21 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 4, ...shadow },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  catLabel: { fontWeight: "700", color: colors.text, fontSize: 15 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  purpose: { color: colors.muted, fontSize: 13, marginTop: 4, lineHeight: 19 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 16, ...shadow },
  linkText: { flex: 1, fontWeight: "700", color: colors.text },
  foot: { color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 18, marginBottom: 8 },
})
