# Installing Bulletproof on your phone

You only need your phone's browser and your sync token.

## Install

1. Open the app's Railway address (`https://…up.railway.app`) in **Chrome** or **Samsung Internet**.
   It must be the `https://` address, or the install option won't appear.
2. Install it:
   - **Chrome:** menu (⋮) → **Install app** (or **Add to Home screen**).
   - **Samsung Internet:** menu (☰) → **Add page to** → **Home screen** (or the install icon in the address bar).
3. Open Bulletproof from the new home-screen icon. It opens full screen, like an app.

After the first open it works with **no signal**: log whole workouts in airplane mode. Everything is saved on
the phone with every tap, and it syncs by itself when you're back online.

## Connect sync (once)

1. Home → **Settings** → **Sync**.
2. Paste your sync token and tap **Save token**.
3. The line at the bottom of Home should read **Synced just now**.

From then on it backs up after every finished workout, after history edits, when the app opens, and when
signal returns. **Sync now** in Settings forces it.

Status line meanings:

| It says | Meaning |
|---|---|
| Synced 2 min ago | All good |
| Not synced: offline | No signal. Dirty records wait and send later |
| Sync token missing | Enter it in Settings → Sync |
| Not synced: sync token rejected | The token doesn't match the server's. Retype it |

## New phone or cleared browser

Install the app (above), then Settings → Sync → paste the same token → **Save token**. All your workouts,
settings and decisions come back from the server. Do this on the new phone **before** logging anything.

## Other things worth knowing

- **Export CSV** (Settings → Your data) shares a file to Drive, Gmail and so on, or downloads it.
- **Download backup (JSON)** is a second backup you can keep yourself.
- If a workout can't be finished, tap **Can't finish today**: the date shows yellow on the calendar and you
  redo that workout from the start next time.
- If your phone offers "Keep data" or storage permissions for the app, say yes. It protects your history from
  the browser cleaning up space.
