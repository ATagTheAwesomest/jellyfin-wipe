# Script Catalog

## Overview

| Script | Files | Surface | Extra dependency | Best for |
|---|---|---|---|---|
| [Activity Monitor](../scripts/activity-monitor/README.md) | `activity.js`, `activity.css` | Header and fullscreen modal | Admin session | Monitoring streams, users, and server activity |
| [Branding CSS Sectioner](../scripts/branding-css-sectioner/README.md) | `branding-css-sectioner.js` | Dashboard -> Branding | Admin page access | Managing large Custom CSS blocks safely |
| [Collection Missing](../scripts/collection-missing/README.md) | `collection-missing.js`, `collection-missing.css` | Collection grids | Jellyfin Enhanced and Jellyseerr integration | Auditing missing titles in collections |
| [Collection Runtime](../scripts/collection-runtime/README.md) | `collection-runtime.js` | Collection details | None beyond Jellyfin API access | Showing total collection runtime in headers |
| [Play Stats](../scripts/play-stats/README.md) | `play-stats.js` | Media details | Playback Reporting plugin | Showing total and per-user play counts |
| [Rating Tag](../scripts/rating-tag/README.md) | `rating-tag.js` | Media cards | None beyond Jellyfin API access | Showing content ratings directly on cards |

## By Dependency

### No extra plugin dependency

- [Collection Runtime](../scripts/collection-runtime/README.md)
- [Rating Tag](../scripts/rating-tag/README.md)

### Requires Jellyfin Enhanced features

- [Collection Missing](../scripts/collection-missing/README.md)

### Requires Playback Reporting

- [Play Stats](../scripts/play-stats/README.md)

### Best used by admins

- [Activity Monitor](../scripts/activity-monitor/README.md)
- [Branding CSS Sectioner](../scripts/branding-css-sectioner/README.md)

## Rating Tag Palette

The Rating Tag script supports grouped rating palettes with an inner fill color and outer border color.

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
