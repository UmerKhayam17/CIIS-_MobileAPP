import React, { useCallback, useEffect, useMemo, useState } from "react"
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, Platform, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius, shadow } from "../theme"
import { canViewAllStaff, getCachedUser } from "../lib/auth"
import { formatDuration, formatTime, shiftIso, todayIso } from "../lib/format"
import { EmptyState, ErrorBanner, FilterChip, KpiTile, Loading, ScreenTitle, SectionCard } from "../ui"
import {
  MonitorApiError,
  fetchCallRecords,
  fetchMonitorConsent,
  fetchMonitorPolicy,
  policyAllowsHandset,
  consentCovers,
  setConsentCategory,
  type CallRecord,
  type MonitorConsent,
  type MonitorPolicy,
} from "../lib/call-api"
import { clearCallQueue } from "../lib/call-queue"
import {
  androidCallLogSupported,
  callLogPermission,
  requestCallLogPermission,
  syncPermittedCallLogs,
  type CallPermission,
} from "../lib/call-sync"

type DirFilter = "all" | "inbound" | "outbound" | "missed"

const DIR_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }> = {
  inbound: { icon: "arrow-down-outline", color: colors.good, label: "Incoming" },
  outbound: { icon: "arrow-up-outline", color: colors.primary, label: "Outgoing" },
  missed: { icon: "close-outline", color: colors.bad, label: "Missed" },
  unknown: { icon: "help-outline", color: colors.faint, label: "Unknown" },
}

const REC_META: Record<string, { label: string; bg: string; fg: string }> = {
  available: { label: "Recording", bg: colors.goodBg, fg: "#166534" },
  pending: { label: "Processing", bg: colors.warnBg, fg: "#92400e" },
  failed: { label: "Rec. failed", bg: colors.badBg, fg: "#991b1b" },
  not_recorded: { label: "Not recorded", bg: "#f1f5f9", fg: "#334155" },
}

