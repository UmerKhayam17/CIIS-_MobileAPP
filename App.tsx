import React, { useEffect, useRef, useState } from "react"
import { View, ActivityIndicator, AppState, type AppStateStatus } from "react-native"
import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { NavigationContainer } from "@react-navigation/native"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { Ionicons } from "@expo/vector-icons"
import { colors } from "./src/theme"
import { isAuthenticated, loadStoredUser, canViewAllStaff, shouldTrackLocation, getCachedUser } from "./src/lib/auth"
import { flushOfflineQueue, sendHeartbeat, transitionMobileSession } from "./src/lib/mobile"
import { syncPermittedCallLogs } from "./src/lib/call-sync"
import { syncAppUsage } from "./src/lib/app-usage-sync"
import { startTracking } from "./src/lib/location"
import LoginScreen from "./src/screens/LoginScreen"
import HomeScreen from "./src/screens/HomeScreen"
import LocationScreen from "./src/screens/LocationScreen"
import AttendanceScreen from "./src/screens/AttendanceScreen"
import LogsScreen from "./src/screens/LogsScreen"
import CallsScreen from "./src/screens/CallsScreen"
import SettingsScreen from "./src/screens/SettingsScreen"

const Tab = createBottomTabNavigator()

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: "grid-outline",
  Location: "location-outline",
  Attendance: "document-text-outline",
  Logs: "list-outline",
  Calls: "call-outline",
  Settings: "settings-outline",
}

function Tabs({ onSignOut }: { onSignOut: () => void }) {
  const overview = canViewAllStaff(getCachedUser())
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: { fontWeight: "800", color: colors.text },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.faint,
        tabBarIcon: ({ color, size }) => <Ionicons name={ICONS[route.name]} size={size} color={color} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Location" component={LocationScreen} />
      <Tab.Screen name="Attendance" component={AttendanceScreen} />
      <Tab.Screen name="Calls" component={CallsScreen} options={{ title: "Calls" }} />
      {overview ? <Tab.Screen name="Logs" component={LogsScreen} /> : null}
      <Tab.Screen name="Settings">{() => <SettingsScreen onSignOut={onSignOut} />}</Tab.Screen>
    </Tab.Navigator>
  )
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    void (async () => {
      await loadStoredUser()
      const ok = await isAuthenticated()
      setAuthed(ok)
      if (ok && shouldTrackLocation()) void startTracking()
    })()
  }, [])

  // Foreground sync + lightweight heartbeat while signed in.
  useEffect(() => {
    if (!authed) return
    const beat = () => void sendHeartbeat()
    beat()
    void syncPermittedCallLogs()
    void syncAppUsage()
    heartbeat.current = setInterval(beat, 45000)
    const onState = (state: AppStateStatus) => {
      if (state === "active") {
        void flushOfflineQueue()
        void syncPermittedCallLogs()
        void syncAppUsage()
        void sendHeartbeat({ app_state: "foreground" })
        void transitionMobileSession("using")
      } else if (state === "background") {
        void sendHeartbeat({ app_state: "background" })
        void transitionMobileSession("locked")
      }
    }
    const sub = AppState.addEventListener("change", onState)
    return () => {
      if (heartbeat.current) clearInterval(heartbeat.current)
      sub.remove()
    }
  }, [authed])

  if (authed === null) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {authed ? (
        <NavigationContainer>
          <Tabs onSignOut={() => setAuthed(false)} />
        </NavigationContainer>
      ) : (
        <LoginScreen onAuthed={() => setAuthed(true)} />
      )}
    </SafeAreaProvider>
  )
}
