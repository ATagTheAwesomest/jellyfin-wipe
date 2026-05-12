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
