/**
 * Exposes the local Django backend (localhost:8000) over a public HTTPS tunnel so
 * phones on any network can reach it, then points the app at it by writing the
 * tunnel URL into .env and the development/preview profiles of eas.json.
 *
 * Usage: npm run tunnel   (keep the window open while testing)
 *
 * - With NGROK_DOMAIN set in .env (e.g. NGROK_DOMAIN=your-name.ngrok-free.app) it
 *   uses ngrok's free static domain, so the URL never changes and a built APK keeps
 *   working. One-time setup: `ngrok config add-authtoken <token>`.
 * - Otherwise it falls back to a localhost.run SSH tunnel, whose *.lhr.life URL
 *   changes now and then — fine for Expo Go, not for an APK.
 *
 * The backend's ALLOWED_HOSTS must include the tunnel host (".ngrok-free.app",
 * ".ngrok-free.dev" or ".lhr.life").
 */
import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const BACKEND_PORT = process.env.BACKEND_PORT || "8000"
const NGROK_DOMAIN = (process.env.NGROK_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/+$/, "")

function updateEnv(url) {
  const file = join(ROOT, ".env")
  const text = existsSync(file) ? readFileSync(file, "utf8") : ""
  const line = `EXPO_PUBLIC_API_BASE_URL=${url}`
  const next = /^EXPO_PUBLIC_API_BASE_URL=.*$/m.test(text)
    ? text.replace(/^EXPO_PUBLIC_API_BASE_URL=.*$/m, line)
    : `${line}\n${text}`
  writeFileSync(file, next)
}

function updateEas(url) {
  const file = join(ROOT, "eas.json")
  const eas = JSON.parse(readFileSync(file, "utf8"))
  // Production keeps its real API host; only the test profiles follow the tunnel.
  for (const profile of ["development", "preview"]) {
    const p = eas.build?.[profile]
    if (p) p.env = { ...p.env, EXPO_PUBLIC_API_BASE_URL: url }
  }
  writeFileSync(file, JSON.stringify(eas, null, 2) + "\n")
}

let current = ""

function announce(url) {
  if (url === current) return
  current = url
  updateEnv(url)
  updateEas(url)
  console.log(`\nBackend tunnel: ${url}`)
  console.log(`Check on the phone: ${url}/admin/`)
  console.log("Updated .env and eas.json (development, preview).")
  console.log("Now run in another terminal:  npx expo start --tunnel --clear")
  console.log("Keep this window open while testing.\n")
}

const tunnel = NGROK_DOMAIN
  ? {
      name: "ngrok",
      command: process.env.NGROK || "ngrok",
      args: ["http", `--url=https://${NGROK_DOMAIN}`, "--log=stdout", BACKEND_PORT],
      onOutput(text) {
        if (/ERR_NGROK_\d+|authentication failed|err=/i.test(text)) process.stderr.write(text)
        if (/started tunnel/.test(text)) announce(`https://${NGROK_DOMAIN}`)
      },
    }
  : {
      name: "ssh",
      command: "ssh",
      args: [
        "-4", // this network has no working IPv6
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ServerAliveInterval=30",
        "-o", "ExitOnForwardFailure=yes",
        "-R", `80:localhost:${BACKEND_PORT}`,
        "nokey@localhost.run",
      ],
      onOutput(text) {
        const match = text.match(/https:\/\/[a-z0-9-]+\.lhr\.life/)
        if (match) announce(match[0])
      },
    }

let child
let stopping = false

// Free tunnels drop now and then; reconnect instead of leaving the phones offline.
function start() {
  child = spawn(tunnel.command, tunnel.args, { stdio: ["ignore", "pipe", "pipe"] })
  const onData = (chunk) => tunnel.onOutput(chunk.toString())
  child.stdout.on("data", onData)
  child.stderr.on("data", onData)
  child.on("error", (err) => {
    console.error(`Could not start ${tunnel.name}: ${err.message}`)
    process.exit(1)
  })
  child.on("exit", (code) => {
    if (stopping) process.exit(0)
    console.error(`Tunnel closed (exit ${code}); reconnecting in 5s...`)
    setTimeout(start, 5000)
  })
}

start()
process.on("SIGINT", () => {
  stopping = true
  child.kill()
})
