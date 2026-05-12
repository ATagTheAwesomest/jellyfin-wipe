# Security

These scripts are designed to be injected into the Jellyfin web client. That means they execute inside a logged-in browser session and inherit whatever access the active account already has.

## Why This Matters

An injected script can:

- call Jellyfin API endpoints as the current user
- read data already visible in the UI
- alter or submit admin dashboard forms
- make outbound network requests
- interfere with playback controls or navigation

For admin accounts, the blast radius is much larger.

## Safer Usage Guidelines

1. Review every script before enabling it.
2. Prefer self-hosting the files you inject.
3. Avoid loading raw code from unpinned third-party URLs.
4. Test new scripts with a non-admin account when possible.
5. Restrict admin-only scripts to admin pages and admin users.
6. Keep a backup of Branding CSS before using tools that rewrite the Branding textarea.
7. Re-check permissions and dependencies after Jellyfin or plugin upgrades.

## Third-Party Dependencies To Notice

- `scripts/branding-css-sectioner/branding-css-sectioner.js` loads Prism assets from jsDelivr for syntax highlighting.
- `scripts/collection-missing` depends on Jellyfin Enhanced and Jellyseerr integration.
- `scripts/play-stats` depends on the Playback Reporting plugin.

If your threat model is strict, vendor remote dependencies locally and inspect all network paths before deployment.
