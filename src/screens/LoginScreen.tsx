import React, { useEffect, useState } from "react"
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius, shadow, brand } from "../theme"
import { login } from "../lib/auth-api"
import { setAuthenticatedWithToken, getRememberedUsername, shouldTrackLocation } from "../lib/auth"
import { saveMobileSession, reportMobileEvent, transitionMobileSession, sendHeartbeat } from "../lib/mobile"
import { startTracking } from "../lib/location"

export default function LoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void getRememberedUsername().then(setUsername)
  }, [])

  async function submit() {
    if (loading) return
    setError("")
    setLoading(true)
    try {
      const { token, user, mobile_session } = await login(username, password)
      await setAuthenticatedWithToken(token, user)
      await saveMobileSession(mobile_session)
      void reportMobileEvent("login")
      void transitionMobileSession("using")
      void sendHeartbeat()
      if (shouldTrackLocation(user)) void startTracking()
      onAuthed()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid username or password.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.hero}>
          <View style={s.logoCard}>
            <Image source={brand.logo} style={s.logo} resizeMode="contain" />
          </View>
          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Ionicons name="shield-checkmark" size={14} color={colors.gold} />
            <View style={s.dividerLine} />
          </View>
          <Text style={s.brandSub}>Secure field access for {brand.org}</Text>
        </View>

        <View style={s.card}>
          <View style={s.cardAccent} />
          <Text style={s.title}>Welcome back</Text>
          <Text style={s.subtitle}>
            Sign in once on this phone. CIIS stays signed in and shares your duty location until you sign out.
          </Text>

          {error ? (
            <View style={s.alert}>
              <Ionicons name="information-circle" size={18} color="#92400e" />
              <Text style={{ color: "#92400e", flex: 1 }}>{error}</Text>
            </View>
          ) : null}

          <Text style={s.label}>Username</Text>
          <View style={s.inputWrap}>
            <Ionicons name="person-outline" size={18} color={colors.faint} />
            <TextInput
              style={s.input}
              placeholder="Enter your username"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
              editable={!loading}
            />
          </View>

          <Text style={s.label}>Password</Text>
          <View style={s.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.faint} />
            <TextInput
              style={s.input}
              placeholder="Enter your password"
              placeholderTextColor={colors.faint}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              editable={!loading}
              onSubmitEditing={submit}
            />
            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10}>
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={colors.faint} />
            </Pressable>
          </View>

          <Pressable style={[s.button, loading && { opacity: 0.7 }]} onPress={submit} disabled={loading}>
            {loading ? (
              <ActivityIndicator color={colors.navy} />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={s.buttonText}>Sign in</Text>
                <Ionicons name="arrow-forward" size={18} color={colors.navy} />
              </View>
            )}
          </Pressable>
          <View style={s.hintRow}>
            <Ionicons name="help-circle-outline" size={14} color={colors.muted} />
            <Text style={s.hint}>Contact HR or IT if you need access.</Text>
          </View>
        </View>
        <Text style={s.footer}>© {brand.org} · {brand.fullName}
          {"\n"}Authorized personnel only
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: colors.navy, padding: 20, justifyContent: "center" },
  hero: { alignItems: "center", marginBottom: 20 },
  logoCard: {
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "#fff",
    borderWidth: 3,
    borderColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: 168, height: 168 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18, width: 200 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(201,162,39,0.5)" },
  brandSub: { color: colors.goldLight, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, marginTop: 10, fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: radius.lg, padding: 22, paddingTop: 26, overflow: "hidden", ...shadow },
  cardAccent: { position: "absolute", top: 0, left: 0, right: 0, height: 4, backgroundColor: colors.gold },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  subtitle: { color: colors.muted, marginTop: 6, marginBottom: 14, lineHeight: 20 },
  alert: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    backgroundColor: colors.warnBg,
    borderColor: "#fde68a",
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 10,
    marginBottom: 12,
  },
  label: { fontSize: 13, fontWeight: "700", color: colors.text, marginTop: 10, marginBottom: 6 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f7f9fc",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 50,
  },
  input: { flex: 1, color: colors.text, fontSize: 15 },
  button: {
    backgroundColor: colors.gold,
    borderRadius: radius.sm,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  buttonText: { color: colors.navy, fontWeight: "700", fontSize: 16, letterSpacing: 0.3 },
  hintRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14 },
  hint: { color: colors.muted, fontSize: 12 },
  footer: { textAlign: "center", color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 20, lineHeight: 17 },
})
