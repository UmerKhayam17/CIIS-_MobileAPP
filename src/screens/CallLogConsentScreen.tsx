import React, { useState } from "react"
import { View, Text, ScrollView, Pressable, Image, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius, shadow, brand } from "../theme"
import { ensureCallLogPermission, setCallLogConsent, syncCallLog } from "../lib/call-log"

/**
 * One-time, plain-language disclosure shown to field staff before any call-log collection.
 * Agreeing records the on-device acknowledgement, asks for the READ_CALL_LOG permission, and
 * kicks off the first sync. Declining collects nothing; the person can revisit this later.
 */
export default function CallLogConsentScreen({ onDone }: { onDone: () => void }) {
  const [saving, setSaving] = useState(false)

  async function agree() {
    if (saving) return
    setSaving(true)
    try {
      const granted = await ensureCallLogPermission()
      // Record the acknowledgement either way; sync itself won't run without the permission.
      await setCallLogConsent(granted ? "granted" : "declined")
      if (granted) void syncCallLog()
    } finally {
      setSaving(false)
      onDone()
    }
  }

  async function decline() {
    if (saving) return
    setSaving(true)
    await setCallLogConsent("declined")
    setSaving(false)
    onDone()
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={s.hero}>
          <Image source={brand.crest} style={s.watermark} resizeMode="contain" />
          <View style={s.heroAccent} />
          <Text style={s.heroTitle}>Call records</Text>
          <Text style={s.heroSub}>{brand.org} · {brand.fullName}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardText}>
            While you are on duty, CIIS records this phone&apos;s call log and sends it to CIIS
            administration so your calls appear on the duty dashboard.
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardHead}>What is collected</Text>
          <Line icon="call-outline" text="Phone numbers you called or were called by" />
          <Line icon="swap-vertical-outline" text="Direction — incoming, outgoing or missed" />
          <Line icon="time-outline" text="Date, time and length of each call" />
        </View>

        <View style={[s.card, { gap: 8 }]}>
          <Text style={s.cardHead}>What is not collected</Text>
          <Line icon="mic-off-outline" text="Call audio is never recorded or listened to" />
          <Line icon="chatbubble-ellipses-outline" text="Message contents are not collected here" />
        </View>

        <Text style={s.note}>
          This applies to all calls on this phone, including personal ones, while you are signed in.
          You can decline, and you can change this later from your profile.
        </Text>

        <Pressable style={[s.primary, saving && { opacity: 0.6 }]} onPress={() => void agree()} disabled={saving}>
          <Ionicons name="checkmark" size={18} color={colors.navy} />
          <Text style={s.primaryText}>{saving ? "Saving…" : "I understand and agree"}</Text>
        </Pressable>
        <Pressable style={[s.secondary, saving && { opacity: 0.6 }]} onPress={() => void decline()} disabled={saving}>
          <Text style={s.secondaryText}>Not now</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

function Line({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 3 }}>
      <Ionicons name={icon} size={18} color={colors.gold} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, color: colors.text, lineHeight: 20 }}>{text}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  hero: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 18, overflow: "hidden", ...shadow },
  heroAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.gold },
  watermark: { position: "absolute", right: -40, top: 8, width: 200, height: 100, opacity: 0.08 },
  heroTitle: { color: "#fff", fontSize: 22, fontWeight: "700" },
  heroSub: { color: colors.goldLight, fontSize: 12, fontWeight: "700", marginTop: 2 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10, ...shadow },
  cardHead: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
  cardText: { color: colors.text, lineHeight: 21 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 19, paddingHorizontal: 4 },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.gold, borderRadius: radius.md, height: 52 },
  primaryText: { color: colors.navy, fontWeight: "700", fontSize: 16 },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, height: 48 },
  secondaryText: { color: colors.muted, fontWeight: "700", fontSize: 15 },
})
