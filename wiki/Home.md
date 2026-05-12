# Jellyfin WIPE Wiki

Jellyfin Web Injected Personal Enhancements is a collection of focused Jellyfin web-client scripts that are meant to be loaded through a trusted injector, preferably Jellyfin Enhanced JS Injector.

This wiki-style section is the organised entry point for the repo.

## Start Here

- Read the install patterns in [Installation-and-Loading.md](Installation-and-Loading.md)
- Browse the full script matrix in [Script-Catalog.md](Script-Catalog.md)
- Check dependency requirements in [Dependencies-and-Compatibility.md](Dependencies-and-Compatibility.md)
- Review the risk model in [Security-and-Risk.md](Security-and-Risk.md)

## Quick Script Guide

| If you want to... | Start with |
|---|---|
| Inspect live streams and activity as an admin | [Activity Monitor](../scripts/activity-monitor/README.md) |
| Make Branding CSS easier to manage | [Branding CSS Sectioner](../scripts/branding-css-sectioner/README.md) |
| See what movies are missing from a collection | [Collection Missing](../scripts/collection-missing/README.md) |
| Show total runtime for a collection | [Collection Runtime](../scripts/collection-runtime/README.md) |
| Show play counts on detail pages | [Play Stats](../scripts/play-stats/README.md) |
| Add rating badges to media cards | [Rating Tag](../scripts/rating-tag/README.md) |

## Repo Philosophy

- Keep scripts small and task-specific.
- Prefer self-hosted assets and trusted loaders.
- Document dependencies clearly.
- Keep admin-facing scripts obviously marked.

## Canonical Repo Layout

The active consolidated repo is `jellyfin-wipe`.
