# Jellyfin Collection Runtime

A client-side JavaScript enhancement for Jellyfin that adds **total runtime** and **"Ends at"** time to collection detail pages. Loaded via the **Jellyfin Web JavaScript Injector** plugin.

---

## Features

- Displays combined total runtime (e.g. `9h 32m`) in the collection header
- Displays an **"Ends at"** time based on the current time + total runtime
- Info is inserted after the content rating in the header bar, matching native Jellyfin styling
- Handles SPA navigation via hash polling and a `MutationObserver`
- Caches results per collection to avoid redundant API calls

---

## Requirements

| Requirement | Notes |
|---|---|
| [Jellyfin JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector) | Loads custom scripts into the Jellyfin web client — paste JS directly in the plugin settings. **Requires adding the repo manually** (not in official catalog). |
| [File Transformation Plugin](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation) | Required by the JavaScript Injector to function. No configuration needed. **Requires adding the repo manually** (not in official catalog). |

---

## Installation

1. Go to **Dashboard → Plugins → Repositories** and add the custom repository URLs from each repo's README:
   - [Jellyfin JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector)
   - [File Transformation Plugin](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation)
2. Go to **Dashboard → Plugins → Catalog**, install both plugins, then restart Jellyfin.
3. In the Jellyfin dashboard, go to **Dashboard → Plugins → JavaScript Injector**.
4. Paste the full contents of `collection-runtime.js` into the script field.
5. Save and hard-refresh the Jellyfin web client (`Ctrl+Shift+R`).

---

## Usage

1. Navigate to any collection detail page in Jellyfin.
2. The total runtime and "Ends at" time appear automatically in the collection header.

---

## Customisation

| Constant | Default | Description |
|---|---|---|
| `POLL_INTERVAL` | `1500` ms | How often the script checks for SPA navigation changes |

---

## How it works

- Uses the Jellyfin `ApiClient` (exposed globally by the web client) for authentication
- Fetches `/Users/{userId}/Items/{itemId}` for each movie card in the collection
- Sums `RunTimeTicks` (1 tick = 100 nanoseconds) and converts to hours/minutes
- Injects styled `<div class="mediaInfoItem">` elements into the existing header
- Handles SPA navigation via hash polling and a `MutationObserver`
- Caches results per collection to avoid redundant API calls

---

## Console logging

The script logs to the browser console with a `[CollectionRuntime]` prefix. Open **F12 → Console** to observe it.
