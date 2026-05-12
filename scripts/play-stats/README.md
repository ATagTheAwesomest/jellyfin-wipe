# Jellyfin Play Stats

A client-side JavaScript enhancement for Jellyfin that injects a **play count badge** into media detail pages. Loaded via the **Jellyfin Web JavaScript Injector** plugin.

---

## Features

- Adds a `▶ N plays` badge to any media detail page (movies, episodes, etc.)
- Hovering over the badge shows a floating popup with:
  - An SVG pie chart sliced per user
  - A legend with each user's name, play count, and percentage
  - A total plays footer
- Queries play history live from the Playback Reporting Plugin's SQLite database
- Each user's colour is deterministically derived from their username (djb2 hash → HSL hue), so colours are consistent across sessions
- All DOM lookups are scoped to the active SPA page (`.page:not(.hide)`) to handle Jellyfin's page caching correctly

---

## Requirements

| Requirement | Notes |
|---|---|
| [Jellyfin JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector) | Loads custom scripts into the Jellyfin web client — paste JS directly in the plugin settings. **Requires adding the repo manually** (not in official catalog). |
| [File Transformation Plugin](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation) | Required by the JavaScript Injector to function. No configuration needed. **Requires adding the repo manually** (not in official catalog). |
| [Playback Reporting Plugin](https://github.com/jellyfin/jellyfin-plugin-playbackreporting) | Required — provides the play history database. |

---

## Installation

1. Go to **Dashboard → Plugins → Repositories** and add the custom repository URLs from each repo's README:
   - [Jellyfin JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector)
   - [File Transformation Plugin](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation)
2. Go to **Dashboard → Plugins → Catalog** and install:
   - **Jellyfin JavaScript Injector** (from the custom repo above)
   - **File Transformation** (from the custom repo above)
   - **Playback Reporting** (available in the default catalog)
3. Restart Jellyfin after installing.
4. In the Jellyfin dashboard, go to **Dashboard → Plugins → JavaScript Injector**.
5. Paste the full contents of `play-stats.js` into the script field.
6. Save and hard-refresh the Jellyfin web client (`Ctrl+Shift+R`).

---

## Usage

1. Navigate to any media detail page (movie, episode, etc.) in Jellyfin.
2. A `▶ # plays` badge appears automatically in the header info bar.
3. Hover over the badge to see the per-user pie chart breakdown.

---

## Customisation

| Constant | Default | Description |
|---|---|---|
| `POLL_INTERVAL` | `1500` ms | How often the script checks for SPA navigation changes |

---

## How it works

- Watches for navigation to any `#/details` page
- Sends a custom SQL query to the Playback Reporting Plugin endpoint:
  ```
  POST /user_usage_stats/submit_custom_query
  { "CustomQueryString": "SELECT UserId, COUNT(*) as PlayCount FROM PlaybackActivity WHERE ItemId = '<id>' GROUP BY UserId ORDER BY PlayCount DESC" }
  ```
- Resolves user IDs to display names via `GET /Users`
- Inserts a `▶ N plays` badge into `.itemMiscInfo-primary`
- Hovering the badge shows a floating popup with an SVG pie chart and legend
- The `MutationObserver` fires until `insertOrUpdateBadge` succeeds, then stops re-triggering for that page

---

## Troubleshooting

**Badge never appears**
- Confirm the script loads at all: check the Network tab for the script URL and the Console for the `[PlayStats] Script loaded` line.
- Check that `.itemMiscInfo-primary` exists on the page — some Jellyfin themes rename or remove this element.
- Confirm the Playback Reporting Plugin is installed and has data: go to **Dashboard → Plugins → Playback Reporting**.

**Shows `0 plays` for everything**
- The Playback Reporting Plugin only records plays made after installation. Historical plays will not appear.
- Confirm the custom query endpoint is accessible: `https://your-server/user_usage_stats/submit_custom_query` should return `405 Method Not Allowed` (not `404`).

**Wrong item ID detected**
- The script extracts the item ID from `#/details?id=...`. If the hash format differs in your Jellyfin version, look for the `[PlayStats] No valid item ID in URL` warning in the console.

**Popup appears in the wrong position**
- The popup is positioned using `getBoundingClientRect()` and clamped to the viewport. If your theme uses unusual scroll containers, the position may be slightly off but should remain visible.

**Script keeps re-running on the same page**
- This is expected until the header DOM is ready. The `MutationObserver` stops re-triggering once `insertOrUpdateBadge` succeeds.

---

## Console logging

The script logs to the browser console with a `[PlayStats]` prefix. Open **F12 → Console** to observe it.
