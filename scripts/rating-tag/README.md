# Jellyfin Rating Tag

A client-side JavaScript enhancement for Jellyfin that injects a content rating badge (`PG-13`, `R`, `TV-MA`, etc.) onto media cards. Does not depend on Jellyfin Enhanced.

---

## Features

- Fetches `OfficialRating` values through the standard Jellyfin API
- Adds a top-right rating badge to movie, episode, and series cards
- Badge opacity is set to 70% for a softer overlay look
- Detects count-indicator cards (e.g. series episode counts) and places the rating immediately to the left of the existing count bubble
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
3. Hovering, focusing, or selecting a card hides the badge so the native card overlay remains unobstructed.

---

## Customisation

Tweak the constants near the top of `rating-tag.js`:

| Constant | Default | Description |
|---|---|---|
| `POLL_INTERVAL` | `1500` ms | How often the script checks for SPA navigation changes |
| `BATCH_SIZE` | `50` | Number of item IDs requested per API call |

Rating colour mappings are also defined near the top of the script.

---

## How it works

- A polling loop detects hash-based SPA navigation and triggers a scan of the current page.
- Visible card elements are collected and their item IDs are read from the DOM.
- Item IDs are batched and sent to `GET /Users/{userId}/Items?Ids=...&Fields=OfficialRating`.
- Each card receives an absolutely-positioned `<div>` badge injected into `.cardScalable`.
- Cards with a `.countIndicator` bubble have the badge repositioned to sit immediately to the left of it.
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

---

## Console logging

The script logs to the browser console with a `[RatingTag]` prefix. Open **F12 → Console** to observe it.