export default function CallsScreen() {
  const overview = canViewAllStaff(getCachedUser())
  const [date, setDate] = useState(todayIso())
  const [username, setUsername] = useState("")
  const [query, setQuery] = useState("")
  const [rows, setRows] = useState<CallRecord[]>([])
  const [talkSeconds, setTalkSeconds] = useState(0)
  const [policy, setPolicy] = useState<MonitorPolicy | null>(null)
  const [consent, setConsent] = useState<MonitorConsent | null>(null)
  const [permission, setPermission] = useState<CallPermission>("unavailable")
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [dir, setDir] = useState<DirFilter>("all")

  useEffect(() => {
    const t = setTimeout(() => setQuery(username.trim()), 300)
    return () => clearTimeout(t)
  }, [username])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [policyResult, consentResult, callsResult, permissionResult] = await Promise.all([
        fetchMonitorPolicy(),
        fetchMonitorConsent(),
        fetchCallRecords({ date, username: overview ? query || undefined : undefined }),
        callLogPermission(),
      ])
      setPolicy(policyResult)
      setConsent(consentResult)
      setRows(callsResult.results)
      setTalkSeconds(callsResult.total_duration_seconds || 0)
      setPermission(permissionResult)
      setError("")
    } catch (err) {
      setRows([])
      setTalkSeconds(0)
      if (err instanceof MonitorApiError && err.status === 501) {
        setError("Call reporting is not enabled on this server.")
      } else {
        setError(err instanceof Error ? err.message : "Could not load call history")
      }
    } finally {
      setLoading(false)
    }
  }, [date, overview, query])

  useEffect(() => {
    void load()
  }, [load])

  const handsetAllowed = policyAllowsHandset(policy)
  const acknowledged = consentCovers(consent, policy, "android_call_history")

  async function acknowledge() {
    if (!policy || busy || !agreed) return
    setBusy(true)
    setNotice("")
    try {
      const next = await setConsentCategory(policy, "android_call_history", true)
      setConsent(next)
      setNotice("Acknowledgment saved. Allow call history on this phone to start uploading.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save acknowledgment")
    } finally {
      setBusy(false)
    }
  }

  async function withdraw() {
    if (!policy || busy) return
    setBusy(true)
    try {
      const next = await setConsentCategory(policy, "android_call_history", false)
      await clearCallQueue()
      setConsent(next)
      setNotice("Call history upload from this phone has stopped.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not withdraw")
    } finally {
      setBusy(false)
    }
  }

  async function allowAndSync() {
    if (busy) return
    setBusy(true)
    setNotice("")
    try {
      const next = permission === "granted" ? "granted" : await requestCallLogPermission()
      setPermission(next)
      if (next !== "granted") {
        setNotice(
          next === "blocked"
            ? "This phone is not allowing call history. Open Settings if Android offers the permission for CIIS."
            : "Call history stays on this phone until you allow it.",
        )
        return
      }
      const result = await syncPermittedCallLogs()
      if (result.skipped === "ios") setNotice("iPhone cannot share cellular call history.")
      else if (result.skipped === "build") setNotice("This install cannot read call history. Use a CIIS development build, not Expo Go.")
      else if (result.skipped === "policy") setNotice("The published policy does not include Android call history yet.")
      else if (result.skipped === "network") setNotice("Saved on this phone. CIIS will upload when the connection returns.")
      else if (result.skipped === "consent") setNotice("Acknowledge the current policy above before call history can upload.")
      else if (result.skipped === "permission") setNotice("Allow call history for CIIS to start uploading.")
      else if (result.skipped) setNotice(`Call history could not upload (${result.skipped}).`)
      else setNotice(result.uploaded ? `Uploaded ${result.uploaded} new call${result.uploaded === 1 ? "" : "s"}.` : "Call history is up to date.")
      await load()
    } finally {
      setBusy(false)
    }
  }

  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
  const isToday = date === todayIso()

  const filtered = useMemo(() => rows.filter((r) => dir === "all" || r.direction === dir), [rows, dir])
  const missed = useMemo(() => rows.filter((r) => r.direction === "missed").length, [rows])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={loading ? [] : filtered}
        keyExtractor={(row) => row.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 2 }}>
            <ScreenTitle
              title={overview ? "Staff calls" : "Call history"}
              subtitle={
                overview
                  ? "Calls uploaded from Android work phones and the company phone system. Numbers are masked."
                  : "Your uploaded calls. Numbers are masked. CIIS does not record call audio."
              }
            />

            {Platform.OS === "ios" ? (
              <Note icon="phone-portrait-outline">
                iPhone does not let CIIS read normal SIM call history. Business calls appear here only when they are placed through the company phone system.
              </Note>
            ) : null}

            {Platform.OS === "android" && !androidCallLogSupported() ? (
              <Note icon="construct-outline">
                Expo Go cannot read call history. Install a CIIS development build on this phone, then allow call history after you acknowledge the notice.
              </Note>
            ) : null}

            {Platform.OS === "android" && androidCallLogSupported() && policy && !handsetAllowed ? (
              <Note icon="document-text-outline">
                Android call history is not in the published monitoring policy yet, so this phone will not upload it. Ask IT to publish the updated policy.
              </Note>
            ) : null}

            {Platform.OS === "android" && handsetAllowed && !acknowledged ? (
              <SectionCard title="Before call history is uploaded" icon="shield-checkmark">
                <Text style={s.body}>
                  If this is a CIIS work phone, allowing access uploads incoming, outgoing and missed call numbers, times and durations from the moment you acknowledge. Calls from before that are not uploaded. CIIS does not record audio. Supervisors, HR and authorized administrators can view the masked records.
                </Text>
                {policy?.summary ? <Text style={s.body}>{policy.summary}</Text> : null}
                {policy?.contact ? (
                  <View style={s.infoLine}>
                    <Ionicons name="person-outline" size={14} color={colors.gold} />
                    <Text style={s.meta}>{policy.contact}</Text>
                  </View>
                ) : null}
                <Pressable style={[s.checkRow, agreed && s.checkRowOn]} onPress={() => setAgreed((v) => !v)}>
                  <Ionicons name={agreed ? "checkbox" : "square-outline"} size={22} color={agreed ? colors.gold : colors.primary} />
                  <Text style={s.checkText}>This is a CIIS work phone, or CIIS has authorized call-history collection on it.</Text>
                </Pressable>
                <Pressable style={[s.primaryBtn, (!agreed || busy) && s.disabled]} disabled={!agreed || busy} onPress={() => void acknowledge()}>
                  <Ionicons name="checkmark" size={18} color={colors.navy} />
                  <Text style={s.primaryText}>{busy ? "Saving…" : "Acknowledge"}</Text>
                </Pressable>
              </SectionCard>
            ) : null}

            {Platform.OS === "android" && handsetAllowed && acknowledged ? (
              <SectionCard title="This phone" icon="phone-portrait">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={[s.dot, { backgroundColor: permission === "granted" ? colors.good : colors.warn }]} />
                  <Text style={s.body}>
                    {permission === "granted"
                      ? "Call history access is allowed. CIIS uploads new calls when you open the app."
                      : "Call history access is not allowed yet. Nothing is read until you allow it."}
                  </Text>
                </View>
                <Pressable style={[s.primaryBtn, busy && s.disabled]} disabled={busy} onPress={() => void allowAndSync()}>
                  <Ionicons name={permission === "granted" ? "sync" : "lock-open-outline"} size={18} color={colors.navy} />
                  <Text style={s.primaryText}>{busy ? "Working…" : permission === "granted" ? "Sync now" : "Allow call history"}</Text>
                </Pressable>
                {permission === "blocked" ? (
                  <Pressable style={s.secondaryBtn} onPress={() => void Linking.openSettings()}>
                    <Ionicons name="settings-outline" size={16} color={colors.primary} />
                    <Text style={s.secondaryText}>Open settings</Text>
                  </Pressable>
                ) : null}
                <Pressable style={s.withdrawBtn} onPress={() => void withdraw()} disabled={busy}>
                  <Ionicons name="hand-left-outline" size={16} color={colors.bad} />
                  <Text style={s.withdraw}>Stop uploading call history</Text>
                </Pressable>
              </SectionCard>
            ) : null}

            {notice ? (
              <View style={s.notice}>
                <Ionicons name="information-circle" size={18} color={colors.primary} />
                <Text style={s.noticeText}>{notice}</Text>
              </View>
            ) : null}

            <View style={s.dateBar}>
              <Pressable style={s.dateBtn} onPress={() => setDate((d) => shiftIso(d, -1))} hitSlop={6}>
                <Ionicons name="chevron-back" size={20} color={colors.goldLight} />
              </Pressable>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={s.dateLabel}>{dateLabel}</Text>
                {isToday ? <Text style={s.dateSub}>Today</Text> : null}
              </View>
              <Pressable style={s.dateBtn} onPress={() => setDate((d) => shiftIso(d, 1))} hitSlop={6}>
                <Ionicons name="chevron-forward" size={20} color={colors.goldLight} />
              </Pressable>
            </View>

            {overview ? (
              <View style={s.searchWrap}>
                <Ionicons name="search" size={16} color={colors.faint} />
                <TextInput
                  style={s.search}
                  placeholder="Search by username"
                  placeholderTextColor={colors.faint}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                />
              </View>
            ) : null}

            {!loading && !error ? (
              <>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <KpiTile icon="call" label="Calls" value={rows.length} tone={colors.primary} />
                  <KpiTile icon="close-circle-outline" label="Missed" value={missed} tone={colors.bad} />
                  <KpiTile icon="time" label="Talk time" value={formatDuration(talkSeconds)} tone={colors.gold} />
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {(["all", "inbound", "outbound", "missed"] as const).map((d) => (
                    <FilterChip key={d} label={d === "all" ? "All" : DIR_META[d].label} active={dir === d} onPress={() => setDir(d)} />
                  ))}
                </View>
              </>
            ) : null}

            {error ? <ErrorBanner message={error} /> : null}
            {loading ? <Loading label="Loading calls" /> : null}
          </View>
        }
        ListEmptyComponent={
          !loading && !error ? (
            <EmptyState
              icon="call-outline"
              title={rows.length ? "No matching calls" : "No calls for this day"}
              description="Uploaded Android call history and company phone-system calls show up here."
            />
          ) : null
        }
        renderItem={({ item }) => {
          const d = DIR_META[item.direction] ?? DIR_META.unknown
          const rec = REC_META[item.recording_status]
          return (
            <View style={s.card}>
              <View style={[s.dirIcon, { backgroundColor: `${d.color}1a` }]}>
                <Ionicons name={d.icon} size={18} color={d.color} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={s.number} numberOfLines={1}>
                    {overview ? item.name || item.username || "Unknown" : item.masked_number || "Hidden number"}
                  </Text>
                  <Text style={s.time}>{formatTime(item.started_at)}</Text>
                </View>
                {overview ? <Text style={s.sub2}>{item.masked_number || "Hidden number"}</Text> : null}
                <Text style={s.metaLine}>
                  {[d.label, formatDuration(item.duration_seconds), item.source_label || item.source].filter(Boolean).join(" · ")}
                </Text>
                {rec ? (
                  <View style={{ flexDirection: "row", marginTop: 8 }}>
                    <View style={[s.recChip, { backgroundColor: rec.bg }]}>
                      <Text style={{ color: rec.fg, fontSize: 11, fontWeight: "700" }}>{rec.label}</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            </View>
          )
        }}
      />
    </View>
  )
}

