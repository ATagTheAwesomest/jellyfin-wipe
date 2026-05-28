# Jellyfin Rating Tag

A client-side JavaScript enhancement for Jellyfin that injects a content rating badge (`PG-13`, `R`, `TV-MA`, etc.) onto media cards. Does not depend on Jellyfin Enhanced.

---

## Features

- Fetches `OfficialRating` values through the standard Jellyfin API
- Adds a top-right rating badge to movie, episode, and series cards
- Badge opacity is set to 70% for a softer overlay look
- Detects count-indicator cards (e.g. series episode counts) and places the rating immediately to the left of the existing count bubble
- Excludes Scenes/chapter rows so chapter cards do not get rating badges
- Batches API requests to avoid hammering the server
- Handles SPA navigation and lazy-loaded cards via `MutationObserver`
- Works whether or not Jellyfin Enhanced is installed

---

## Requirements

| Requirement | Notes |
|---|---|
| Jellyfin web client with `ApiClient` available | Standard Jellyfin web sessions expose this globally |
| A trusted JS injector | e.g. the JS Injector feature built into Jellyfin Enhanced, or any custom injection method |

---

## Installation

1. Load `rating-tag.js` through your injector of choice.
2. Ensure it loads on library and home pages where media cards render.
3. Hard-refresh the Jellyfin web client (`Ctrl+Shift+R`).
4. Browse any library or home row containing rated items — badges appear automatically.

---

## Usage

1. Browse any Jellyfin library or home row.
2. Rating badges appear on cards automatically — no interaction required.
   - Cards with a count bubble (e.g. series): rating appears immediately to the left of the count bubble.
   - Cards without a count bubble: rating appears in the top-right corner of the image area.
   - Scenes/chapter cards are intentionally skipped.
3. Hovering, focusing, or selecting a card hides the badge so the native card overlay remains unobstructed.

---

## Customisation

Tweak the constants near the top of `rating-tag.js`:

| Constant | Default | Description |
|---|---|---|
| `POLL_INTERVAL` | `1500` ms | How often the script checks for SPA navigation changes |
| `BATCH_SIZE` | `10` | Number of item IDs requested per API call |

### Rating Groups And Colors

| Group | Ratings Included | Inner Color | Outer Border Color |
|---|---|---|---|
| General / All Audiences | `G`, `U`, `FSK0`, `TV-Y7` | `#2E7D32` | `#4CAF50` |
| Parental Guidance Suggested | `PG`, `12A`, `DE-6` | `#D4AF37` + `#D19A00` gradient | `#FFC107` |
| Parents Strongly Cautioned | `PG-13`, `15`, `AU-M` | `#B25900` | `#FF6F00` |
| Mature Accompanied | `MA15+`, `FR-16` | `#D50000` | `#FF1744` |
| Restricted | `R`, `18`, `DE-18` | `#8B0000` | `#B71C1C` |
| Adults Only | `NC-17`, `X18+` | `#880E4F` | `#C2185B` |
| Special Categories | `S` | `#4A148C` | `#7B1FA2` |
| Educational / Exempt | `EDU`, `EXEMPT` | `#0D47A1` | `#1976D2` |
| Unrated / Unknown | `UNRATED`, `NR` | `#424242` | `#757575` |

The script also keeps compatibility aliases for common TV labels (`TV-Y`, `TV-G`, `TV-PG`, `TV-14`, `TV-MA`) by mapping them into the nearest group.

---

## How it works

- A polling loop detects hash-based SPA navigation and triggers a scan of the current page.
- Visible card elements are collected and their item IDs are read from the DOM.
- Item IDs are batched and sent to `GET /Users/{userId}/Items?Ids=...&Fields=OfficialRating`.
- Each card receives an absolutely-positioned `<div>` badge injected into `.cardScalable`.
- Cards with a `.countIndicator` bubble have the badge repositioned to sit immediately to the left of it.
- Scene/chapter cards (including cards inside `#scenesCollapsible`) are ignored.
- A `MutationObserver` watches for newly added cards (infinite scroll, lazy load) and processes them as they appear.

---

## Troubleshooting

**Badges never appear**
- Confirm the script is loading: check the console for `[RatingTag] Script loaded`.
- Confirm `ApiClient` is available: `window.ApiClient` should be defined in the console.
- Some Jellyfin themes rename `.cardScalable` — inspect a card element to verify the class is present.

**Badge appears in the wrong position**
- If a count bubble is present but the badge overlaps it, the `.countIndicator` selector may differ in your Jellyfin version. Inspect the bubble element and update the selector in the script.

