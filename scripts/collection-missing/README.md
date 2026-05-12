# Jellyfin Collection Missing Titles

A pair of inject files (`collection-missing.js` + `collection-missing.css`) that add a **toggle button** to any Jellyfin collection grid page. When active, each collection card expands to show which movies from that TMDB collection are missing from your library — clicking a title opens the Jellyfin Enhanced "More Info" / Jellyseerr request overlay directly.

---

## Features

- **Toggle button** injected into the page toolbar — one click to show/hide
- Each collection card expands to list its missing movies with release year
- **Green count badge** on the card when the collection is fully complete
- Only shows **already-released** movies as missing — if a film releases in the future the collection is treated as complete until then
- Clicking a missing title opens the **Jellyfin Enhanced More Info overlay** to request it via Jellyseerr
- Handles SPA navigation (hash changes) and infinite-scroll / lazy-loaded cards automatically
- API requests are batched (4 at a time) to avoid hammering the server

---

## Requirements

| Requirement | Notes |
|---|---|
| [Jellyfin Enhanced](https://github.com/InfinityPracticeMirror/Jellyfin-Enhanced) plugin | Must be installed and active |
| Jellyseerr configured in Jellyfin Enhanced | The plugin proxies collection data from Jellyseerr |
| A CSS/JS injector | e.g. the JS Injector feature built into Jellyfin Enhanced (you can use the Branding tab in yout jellyfin dashboard to load the CSS) |

---

## Installation

1. Copy `collection-missing.css` and `collection-missing.js` somewhere your Jellyfin instance can serve or reference them (or paste the contents directly into your injector fields).
2. In Jellyfin Enhanced (or your injector of choice), add the files in this order:
   1. `collection-missing.css` — **must load before the JS**
   2. `collection-missing.js`
3. Reload your Jellyfin page. Navigate to a collection library — the toggle button should appear in the toolbar.

---

## Usage

1. Open any Jellyfin page that shows a grid of collections (BoxSet cards).
2. Click the **playlist_add_check** icon button in the toolbar.
3. Each card expands and loads its missing titles from Jellyseerr.
   - **✓ Complete** — all released movies in the collection are in your library (count badge turns green).
   - **Missing (N)** — lists the titles you don't have yet, sorted by release date.
4. Click any missing title to open the Jellyfin Enhanced More Info overlay and request it.
5. Click the button again to collapse all cards back to normal.

---

## Customisation

All tweakable values are at the top of `collection-missing.js`:

| Constant | Default | Description |
|---|---|---|
| `COMPLETE_COLOR` | `#22c55e` | Colour of the count badge when a collection is complete |
| `POLL_INTERVAL` | `1500` ms | How often the script checks for SPA navigation changes |
| `BATCH_SIZE` | `4` | Concurrent API requests when expanding cards |

Card width (default `320px`) and all other visual styles are in `collection-missing.css`.

---

## How it works

1. A polling loop watches for hash-based SPA navigation changes.
2. When a collection grid page is detected, the toggle button is injected into the toolbar.
3. On toggle-on, each `BoxSet` card is queried against the **Jellyfin Enhanced** `/JellyfinEnhanced/boxset/{id}` endpoint to resolve the TMDB collection ID.
4. That ID is passed to `window.JellyfinEnhanced.jellyseerrAPI.fetchCollectionDetails()`, which proxies the Jellyseerr `/collection/{id}` response.
5. Parts are filtered: movies with no release date or a future release date are excluded; fully available movies (Jellyseerr status `5`) are excluded.
6. The remaining missing titles are rendered as clickable items that call `window.JellyfinEnhanced.jellyseerrMoreInfo.open(tmdbId, 'movie')`.
7. A `MutationObserver` handles any cards added by infinite scroll while the toggle is active.

---

## Console logging

The script logs to the browser console with a `[CollectionMissing]` prefix. Open **F12 → Console** to observe it.