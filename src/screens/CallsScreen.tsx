import React, { useCallback, useEffect, useState } from "react"
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, Platform, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius } from "../theme"
import { canViewAllStaff, getCachedUser } from "../lib/auth"
import { formatDuration, formatTime, shiftIso, todayIso } from "../lib/format"
import { EmptyState, ErrorBanner, Loading } from "../ui"
import {
  MonitorApiError,
  fetchCallRecords,
  fetchMonitorConsent,
  fetchMonitorPolicy,
  policyAllowsHandset,
  postMonitorConsent,
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

const DIRECTION: Record<string, string> = {
  inbound: "Incoming",
  outbound: "Outgoing",
  missed: "Missed",
  unknown: "Unknown",
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
  const acknowledged = consent?.status === "acknowledged" && consent.policy_version === policy?.policy_version

  async function acknowledge() {
    if (!policy || busy || !agreed) return
    setBusy(true)
    setNotice("")
    try {
      const next = await postMonitorConsent(policy.policy_id, "acknowledge", ["android_call_history"])
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
      const next = await postMonitorConsent(policy.policy_id, "withdraw", ["android_call_history"])
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={loading ? [] : rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <View>
              <Text style={s.h1}>Call history</Text>
              <Text style={s.sub}>
                {overview
                  ? "Calls uploaded from Android work phones and the company phone system. Numbers are masked."
                  : "Your uploaded calls. Numbers are masked. CIIS does not record call audio."}
              </Text>
            </View>

            {Platform.OS === "ios" ? (
              <View style={s.note}>
                <Ionicons name="phone-portrait-outline" size={18} color={colors.primaryDark} />
                <Text style={s.noteText}>
                  iPhone does not let CIIS read normal SIM call history. Business calls appear here only when they are placed through the company phone system.
                </Text>
              </View>
            ) : null}

            {Platform.OS === "android" && !androidCallLogSupported() ? (
              <View style={s.note}>
                <Text style={s.noteText}>
                  Expo Go cannot read call history. Install a CIIS development build on this phone, then allow call history after you acknowledge the notice.
                </Text>
              </View>
            ) : null}

            {Platform.OS === "android" && androidCallLogSupported() && policy && !handsetAllowed ? (
              <View style={s.note}>
                <Text style={s.noteText}>
                  Android call history is not in the published monitoring policy yet, so this phone will not upload it. Ask IT to publish the updated policy.
                </Text>
              </View>
            ) : null}

            {Platform.OS === "android" && handsetAllowed && !acknowledged ? (
              <View style={s.card}>
                <Text style={s.cardTitle}>Before call history is uploaded</Text>
                <Text style={s.body}>
                  If this is a CIIS work phone, allowing access uploads incoming, outgoing and missed call numbers, times and durations from the moment you acknowledge. Calls from before that are not uploaded. CIIS does not record audio. Supervisors, HR and authorized administrators can view the masked records.
                </Text>
                {policy?.summary ? <Text style={s.body}>{policy.summary}</Text> : null}
                {policy?.contact ? <Text style={s.meta}>{policy.contact}</Text> : null}
                <Pressable style={s.checkRow} onPress={() => setAgreed((v) => !v)}>
                  <Ionicons name={agreed ? "checkbox" : "square-outline"} size={22} color={colors.primary} />
                  <Text style={s.checkText}>This is a CIIS work phone, or CIIS has authorized call-history collection on it.</Text>
                </Pressable>
                <Pressable style={[s.primaryBtn, (!agreed || busy) && s.disabled]} disabled={!agreed || busy} onPress={() => void acknowledge()}>
                  <Text style={s.primaryText}>{busy ? "Saving…" : "Acknowledge"}</Text>
                </Pressable>
              </View>
            ) : null}

            {Platform.OS === "android" && handsetAllowed && acknowledged ? (
              <View style={s.card}>
                <Text style={s.cardTitle}>This phone</Text>
                <Text style={s.body}>
                  {permission === "granted"
                    ? "Call history access is allowed. CIIS uploads new calls when you open the app."
                    : "Call history access is not allowed yet. Nothing is read until you allow it."}
                </Text>
                <Pressable style={[s.primaryBtn, busy && s.disabled]} disabled={busy} onPress={() => void allowAndSync()}>
                  <Text style={s.primaryText}>{busy ? "Working…" : permission === "granted" ? "Sync now" : "Allow call history"}</Text>
                </Pressable>
                {permission === "blocked" ? (
                  <Pressable style={s.secondaryBtn} onPress={() => void Linking.openSettings()}>
                    <Text style={s.secondaryText}>Open settings</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => void withdraw()} disabled={busy}>
                  <Text style={s.withdraw}>Stop uploading call history</Text>
                </Pressable>
              </View>
            ) : null}

            {notice ? <Text style={s.notice}>{notice}</Text> : null}

            <View style={s.dateBar}>
              <Pressable style={s.dateBtn} onPress={() => setDate((d) => shiftIso(d, -1))}>
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </Pressable>
              <Text style={s.dateLabel}>{dateLabel}</Text>
              <Pressable style={s.dateBtn} onPress={() => setDate((d) => shiftIso(d, 1))}>
                <Ionicons name="chevron-forward" size={20} color={colors.text} />
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

            <View style={s.totTile}>
              <Text style={s.totLabel}>Talk time</Text>
              <Text style={s.totValue}>{formatDuration(talkSeconds)}</Text>
              <Text style={s.meta}>{rows.length} shown</Text>
            </View>

            {error ? <ErrorBanner message={error} /> : null}
            {loading ? <Loading /> : null}
            {!loading && !error && rows.length === 0 ? (
              <EmptyState
                icon="call-outline"
                title="No calls for this day"
                description="Uploaded Android call history and company phone-system calls show up here."
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.eventCard}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={s.eventUser}>{overview ? item.name || item.username || "Unknown" : DIRECTION[item.direction] || "Call"}</Text>
              <Text style={s.eventTime}>{formatTime(item.started_at)}</Text>
            </View>
            <Text style={s.eventAction}>{item.masked_number || "Hidden number"}</Text>
            <Text style={s.eventMeta}>
              {[
                overview ? DIRECTION[item.direction] : null,
                formatDuration(item.duration_seconds),
                item.source_label || item.source,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        )}
      />
    </View>
  )
}

const s = StyleSheet.create({
  h1: { fontSize: 20, fontWeight: "800", color: colors.text },
  sub: { color: colors.muted, marginTop: 2 },
  note: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: colors.chipBg,
    borderRadius: radius.md,
    padding: 14,
  },
  noteText: { flex: 1, color: colors.primaryDark, lineHeight: 20 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 16,
    gap: 8,
  },
  cardTitle: { fontWeight: "800", color: colors.text, fontSize: 16 },
  body: { color: colors.text, lineHeight: 20 },
  meta: { color: colors.muted, fontSize: 12 },
  checkRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 4 },
  checkText: { flex: 1, color: colors.text, lineHeight: 20 },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryText: { color: "#fff", fontWeight: "700" },
  secondaryBtn: {
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontWeight: "700", color: colors.text },
  withdraw: { color: colors.bad, fontWeight: "700", textAlign: "center", marginTop: 4 },
  disabled: { opacity: 0.5 },
  notice: { color: colors.primaryDark, fontWeight: "600" },
  dateBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
  },
  dateBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dateLabel: { flex: 1, textAlign: "center", fontWeight: "700", color: colors.text },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 48,
  },
  search: { flex: 1, color: colors.text },
  totTile: { borderWidth: 1, borderColor: "#bbf7d0", backgroundColor: colors.goodBg, borderRadius: radius.md, padding: 12 },
  totLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", color: "#166534" },
  totValue: { fontSize: 22, fontWeight: "800", color: "#14532d", marginTop: 4 },
  eventCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14 },
  eventUser: { fontWeight: "700", color: colors.text, flex: 1 },
  eventTime: { fontSize: 11, color: colors.faint },
  eventAction: { color: colors.text, marginTop: 4, fontWeight: "700" },
  eventMeta: { color: colors.faint, fontSize: 12, marginTop: 4 },
})
