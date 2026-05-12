# Jellyfin Branding CSS Sectioner

A single-script admin enhancement for Jellyfin's Branding page that turns the default "Custom CSS" textarea into a structured editor with named, collapsible sections.

The script keeps Jellyfin's original save flow intact by writing every edit back into the hidden source textarea, so the normal Dashboard save button still works.

## Features

- Splits one long Branding CSS field into named sections
- Supports collapsible panels for faster navigation
- Preserves pre-existing unmanaged CSS above the managed marker as read-only content
- Supports sortable normal sections plus pinned-to-bottom sections
- Serialises changes back into Jellyfin's original textarea automatically
- Supports both the current section marker format and older marker variants
- Adds CSS syntax highlighting via Prism.js

## Requirements

| Requirement | Notes |
|---|---|
| Jellyfin admin access | The script targets the Dashboard Branding page |
| A trusted JS injector | Recommended: Jellyfin Enhanced JS Injector, targeted to admin pages |
| Internet access for Prism.js, or a locally vendored replacement | The script currently loads Prism from jsDelivr |

## Installation

1. Load `branding-css-sectioner.js` through your injector.
2. Restrict it to the Jellyfin Dashboard branding page if your injector supports page scoping.
3. Open `Dashboard -> General -> Branding`.
4. The default Custom CSS textarea will be replaced by the sectioned editor once the page is ready.

## Managed Marker Format

The script writes managed blocks into the Branding CSS field using the following format:

```css
/* ═══ [branding-css-sectioner] ═══ */
/* ═-═ Section name ═-═ 0 */
/* ═-═ Footer name ═-═ bottom */
```

Anything above the managed marker is preserved as pre-existing content.

## Usage Notes

- Use normal sections for regular ordered CSS blocks.
- Use pinned sections for footer-style overrides that should remain at the bottom.
- Export CSS before major edits if you want an external backup.
- Because this script touches an admin form, test carefully after Jellyfin upgrades.

## Logging

The script logs with the `[BrandingCssSectioner]` prefix in the browser console.
