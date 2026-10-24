import AsyncStorage from "@react-native-async-storage/async-storage"

/**
 * Thin async wrapper over AsyncStorage. In the web PWA this was synchronous
 * localStorage; on native every read/write is a Promise, so every caller is async.
 */
export async function getItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key)
  } catch {
    return null
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value)
  } catch {
    /* ignore quota / io errors */
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export async function getJson<T>(key: string): Promise<T | null> {
  const raw = await getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function setJson(key: string, value: unknown): Promise<void> {
  await setItem(key, JSON.stringify(value))
}
