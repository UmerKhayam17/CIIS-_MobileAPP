# CIIS Mobile (React Native / Expo)

Native Android + iOS port of the CIIS staff PWA: login, live staff location on a map,
attendance, mobile logs, and duty GPS tracking with an offline buffer that uploads when
the network returns.

## Configure the backend URL

The app talks to the Django API directly. Set the origin reachable from the phones:

```
# .env  (or pass at build time)
EXPO_PUBLIC_API_BASE_URL=https://your-api-host
```

If unset it falls back to the value in `src/config.ts`. A raw-IP HTTPS host with a
self-signed cert will be rejected by the phone — use a real domain + valid cert, or plain
`http://<lan-ip>:<port>` for LAN testing only.

## Run it (free, both platforms) — Expo Go

```
npm install
npx expo start
```

Scan the QR code with the **Expo Go** app (free, App Store / Play Store).
- Works on Android and iPhone at $0, no Apple Developer account, no Mac.
- **Foreground location only** — Expo Go cannot run the always-on background service.
- **No call history** — Expo Go does not include the Android call-log module. Use a development build.

## Call history

Android can upload cellular call metadata only after three things are true: the Peshawar
deployment has published a monitoring policy that includes **Android call history**, the
employee has acknowledged that policy in the Calls tab, and the employee has allowed call
history on the phone. The app does not record audio. Calls from before acknowledgment are
rejected by the API.

iPhone cellular call history is not available to any third-party app. iPhone business calls
show up only when they come from the company phone system.

From the Peshawar backend:

```
python manage.py migrate employee_monitoring
python manage.py seed_monitoring_policy
```

`READ_CALL_LOG` is restricted. A private APK does not override a phone that refuses the
permission. Sync runs when the employee opens the app, not as a hidden background job.

## Build a real free Android app (background tracking works)

```
# cloud build (free tier), produces an installable APK:
npm install -g eas-cli
eas login
eas build -p android --profile preview
```

Or locally on Windows with Android Studio installed:

```
npx expo prebuild -p android
npx expo run:android          # debug build on a connected device/emulator
```

Sideload the APK to staff phones. Android background location requires the user to pick
**"Allow all the time"** and to leave the app running (not force-stopped).

## iOS as a real standalone app (not free)

Requires an **Apple Developer account ($99/yr)** and a Mac or EAS cloud build:

```
eas build -p ios --profile preview
```

There is no way to distribute a standalone iOS app to other people for free — that's an
Apple policy, not a project limitation.

## What carried over from the PWA

- Same backend contract (`/api/auth/login`, `/api/gps/*`, `/api/mobile/*`, `/api/attendance`, …).
- Offline queue hardening: one queue, dedup by `event_id`, delete on confirmed upload,
  per-user stamping (shared-phone safety), retry-with-cap so one bad event can't block the rest.
- Role gating (`canViewAllStaff`, `shouldTrackLocation`) — still enforce it on the server too.

## Project layout

```
App.tsx                auth gate + bottom tabs + foreground/heartbeat wiring
src/config.ts          API base URL
src/lib/               storage, api, auth, device, queue, mobile (session/events/flush),
                       gps-api, attendance-api, logs-api, location (tracker + bg task)
src/screens/           Login, Home, Location (Leaflet map), Attendance, Logs, Settings
```
