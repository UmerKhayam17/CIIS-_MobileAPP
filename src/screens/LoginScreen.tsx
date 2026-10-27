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
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors, radius } from "../theme"
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
          <View style={s.logo}>
            <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 22 }}>C</Text>
          </View>
          <Text style={s.brand}>CIIS</Text>
          <Text style={s.brandSub}>Custom Intelligence Integrated System</Text>
        </View>

        <View style={s.card}>
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
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.buttonText}>Sign in</Text>
            )}
          </Pressable>
          <Text style={s.hint}>Contact HR or IT if you need access.</Text>
        </View>
        <Text style={s.footer}>© Pakistan Customs · Authorized personnel only</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: colors.navy, padding: 24, justifyContent: "center" },
  hero: { alignItems: "center", marginBottom: 24 },
  logo: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  brand: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: 1 },
  brandSub: { color: "#93c5fd", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginTop: 2 },
  card: { backgroundColor: "#fff", borderRadius: radius.lg, padding: 22 },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  subtitle: { color: colors.muted, marginTop: 6, marginBottom: 14 },
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
    backgroundColor: "#f8fafc",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 50,
  },
  input: { flex: 1, color: colors.text, fontSize: 15 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  hint: { textAlign: "center", color: colors.muted, fontSize: 12, marginTop: 12 },
  footer: { textAlign: "center", color: "#64748b", fontSize: 12, marginTop: 20 },
})
