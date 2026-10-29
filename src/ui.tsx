import React from "react"
import { View, Text, ActivityIndicator, Image, Pressable, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius, shadow, brand } from "./theme"

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
        backgroundColor: colors.primary,
        borderWidth: 2,
        borderColor: colors.goldLight,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.34 }}>{text}</Text>
    </View>
  )
}

/** Crest-and-wordmark lockup for headers. */
export function HeaderBrand({ title }: { title: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Image source={brand.crest} style={{ width: 64, height: 32 }} resizeMode="contain" />
      <View style={s.headerDivider} />
      <View>
        <Text style={s.headerTitle}>{title}</Text>
        <Text style={s.headerSub}>{brand.name} · {brand.org}</Text>
      </View>
    </View>
  )
}

export function ScreenTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={s.titleBar} />
        <Text style={s.h1}>{title}</Text>
      </View>
      {subtitle ? <Text style={s.sub}>{subtitle}</Text> : null}
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
        <Ionicons name={icon} size={28} color={colors.gold} />
      </View>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>{title}</Text>
      <Text style={{ marginTop: 6, color: colors.muted, textAlign: "center" }}>{description}</Text>
    </View>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={s.errorBanner}>
      <Ionicons name="alert-circle" size={18} color="#92400e" />
      <Text style={{ color: "#92400e", flex: 1 }}>{message}</Text>
    </View>
  )
}

/** Honest "this isn't wired up / allowed here" panel — used by the monitoring screens. */
export function UnavailableState({
  reason,
  feature,
}: {
  reason: "disabled" | "offline" | "forbidden"
  feature: string
}) {
  const copy =
    reason === "offline"
      ? { icon: "cloud-offline-outline" as const, title: "You're offline", desc: `${feature} will load once this phone is back online.` }
      : reason === "forbidden"
        ? { icon: "lock-closed-outline" as const, title: "Not available to your account", desc: `Your role can't view ${feature.toLowerCase()} on this deployment.` }
        : { icon: "construct-outline" as const, title: "Not set up yet", desc: `${feature} needs the monitoring module and an approved source configured on the server. Nothing is captured from the phone itself.` }
  return (
    <View style={{ alignItems: "center", paddingVertical: 44, paddingHorizontal: 24 }}>
      <View style={s.emptyIcon}>
        <Ionicons name={copy.icon} size={28} color={colors.gold} />
      </View>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>{copy.title}</Text>
      <Text style={{ marginTop: 6, color: colors.muted, textAlign: "center" }}>{copy.desc}</Text>
    </View>
  )
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 40 }}>
      <ActivityIndicator color={colors.gold} />
      {label ? <Text style={{ marginTop: 10, color: colors.muted }}>{label}</Text> : null}
    </View>
  )
}

export function KpiTile({
  icon,
  label,
  value,
  sub,
  tone = colors.primary,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  value: string | number | null
  sub?: string
  tone?: string
}) {
  return (
    <View style={s.kpi}>
      <View style={[s.kpiIcon, { backgroundColor: `${tone}1a` }]}>
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <Text style={s.kpiValue}>{value ?? "—"}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
      {sub ? <Text style={s.kpiSub}>{sub}</Text> : null}
    </View>
  )
}

export function SectionCard({
  title,
  icon,
  action,
  onAction,
  children,
}: {
  title: string
  icon: keyof typeof Ionicons.glyphMap
  action?: string
  onAction?: () => void
  children: React.ReactNode
}) {
  return (
    <View style={[cardStyle, { padding: 14, gap: 12 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={s.sectionIcon}>
          <Ionicons name={icon} size={14} color={colors.gold} />
        </View>
        <Text style={s.sectionTitle}>{title}</Text>
        {action && onAction ? (
          <Pressable onPress={onAction} hitSlop={8} style={s.sectionAction}>
            <Text style={s.sectionActionText}>{action}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  )
}

/** Horizontal bar split into coloured segments (e.g. live / stale / offline). */
export function SegmentBar({ segments }: { segments: { value: number; color: string; label: string }[] }) {
  const total = segments.reduce((n, x) => n + x.value, 0)
  return (
    <View style={{ gap: 8 }}>
      <View style={s.barTrack}>
        {total > 0
          ? segments.map((x) => (x.value > 0 ? <View key={x.label} style={{ flex: x.value, backgroundColor: x.color }} /> : null))
          : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {segments.map((x) => (
          <View key={x.label} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: x.color }} />
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {x.label} <Text style={{ color: colors.text, fontWeight: "700" }}>{x.value}</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

export function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.filterChip, active && s.filterChipActive]}>
      <Text style={[s.filterChipText, active && { color: colors.goldLight }]}>{label}</Text>
    </Pressable>
  )
}

/** Shared card surface so every screen uses the same border, radius and lift. */
export const cardStyle = {
  backgroundColor: colors.card,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: colors.border,
  ...shadow,
}

const s = StyleSheet.create({
  chip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  kpi: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 100,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 2,
    ...shadow,
  },
  kpiIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  kpiValue: { fontSize: 22, fontWeight: "700", color: colors.text },
  kpiLabel: { fontSize: 12, fontWeight: "700", color: colors.muted },
  kpiSub: { fontSize: 11, color: colors.faint },
  sectionIcon: { width: 24, height: 24, borderRadius: 6, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  sectionTitle: { flex: 1, fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
  sectionAction: { flexDirection: "row", alignItems: "center", gap: 2 },
  sectionActionText: { fontSize: 12, fontWeight: "700", color: colors.primary },
  barTrack: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: colors.chipBg },
  filterChip: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipActive: { backgroundColor: colors.navy, borderColor: colors.gold },
  filterChipText: { fontSize: 12, fontWeight: "700", color: colors.muted },
  headerDivider: { width: 1, height: 26, backgroundColor: "rgba(201,162,39,0.5)" },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  headerSub: { color: colors.goldLight, fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  titleBar: { width: 4, height: 20, borderRadius: 2, backgroundColor: colors.gold },
  h1: { fontSize: 20, fontWeight: "700", color: colors.text },
  sub: { color: colors.muted, marginTop: 4 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.goldBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: colors.warnBg,
    padding: 14,
  },
})
