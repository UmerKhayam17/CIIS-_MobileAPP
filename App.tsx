import React, { useEffect, useRef, useState } from "react"
import { View, Image, ActivityIndicator, AppState, Platform, type AppStateStatus } from "react-native"
import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context"
import { NavigationContainer } from "@react-navigation/native"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { Ionicons } from "@expo/vector-icons"
import { brand, colors } from "./src/theme"
import { HeaderBrand } from "./src/ui"
import { isAuthenticated, loadStoredUser, canViewAllStaff, shouldTrackLocation, getCachedUser } from "./src/lib/auth"
import { flushOfflineQueue, sendHeartbeat, sendMobileEvent, transitionMobileSession } from "./src/lib/mobile"
import { syncPermittedCallLogs } from "./src/lib/call-sync"
import { syncAppUsage } from "./src/lib/app-usage-sync"
import { syncCallRecordings } from "./src/lib/call-recording-sync"
import { startTracking } from "./src/lib/location"
import LoginScreen from "./src/screens/LoginScreen"
import OnboardingScreen from "./src/screens/OnboardingScreen"
import { onboardingComplete } from "./src/lib/onboarding"
import HomeScreen from "./src/screens/HomeScreen"
import LocationScreen from "./src/screens/LocationScreen"
import AttendanceScreen from "./src/screens/AttendanceScreen"
import LogsScreen from "./src/screens/LogsScreen"
import CallsScreen from "./src/screens/CallsScreen"
import SettingsScreen from "./src/screens/SettingsScreen"

// On web, react-native-web renders TextInput as a real <input>, which gets the browser's
// default black focus outline. Remove it once so focused fields match the app's own styling.
if (Platform.OS === "web" && typeof document !== "undefined") {
  const id = "ciis-input-focus-reset"
  if (!document.getElementById(id)) {
    const style = document.createElement("style")
    style.id = id
    style.textContent = `input, textarea { outline: none !important; }
input:focus, textarea:focus { outline: none !important; box-shadow: none !important; }`
    document.head.appendChild(style)
  }
}

const Tab = createBottomTabNavigator()

// Skips the employee chose (or that are expected) stay quiet; anything else is logged so
// the control room can see why call/app-usage data is not arriving.
const QUIET_SKIPS = new Set(["", "busy", "ios", "optout", "network"])

function syncHandsetData() {
  const report = (kind: string) => (result: { skipped: string }) => {
    if (!QUIET_SKIPS.has(result.skipped)) void sendMobileEvent(`${kind}_SYNC_SKIPPED: ${result.skipped}`.slice(0, 200))
  }
  void syncPermittedCallLogs().then(report("CALL"))
  void syncAppUsage().then(report("APP_USAGE"))
  void syncCallRecordings().then(report("CALL_RECORDING"))
}

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: "grid",
  Location: "location",
  Attendance: "calendar",
  Calls: "call",
  Logs: "pulse",
  Settings: "person-circle",
}

const TITLES: Record<string, string> = {
  Home: "Dashboard",
  Location: "Location",
  Attendance: "Attendance",
  Calls: "Calls",
  Logs: "Mobile logs",
  Settings: "Profile",
}

const TAB_LABELS: Record<string, string> = {
  Home: "Home",
  Location: "Map",
  Attendance: "Attend",
  Calls: "Calls",
  Logs: "Logs",
  Settings: "Profile",
}

function Tabs({ onSignOut }: { onSignOut: () => void }) {
  const overview = canViewAllStaff(getCachedUser())
  const insets = useSafeAreaInsets()
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.navy, borderBottomWidth: 2, borderBottomColor: colors.gold },
        headerTitleAlign: "left",
        headerTitle: () => <HeaderBrand title={TITLES[route.name] ?? route.name} />,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarLabel: TAB_LABELS[route.name] ?? route.name,
        tabBarActiveTintColor: colors.goldLight,
        tabBarInactiveTintColor: "rgba(255,255,255,0.78)",
        tabBarStyle: {
          backgroundColor: colors.navy,
          borderTopWidth: 2,
          borderTopColor: colors.gold,
          height: 66 + insets.bottom,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        tabBarItemStyle: { paddingVertical: 2 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700", marginTop: 4 },
        tabBarIcon: ({ color, focused }) => (
          <View
            style={{
              width: 52,
              height: 30,
              borderRadius: 15,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: focused ? "rgba(201,162,39,0.22)" : "transparent",
            }}
          >
            <Ionicons
              name={(focused ? ICONS[route.name] : `${ICONS[route.name]}-outline`) as keyof typeof Ionicons.glyphMap}
              size={21}
              color={color}
            />
          </View>
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Location" component={LocationScreen} />
      <Tab.Screen name="Attendance" component={AttendanceScreen} />
      <Tab.Screen name="Calls" component={CallsScreen} />
      {overview ? <Tab.Screen name="Logs" component={LogsScreen} /> : null}
      <Tab.Screen name="Settings">{() => <SettingsScreen onSignOut={onSignOut} />}</Tab.Screen>
    </Tab.Navigator>
  )
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    void (async () => {
      await loadStoredUser()
      const ok = await isAuthenticated()
      if (ok) setNeedsOnboarding(!(await onboardingComplete(getCachedUser()?.id)))
      setAuthed(ok)
      if (ok && shouldTrackLocation()) void startTracking()
    })()
  }, [])

  // Foreground sync + lightweight heartbeat while signed in.
  useEffect(() => {
    if (!authed) return
    const beat = () => void sendHeartbeat()
    beat()
    syncHandsetData()
    heartbeat.current = setInterval(beat, 45000)
    const onState = (state: AppStateStatus) => {
      if (state === "active") {
        void flushOfflineQueue()
        syncHandsetData()
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
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", gap: 24 }}>
        <Image source={brand.logo} style={{ width: 220, height: 220 }} resizeMode="contain" />
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={authed && needsOnboarding ? "dark" : "light"} />
      {authed ? (
        needsOnboarding ? (
          <OnboardingScreen userId={getCachedUser()?.id ?? null} onDone={() => setNeedsOnboarding(false)} />
        ) : (
          <NavigationContainer>
            <Tabs
              onSignOut={() => {
                setNeedsOnboarding(false)
                setAuthed(false)
              }}
            />
          </NavigationContainer>
        )
      ) : (
        <LoginScreen
          onAuthed={async () => {
            setNeedsOnboarding(!(await onboardingComplete(getCachedUser()?.id)))
            setAuthed(true)
          }}
        />
      )}
    </SafeAreaProvider>
  )
}
