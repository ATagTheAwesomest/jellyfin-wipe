# Jellyfin Rating Tag

A client-side Jellyfin enhancement that adds content rating badges such as `PG-13`, `R`, and `TV-MA` directly onto media cards.

The current implementation mounts into each card's own scalable image container, so it does not rely on Jellyfin Enhanced's tag host feature being enabled.

## Features

- Fetches `OfficialRating` values through the normal Jellyfin API
- Adds a top-right rating badge to movie, episode, and series cards
- Keeps the badge at 70 percent opacity for a softer overlay look
- Detects count-indicator cards and places the rating immediately to the left of the existing count bubble
- Handles SPA navigation and lazy-loaded cards
- Batches requests to avoid hammering the server
- Works whether or not Jellyfin Enhanced's own tag-host overlay is enabled

## Requirements

| Requirement | Notes |
|---|---|
| Jellyfin web client with `ApiClient` available | Standard Jellyfin web sessions expose this |
| A trusted JS injector | Recommended: Jellyfin Enhanced JS Injector |

## Installation

1. Load `rating-tag.js` through your injector.
2. Make sure it is enabled on the pages where media cards render.
3. Hard refresh the Jellyfin web client.
4. Browse a library or home row that contains rated items.

## Behaviour

- Cards with a count bubble keep that bubble in place, and the rating appears just to its left.
- Cards without a count bubble keep the rating in the top-right corner of the image area.
- Hover, focus, and selected states hide the badge so the native card overlay remains clear.

## Customisation

Tweak the constants near the top of `rating-tag.js` to adjust:

- polling interval
- API batch size
- rating colours

## Logging

The script logs with the `[RatingTag]` prefix in the browser console.
