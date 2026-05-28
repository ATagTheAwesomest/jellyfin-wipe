# Jellyfin Branding CSS Sectioner

A single-script admin enhancement for Jellyfin's Branding page that turns the default "Custom CSS" textarea into a structured editor with named, collapsible sections.

The script keeps Jellyfin's original save flow intact by writing every edit back into the hidden source textarea, so the normal Dashboard save button still works.

---

## Features

- Splits one long Branding CSS field into named sections
- Supports collapsible panels for faster navigation
- Preserves pre-existing unmanaged CSS above the managed marker as read-only content
- Supports sortable normal sections plus pinned-to-bottom sections
- Enable/disable sections to comment out code on save without deleting it (code remains editable in preview)
- Serialises changes back into Jellyfin's original textarea automatically
- Supports both the current section marker format and older marker variants
- Adds CSS syntax highlighting via Prism.js

---

## Requirements

| Requirement | Notes |
|---|---|
| Jellyfin admin access | The script targets the Dashboard Branding page |
| A trusted JS injector | Recommended: Jellyfin Enhanced JS Injector, targeted to admin pages |
| Internet access for Prism.js, or a locally vendored replacement | The script currently loads Prism from jsDelivr |

---

## Installation

1. Load `branding-css-sectioner.js` through your injector.
2. Restrict it to the Jellyfin Dashboard branding page if your injector supports page scoping.
3. Open **Dashboard → General → Branding**.
4. The default Custom CSS textarea will be replaced by the sectioned editor once the page is ready.

---

## Managed marker format

The script writes managed blocks into the Branding CSS field using the following format:

```css
/* ═══ [JW-branding-css-sectioner] ═══ */
/* ═-═ Section name ═-═ 0 */
/* ═-═ Footer name ═-═ bottom */
/* ═-═ Disabled section ═-═ 1 disabled */
```

Disabled sections have their content wrapped in `/* ... */` comments when saved:
```css
/* ═-═ Disabled section ═-═ 1 disabled */
/* .selector { color: red; } */
```

**Backward compatibility:** The script can read CSS created with older versions that use `[branding-css-sectioner]` (without "JW-") and sections without order tags or disabled flags. When you save, it migrates to the new format automatically.

Anything above the managed marker is preserved as pre-existing content.

---

## Usage

1. Open **Dashboard → General → Branding** — the sectioned editor replaces the default textarea automatically.
2. Use the **+** button to add a new normal section; use the pinned section option for footer-style overrides that should remain at the bottom.
3. Drag sections to reorder them; click a section header to collapse or expand it.
4. Click the **eye icon** to disable/enable a section — disabled sections are commented out when saved but remain editable in the preview.
5. Edit CSS in each section's field — changes are serialised back into Jellyfin's source textarea on every keystroke.
6. Click the normal Jellyfin **Save** button when done — no extra save step required.
7. Export your CSS before major edits if you want an external backup.

---

## How it works

- On load, the script waits for the Dashboard Branding page DOM to be ready.
- It reads the existing content from Jellyfin's hidden `customCss` textarea.
- Content above the managed marker (`/* ═══ [branding-css-sectioner] ═══ */`) is shown as read-only pre-existing CSS.
- Content below the marker is parsed into named section blocks using the `/* ═-═ Name ═-═ index */` format.
- Each section is rendered as a collapsible panel with a Prism.js-highlighted editor.
- Sections can be disabled (eye icon) — disabled sections are commented out in the saved CSS but remain editable in the preview.
- Every edit is serialised back into the hidden source textarea so Jellyfin's native save button picks it up without modification.
- Older marker variants are detected and migrated to the current format on save.

---

## Console logging

The script logs to the browser console with a `[BrandingCssSectioner]` prefix. Open **F12 → Console** to observe it.