**Badge missing on some cards but not others**
- Cards without an `OfficialRating` value in Jellyfin's metadata will not receive a badge. Check the item's metadata in the Jellyfin dashboard.
- Scene/chapter cards are excluded by design, even if the parent item has a rating.

---

## Console logging

The script logs to the browser console with a `[RatingTag]` prefix. Open **F12 → Console** to observe it.

---

## JE Edition — `rating-tag-je.js`

A drop-in replacement for `rating-tag.js` designed to work **alongside** [Jellyfin Enhanced](https://github.com/n00bcodr/Jellyfin-Enhanced) (JE). Instead of placing the badge on the raw card DOM, it injects the badge directly inside JE's own overlay containers so the badge automatically respects whichever corner JE is configured to use.

> Do **not** load `rating-tag.js` and `rating-tag-je.js` at the same time. The JE edition is a full replacement.

### Additional features over `rating-tag.js`

| Feature | Detail |
|---|---|
| JE container piggyback | Badge lives inside `.genre-overlay-container`, inheriting JE's corner position setting |
| Corner-change resilience | Badge survives JE's container wipe (`reinitializeGenreTags`) via an in-memory rating cache |
| Late-load upgrade | Cards that got the floating fallback badge are upgraded automatically when JE's containers appear |
| JE settings panel toggle | A **Rating / Genre** toggle row is injected directly into the JE settings panel |
| Per-user persistence | Toggle choice is saved to your Jellyfin display preferences — no admin rights required, each user has their own setting |
| Jellyseerr cards skipped | Cards with the `jellyseerr-card` class are silently ignored |

### Requirements

| Requirement | Notes |
|---|---|
| Jellyfin Enhanced plugin | Provides the `.je-tag-host` / `.genre-overlay-container` DOM structure the script piggybacks on |
| Jellyfin web client with `ApiClient` | Standard Jellyfin web sessions expose this globally |
| A trusted JS injector | JE's built-in JS Injector is the recommended loader |

### Installation

1. Load `rating-tag-je.js` through the JE JS Injector (or any trusted injector).
2. Hard-refresh the client (`Ctrl+Shift+R`).
3. Browse any library — badges appear automatically.

### Display modes

Open the JE settings panel (the `?` button) and look for the **<span style="color:#00A4DC">Rating</span> / Genre** row underneath the *Show Genre Tags* toggle.

| Button | What shows on cards |
|---|---|
| **Rating** *(default)* | Parental rating badge only; JE genre icons hidden |
| **Both** | Parental rating badge **and** JE genre icons side-by-side |
| **Genres** | JE genre icons only; rating badge hidden |

The chosen mode is saved to your personal Jellyfin display preferences (`DisplayPreferences.CustomPrefs`) and is restored on every page load. No server restart or CSS editing required.

### How it works

- When JE is loaded the badge is inserted as the first child of `.genre-overlay-container` (falling back to `.quality-overlay-container`), so it moves with whatever corner JE assigns.
- A `Map`-based in-memory cache (`itemId → rating`) is kept alive across JE container rebuilds. When JE reinitialises after a corner change the `MutationObserver` detects the new container and re-injects from cache — no extra API call.
- Cards that render before JE initialises receive a floating fallback badge on `.cardScalable`. Once JE's containers appear the fallback is replaced automatically.
- On load the script reads the saved mode from `GET /DisplayPreferences/usersettings`; on toggle click the updated preference is written back via `POST`.
- Live mode changes are applied immediately by updating a `<style id="je-rating-tag-je-mode-style">` element — no page reload needed.

### Console logging

The JE edition logs with a `[JW-RatingTag-JE]` prefix. Open **F12 → Console** to observe it.

### Troubleshooting

**Toggle row does not appear in the JE settings panel**
The script targets `#genreTagsToggle` inside the panel. If a newer version of JE renames this element the toggle will silently skip injection. Inspect the panel DOM and update the selector in the script if needed.

**Mode choice does not persist after a page reload**
The `DisplayPreferences` POST requires an active logged-in session. Guest sessions cannot save preferences. Confirm `ApiClient.getCurrentUserId()` returns a value in the console.

**Badge disappears after changing the JE genre corner**
This should be handled by the rating cache. If it still happens, look for `[JW-RatingTag-JE]` warnings in the console — the `MutationObserver` may have missed the container insertion if JE batches DOM changes in an unexpected way.

**Badges appear twice on a card**
Do not load both `rating-tag.js` and `rating-tag-je.js` at the same time.

