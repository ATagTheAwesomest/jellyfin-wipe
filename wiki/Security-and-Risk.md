# Security and Risk

These scripts run inside a logged-in Jellyfin browser session. That means they inherit the permissions and visibility of the active user.

## Main Risks

- An injected script can call Jellyfin API endpoints as the current user.
- It can read page state and visible metadata.
- It can modify or submit admin forms.
- It can make outbound requests if the browser allows them.

## Practical Safety Rules

1. Review every script before enabling it.
2. Prefer self-hosted files over third-party URLs.
3. Restrict admin-only tools to admin pages.
4. Test with a lower-privilege account when possible.
5. Re-check all injects after Jellyfin or plugin upgrades.

## Scripts With Special Risk Considerations

- [Branding CSS Sectioner](../scripts/branding-css-sectioner/README.md): rewrites the Branding CSS form value.
- [Activity Monitor](../scripts/activity-monitor/README.md): intended for admin sessions.
- [Collection Missing](../scripts/collection-missing/README.md): depends on Jellyfin Enhanced and Jellyseerr integration.

See the main repo security file for the longer version: [../SECURITY.md](../SECURITY.md).
