# Installation and Loading

This page covers the shared install pattern used across Jellyfin WIPE.

## Recommended Loader

The default recommendation is Jellyfin Enhanced JS Injector. If you use something else, it should still be a trusted, site-wide loader that you control.

## General Rules

1. Self-host the files when possible.
2. Load CSS before JS for scripts that ship both.
3. Scope admin-only scripts to admin pages when your injector supports page targeting.
4. Hard refresh the Jellyfin web client after updates.
5. Check the browser console for each script's log prefix.

## Common Install Patterns

### JS-only script

1. Load the script through your injector.
2. Enable it on the pages where the target surface exists.
3. Hard refresh and verify the script appears.

### CSS + JS pair

1. Load the CSS first.
2. Load the JS second.
3. Confirm both assets are available to the browser.
4. Hard refresh and verify layout plus behaviour.

### Admin-page script

1. Restrict it to the relevant Dashboard page if possible.
2. Test with an admin account only.
3. Back up any long-form settings fields before heavy editing.

## Debug Checklist

- Confirm the injector actually loaded the file.
- Confirm the page contains the expected DOM target.
- Confirm the logged-in user has access to the required Jellyfin API endpoints.
- Confirm any supporting plugin or integration is installed and responding.
- Check for CSP, mixed-content, or 404 errors in the browser console and network tab.
