import React from "react"
import { View, Text, ActivityIndicator, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius } from "./theme"

export function Avatar({ name, size = 44 }: { name: string | null | undefined; size?: number }) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean)
  const text =
    parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0] ? parts[0].slice(0, 2).toUpperCase() : "?"
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "#dbeafe",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: colors.primary, fontWeight: "700", fontSize: size * 0.34 }}>{text}</Text>
    </View>
  )
}

export function StatusChip({ status }: { status: string }) {
  const style =
    status === "live"
      ? { bg: colors.goodBg, fg: "#166534" }
      : status === "stale"
        ? { bg: colors.warnBg, fg: "#92400e" }
        : { bg: "#f1f5f9", fg: "#334155" }
  return (
    <View style={[s.chip, { backgroundColor: style.bg }]}>
      <Text style={{ color: style.fg, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>{status}</Text>
    </View>
  )
}

export function EmptyState({ icon, title, description }: { icon: keyof typeof Ionicons.glyphMap; title: string; description: string }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 48, paddingHorizontal: 24 }}>
      <View style={s.emptyIcon}>
        <Ionicons name={icon} size={28} color={colors.primary} />
      </View>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>{title}</Text>
      <Text style={{ marginTop: 6, color: colors.muted, textAlign: "center" }}>{description}</Text>
    </View>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={s.errorBanner}>
      <Text style={{ color: "#92400e" }}>{message}</Text>
    </View>
  )
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 40 }}>
      <ActivityIndicator color={colors.primary} />
      {label ? <Text style={{ marginTop: 10, color: colors.muted }}>{label}</Text> : null}
    </View>
  )
}

const s = StyleSheet.create({
  chip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.chipBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  errorBanner: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: colors.warnBg,
    padding: 14,
  },
})
