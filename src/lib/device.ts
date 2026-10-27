import { Platform } from "react-native"
import * as Device from "expo-device"
import { getItem, setItem } from "./storage"
import { APP_VERSION } from "../config"

const DEVICE_UUID_KEY = "ciis_device_uuid"

function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  const hex = "0123456789abcdef"
  let out = ""
  for (let i = 0; i < 32; i++) out += hex[Math.floor(Math.random() * 16)]
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-8${out.slice(17, 20)}-${out.slice(20)}`
}

let cachedUuid: string | null = null

export async function getOrCreateDeviceUuid(): Promise<string> {
  if (cachedUuid) return cachedUuid
  const existing = await getItem(DEVICE_UUID_KEY)
  if (existing) {
    cachedUuid = existing
    return existing
  }
  const created = randomUuid()
  cachedUuid = created
  await setItem(DEVICE_UUID_KEY, created)
  return created
}

/** Device fingerprint sent on login, mirroring the PWA payload shape. */
export async function deviceFingerprint() {
  return {
    device_uuid: await getOrCreateDeviceUuid(),
    device_name: Device.deviceName || Device.modelName || "CIIS Mobile",
    platform: Platform.OS === "android" ? "Android" : Platform.OS === "ios" ? "iOS" : "Mobile",
    browser: "Native",
    os_version: `${Device.osName || Platform.OS} ${Device.osVersion || ""}`.trim().slice(0, 80),
    app_version: APP_VERSION,
    pwa_version: APP_VERSION,
  }
}
