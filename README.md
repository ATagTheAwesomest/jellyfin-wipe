# Jellyfin WIPE

Jellyfin Web Injected Personal Enhancements.

A curated collection of browser-injected Jellyfin web-client enhancements.

This repo is intentionally focused on small, targeted web-client customisations: header tools, detail-page metadata, collection helpers, card overlays, and admin-page quality-of-life scripts. It does not include server plugins, metadata providers, search filtering, current-page helpers, or unrelated non-Jellyfin projects.

> [!IMPORTANT]
> The recommended loader for this repo is the Jellyfin Enhanced JS Injector, or another injector you fully trust and control. These scripts run inside an authenticated Jellyfin web session and should be treated like real application code, not harmless theme snippets.

> [!WARNING]
> Custom JS injection carries security risk. A script loaded into Jellyfin can call API endpoints available to the logged-in user, read page state, alter admin forms, and exfiltrate data if it is malicious or compromised. Review everything before you load it. Prefer self-hosted files over third-party URLs.

## What Is Included

| Script | Folder | Assets | Page / Surface | Extra dependency | Summary |
|---|---|---|---|---|---|
| Activity Monitor | `scripts/activity-monitor` | `activity.js`, `activity.css` | Header button + fullscreen admin modal | Admin account | Live streams, activity log, users, and server info in one modal |
| Branding CSS Sectioner | `scripts/branding-css-sectioner` | `branding-css-sectioner.js` | Admin Dashboard -> Branding | Admin page access | Breaks the giant branding CSS textarea into named, collapsible sections |
| Collection Missing | `scripts/collection-missing` | `collection-missing.js`, `collection-missing.css` | Collection library grids | Jellyfin Enhanced + Jellyseerr integration | Shows missing titles in collections and opens the request overlay |
| Collection Runtime | `scripts/collection-runtime` | `collection-runtime.js` | Collection detail pages | None beyond Jellyfin API access | Adds total runtime and an "Ends at" time to collection headers |
| Play Stats | `scripts/play-stats` | `play-stats.js` | Media detail pages | Playback Reporting plugin | Adds total play counts and a per-user play breakdown popup |
| Rating Tag | `scripts/rating-tag` | `rating-tag.js` | Media cards in libraries and home rows | None beyond Jellyfin API access | Adds content rating badges to cards, including count-aware placement and Scenes/chapter exclusion |

## Recommended Usage

1. Pick the script folder you want from `scripts/`.
2. Read that folder's README before enabling anything.
3. If the script includes CSS, load the CSS before the JS.
4. Prefer the Jellyfin Enhanced JS Injector for site-wide loading.
5. Hard refresh the Jellyfin web client after changes.
6. Open the browser console and look for each script's log prefix if something does not appear.

## Security And Operational Notes

- Treat every script here as trusted application code.
- Test admin-facing scripts with care. They can modify or interfere with Dashboard forms.
- Self-host files whenever possible instead of pulling from third-party URLs.
- Review network activity if a script depends on another plugin or a third-party CDN.
- Keep backups of any long-form text fields you manage through injectors, especially Branding CSS.

See `SECURITY.md` for the full warning and safer usage guidance.

## Repository Layout

```text
jellyfin-wipe/
  README.md
  SECURITY.md
  scripts/
    activity-monitor/
      activity.css
      activity.js
      README.md
    branding-css-sectioner/
      branding-css-sectioner.js
      README.md
    collection-missing/
      collection-missing.css
      collection-missing.js
      README.md
    collection-runtime/
      collection-runtime.js
      README.md
    play-stats/
      play-stats.js
      README.md
    rating-tag/
      rating-tag.js
      README.md
```

## Scope

This repo covers only the scripts listed in the table above. Jellyfin server plugins, metadata providers, and unrelated utilities are out of scope and are not included.
