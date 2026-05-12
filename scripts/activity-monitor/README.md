# Jellyfin Activity Monitor

A pair of inject files (`activity.js` + `activity.css`) that add an **Activity button** to the Jellyfin header. Clicking it opens a fullscreen modal with four tabs: live streams, the server activity log, all users, and server info — all driven purely by the standard Jellyfin REST API, no extra plugins required.

---

## Features

- **Live Streams tab** — shows every active session with backdrop art, channel logo, title, progress bar (smooth interpolation via `requestAnimationFrame`), and full codec/container/bitrate stats
- **Click-to-expand trickplay** — click any stream card to reveal the current trickplay thumbnail at the exact playback position alongside a formatted timestamp
- **Transcoding detail chips** — hardware acceleration method, video/audio codec, container, subtitle mode, and the full list of transcode reason flags
- **Activity Log tab** — paginated server activity log with severity icons and clickable rows that link to the relevant item
- **Users tab** — all users shown as cards with online/playing status dots, last-seen time, and current playback info
- **Server Info tab** — version, OS, uptime, library counts, per-type active stream breakdown, and a per-session transcoding table; pending restart shown as an amber warning banner
- Polls active sessions every **4 seconds** while the modal is open; stops the poll and animation loop when closed
- Efficient DOM reconciliation — cards update in-place rather than being destroyed and recreated on every poll

---

## Requirements

| Requirement | Notes |
|---|---|
| Jellyfin 10.8 or later | Uses `/Sessions`, `/System/Info`, `/System/ActivityLog/Entries`, `/Users` |
| Admin account | The inject runs in the context of the logged-in user — admin-only endpoints require an admin session |
| A CSS/JS injector | e.g. the JS Injector feature built into Jellyfin Enhanced, or any custom injection method |

---

## Installation

1. **Add the CSS to the Jellyfin branding section**
   - In the Jellyfin dashboard go to **Admin → Dashboard → General → Branding**.
   - Paste the entire contents of `activity.css` into the **Custom CSS** field and save.
2. **Inject the JavaScript**
   - Copy `activity.js` somewhere your Jellyfin instance can serve it, or paste its contents into your JS injector of choice (e.g. the JS Injector feature in Jellyfin Enhanced).
   - Make sure it loads on **every page** — the script self-bootstraps once `window.ApiClient` and the Jellyfin header are ready.
3. Reload your Jellyfin page. A **monitor_heart** icon button will appear in the top-right header area — **only for administrator accounts**; regular users will not see it.

---

## Usage

1. Click the **analytics** icon in the Jellyfin header to open the monitor.
2. Use the four tabs across the top:
   - **Streams** — live sessions; cards auto-update every poll cycle. Click a card to toggle the trickplay thumbnail for that session.
   - **Activity** — recent server events in a sortable table. Click a row to open the related item.
   - **Users** — all accounts with coloured status dots (purple = currently playing, green = online, grey = offline).
   - **Server** — system info, library counts, and a breakdown of what's transcoding and why.
3. Use the **refresh** icon button in the header to force an immediate reload of the current tab.
4. Click the **close** ( ✕ ) button or the backdrop to dismiss.

---

## Customisation

All tweakable values are at the top of `activity.js`:

| Constant | Default | Description |
|---|---|---|
| `POLL_MS` | `4000` ms | How often active sessions are re-fetched while the modal is open |
| `ACTIVITY_LIMIT` | `100` | Number of activity log entries loaded per fetch |

All colours, card sizing, and layout are in `activity.css`.

---

## How it works

1. The script waits for `window.ApiClient` to be ready, then injects one button into `.headerRight`.
2. On open, the modal is created (once) and the poll loop + `requestAnimationFrame` animation loop both start.
3. **Streams:** `/Sessions` is fetched every `POLL_MS`. `reconcileSessions()` diffs the current cards against the new session list — existing cards are patched in-place via `updateSessionCard()`, new ones are appended, and gone sessions are removed. Between polls, each card's progress bar is interpolated forward in real time using the stored `lastPosTicks` + elapsed wall-clock time.
4. **Trickplay:** On card click, `fetchTrickplayInfo()` requests `/Users/{userId}/Items/{itemId}` and reads the double-keyed `Trickplay` map (`{ mediaSourceId: { width: info } }`). The correct tile sheet index and background-position offset are computed using Jellyfin's own trickplay math, and the frame div is updated as the progress bar animates.
5. **Activity log:** `/System/ActivityLog/Entries` is fetched once per tab visit; severity, user, and date are rendered into a `<table>`.
6. **Users:** `/Users` and `/Sessions?ActiveWithinSeconds=960` are fetched in parallel and merged — each user card shows their most recent active session if one exists.
7. **Server info:** `/System/Info`, `/Items/Counts`, and the current session list are fetched in parallel and composed into stat cards and a transcoding table.
8. The poll timer and animation loop are stopped as soon as the modal closes.

---

## Console logging

The script logs to the browser console with a `[ActivityMonitor]` prefix. Open **F12 → Console** to observe it.