function Note({ icon, children }: { icon: keyof typeof Ionicons.glyphMap; children: React.ReactNode }) {
  return (
    <View style={s.note}>
      <View style={s.noteIcon}>
        <Ionicons name={icon} size={16} color={colors.gold} />
      </View>
      <Text style={s.noteText}>{children}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    ...shadow,
  },
  noteIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  noteText: { flex: 1, color: colors.muted, lineHeight: 20 },
  body: { flex: 1, color: colors.text, lineHeight: 21 },
  meta: { color: colors.muted, fontSize: 12, flex: 1 },
  infoLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  checkRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    padding: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.chipBg,
  },
  checkRowOn: { borderColor: colors.gold, backgroundColor: colors.goldBg },
  checkText: { flex: 1, color: colors.text, lineHeight: 20 },
  primaryBtn: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: colors.navy, fontWeight: "700", fontSize: 16 },
  secondaryBtn: {
    flexDirection: "row",
    gap: 6,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.chipBg,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontWeight: "700", color: colors.primary },
  withdrawBtn: {
    flexDirection: "row",
    gap: 6,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  withdraw: { color: colors.bad, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.chipBg,
    padding: 12,
  },
  noticeText: { flex: 1, color: colors.primary, fontWeight: "600" },
  dateBar: { flexDirection: "row", alignItems: "center", backgroundColor: colors.navy, borderRadius: radius.md, padding: 6, gap: 6, ...shadow },
  dateBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  dateLabel: { fontWeight: "700", color: "#fff", fontSize: 15 },
  dateSub: { color: colors.goldLight, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 1 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 46,
  },
  search: { flex: 1, color: colors.text },
  card: { flexDirection: "row", gap: 12, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, ...shadow },
  dirIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  number: { fontWeight: "700", color: colors.text, fontSize: 15, flexShrink: 1 },
  sub2: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 2 },
  time: { color: colors.faint, fontSize: 12 },
  metaLine: { color: colors.muted, fontSize: 12, marginTop: 2 },
  recChip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
})
