# Dependencies and Compatibility

## Dependency Matrix

| Script | Jellyfin API | Jellyfin Enhanced | Playback Reporting | Jellyseerr integration | Admin account |
|---|---|---|---|---|---|
| Activity Monitor | Yes | No | No | No | Yes |
| Branding CSS Sectioner | Yes, via normal admin page behaviour | No | No | No | Yes |
| Collection Missing | Yes | Yes | No | Yes | No |
| Collection Runtime | Yes | No | No | No | No |
| Play Stats | Yes | No | Yes | No | No |
| Rating Tag | Yes | No | No | No | No |

## Compatibility Notes

- All scripts assume the Jellyfin web client exposes `window.ApiClient`.
- SPA navigation is common in Jellyfin, so scripts generally rely on hash polling, mutation observers, or both.
- Admin-facing scripts should be scoped tightly when possible.
- Third-party CDN use should be reviewed before deployment in locked-down environments.

## Loader Notes

- Jellyfin Enhanced JS Injector is the preferred default loader for this repo.
- If you use a different injector, confirm that it runs on every relevant page and that it does not reorder CSS and JS unexpectedly.
