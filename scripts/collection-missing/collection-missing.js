// Jellyfin Collection Missing Titles
// Inject via Jellyfin Enhanced → JavaScript Injector (or any custom JS loader).
//
// On any page that lists BoxSet (collection) cards, a toggle button appears in the
// page controls bar.  When activated, each collection card widens to show a list
// of the movies that are missing from it (sourced through the Jellyfin Enhanced /
// Jellyseerr proxy).  Clicking a missing title opens the Jellyfin Enhanced
// "More Info" overlay so you can request it through Seerr.
//
// Requirements:
//   • Jellyfin Enhanced plugin with a working Jellyseerr integration configured.
//   • window.JellyfinEnhanced must be present (it is after plugin initialises).

(function () {
    'use strict';

    // ─── Constants ───────────────────────────────────────────────────────────
    const LOG_PREFIX     = '[CollectionMissing]';
    const BUTTON_ID      = 'je-collection-missing-btn';
    const COMPLETE_COLOR = '#22c55e'; // green for complete collections
    const POLL_INTERVAL  = 1500;   // ms between SPA navigation checks
    const BATCH_SIZE     = 4;      // concurrent BoxSet API requests

    // ─── State ───────────────────────────────────────────────────────────────
    let isExpanded     = false;
    let buttonInjected = false;
    let lastHash       = '';
    let cardObserver   = null;

    /** WeakSet prevents processing the same card twice at the same time. */
    const inProgress = new WeakSet();

    // ─── Logging ─────────────────────────────────────────────────────────────
    function log(...a)     { console.log(LOG_PREFIX, ...a); }
    function logWarn(...a) { console.warn(LOG_PREFIX, ...a); }

    log('Script loaded');

    // ─── Page helpers ────────────────────────────────────────────────────────
    function getActivePage() {
        return document.querySelector('.page:not(.hide)') || document.body;
    }

    /**
     * Returns true when the current page has at least one BoxSet card visible
     * and is NOT a detail or search page.
     */
    function isCollectionListPage() {
        const hash = window.location.hash;
        if (hash.startsWith('#/details') || hash.startsWith('#/search')) return false;
        const root = getActivePage();
        return !!root.querySelector('.card[data-type="BoxSet"]');
    }

    // ─── Button injection ────────────────────────────────────────────────────
    function injectButton() {
        if (document.getElementById(BUTTON_ID)) return true;

        const root = getActivePage();

        // Try several anchor elements where toolbar buttons normally live.
        // The first one found is used; the new button is inserted after it.
        const anchor =
            root.querySelector('.btnNewCollection') ||
            root.querySelector('.btnFilter')        ||
            root.querySelector('.btnSort')          ||
            root.querySelector('[data-action="sort"]') ||
            root.querySelector('.filterButtonContainer') ||
            root.querySelector('.viewSettingsContainer')  ||
            root.querySelector('.sectionTitleContainer');

        if (!anchor) {
            logWarn('No toolbar anchor found — button not injected yet');
            return false;
        }

        const btn = document.createElement('button');
        btn.id        = BUTTON_ID;
        btn.type      = 'button';
        btn.title     = 'Show missing movies in collections';
        btn.setAttribute('is', 'paper-icon-button-light');
        btn.className = 'paper-icon-button-light';
        btn.innerHTML = '<span class="material-icons">playlist_add_check</span>';
        btn.style.marginLeft = '4px';

        btn.addEventListener('click', () => {
            isExpanded = !isExpanded;
            btn.classList.toggle('je-btn-active', isExpanded);
            btn.title = isExpanded ? 'Hide missing movies' : 'Show missing movies';
            if (isExpanded) {
                expandAll(root);
            } else {
                collapseAll();
            }
        });

        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
        log('Toggle button injected');
        return true;
    }

    // ─── Jellyfin / JE API helpers ───────────────────────────────────────────
    function getApiClient() {
        return window.ApiClient || null;
    }

    function authHeaders(api) {
        return {
            'X-Emby-Token':       api.accessToken(),
            'X-Jellyfin-User-Id': api.getCurrentUserId()
        };
    }

    /**
     * Calls the Jellyfin Enhanced boxset endpoint to get the TMDB collection ID
     * for a given Jellyfin BoxSet item ID.
     * @param {string} jellyfinId
     * @returns {Promise<number|null>}
     */
    async function fetchTmdbCollectionId(jellyfinId) {
        const api = getApiClient();
        if (!api) return null;

        try {
            const url = api.getUrl(`/JellyfinEnhanced/boxset/${jellyfinId}`);
            const resp = await fetch(url, {
                headers: {
                    'X-Emby-Token':       api.accessToken(),
                    'X-Jellyfin-User-Id': api.getCurrentUserId()
                }
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            const id = data && data.tmdbId ? parseInt(data.tmdbId, 10) : null;
            return (id && !isNaN(id)) ? id : null;
        } catch (e) {
            logWarn('fetchTmdbCollectionId failed for', jellyfinId, e);
            return null;
        }
    }

    /**
     * Asks Jellyfin Enhanced (which proxies Jellyseerr) for the collection parts,
     * then filters to only the movies that are NOT fully available (status !== 5).
     *
     * @param {number} tmdbCollectionId
     * @returns {Promise<Array|null>}  null means Seerr is not reachable/configured
     */
    async function fetchMissingMovies(tmdbCollectionId) {
        const JE = window.JellyfinEnhanced;
        if (!JE || !JE.jellyseerrAPI || typeof JE.jellyseerrAPI.fetchCollectionDetails !== 'function') {
            logWarn('JellyfinEnhanced.jellyseerrAPI.fetchCollectionDetails not available');
            return null;
        }

        try {
            const details = await JE.jellyseerrAPI.fetchCollectionDetails(tmdbCollectionId);
            if (!details || !Array.isArray(details.parts)) return [];

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            return details.parts
                .map(m => ({ ...m, mediaType: m.mediaType || 'movie' }))
                .filter(m => {
                    // Exclude unreleased movies (no date, or date is in the future)
                    if (!m.releaseDate) return false;
                    const release = new Date(m.releaseDate);
                    if (isNaN(release.getTime()) || release > today) return false;
                    // Exclude fully available (status 5)
                    return (m.mediaInfo?.status || 1) !== 5;
                })
                .sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''));
        } catch (e) {
            logWarn('fetchMissingMovies failed for TMDB collection', tmdbCollectionId, e);
            return [];
        }
    }

    /**
     * AutoCollections fallback: when Seerr is unavailable, exports the
     * AutoCollections plugin config to find the TitleMatch rule for this
     * collection, then returns library movies that match the rule but are
     * not yet in the BoxSet.
     * @param {string} jellyfinId
     * @returns {Promise<Array|null>}  null = AC not configured / collection not found
     */
    async function fetchMissingFromAutoCollections(jellyfinId) {
        const api = getApiClient();
        if (!api) return null;
        const hdrs = authHeaders(api);

        try {
            // 1. Resolve collection name
            const itemResp = await fetch(api.getUrl(`/Items/${jellyfinId}`), { headers: hdrs });
            if (!itemResp.ok) return null;
            const { Name: collectionName } = await itemResp.json();
            if (!collectionName) return null;

            // 2. Fetch AutoCollections configuration
            const cfgResp = await fetch(api.getUrl('/AutoCollections/ExportConfiguration'), { headers: hdrs });
            if (!cfgResp.ok) return null;
            const config = await cfgResp.json();

            const rule = config.TitleMatchPairs?.find(
                p => p.CollectionName?.toLowerCase() === collectionName.toLowerCase()
            );
            if (!rule) return null; // not a TitleMatch collection

            // 3. Items already in the BoxSet
            const inResp = await fetch(
                api.getUrl('/Items', { ParentId: jellyfinId, IncludeItemTypes: 'Movie', Recursive: true, Limit: 500 }),
                { headers: hdrs }
            );
            const inData = inResp.ok ? await inResp.json() : { Items: [] };
            const inSet  = new Set((inData.Items || []).map(m => m.Id));

            // 4. Library movies matching the title rule
            const srchResp = await fetch(
                api.getUrl('/Items', { searchTerm: rule.TitleMatch, IncludeItemTypes: 'Movie', Recursive: true, Limit: 200 }),
                { headers: hdrs }
            );
            if (!srchResp.ok) return null;
            const { Items: found = [] } = await srchResp.json();

            return found
                .filter(m => !inSet.has(m.Id))
                .map(m => ({
                    id:          m.Id,
                    title:       m.Name,
                    releaseDate: m.PremiereDate || (m.ProductionYear ? `${m.ProductionYear}-01-01` : null),
                    _isLocal:    true
                }));
        } catch (e) {
            logWarn('fetchMissingFromAutoCollections failed', e);
            return null;
        }
    }

    // ─── Card expansion / collapse ───────────────────────────────────────────
    /**
     * Strips all expansion state from a card element.
     * Safe to call at any time, even mid-processing.
     */
    function collapseCard(card) {
        card.classList.remove('je-coll-expanded');
        card.removeAttribute('data-je-missing');
        const box = card.querySelector('.cardBox');
        if (box) {
            box.querySelector('.je-missing-list')?.remove();
        }
    }

    /** Renders a single clickable missing-movie item into listEl. */
    function renderMovieItem(listEl, movie) {
        const { id, title, releaseDate, _isLocal } = movie;
        const displayTitle = title || movie.name || 'Unknown';
        const year = releaseDate ? new Date(releaseDate).getFullYear() : '';

        const item = document.createElement('span');
        item.className   = 'je-missing-item';
        item.textContent = year ? `${displayTitle} (${year})` : displayTitle;
        item.setAttribute('tabindex', '0');
        item.setAttribute('role',      'button');
        item.setAttribute('aria-label', `Show info for ${displayTitle}`);

        const openOverlay = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (_isLocal) {
                window.location.hash = `#/details?id=${id}`;
                return;
            }
            const JE = window.JellyfinEnhanced;
            if (JE?.jellyseerrMoreInfo?.open) {
                JE.jellyseerrMoreInfo.open(id, 'movie');
            } else {
                logWarn('JellyfinEnhanced.jellyseerrMoreInfo.open not available');
            }
        };
        item.addEventListener('click', openOverlay);
        item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openOverlay(e); });
        listEl.appendChild(item);
    }

    /** Renders the full missing-items list (or a ✓ Complete badge) into listEl. */
    function renderMissingItems(listEl, items, indicator) {
        if (items.length === 0) {
            const ok = document.createElement('span');
            ok.className   = 'je-missing-complete';
            ok.textContent = '\u2713 Complete';
            listEl.appendChild(ok);
            indicator?.classList.add('je-complete-indicator');
            return;
        }
        indicator?.classList.remove('je-complete-indicator');
        const header = document.createElement('span');
        header.className   = 'je-missing-header';
        header.textContent = `Missing (${items.length})`;
        listEl.appendChild(header);
        items.forEach(movie => renderMovieItem(listEl, movie));
    }

    /**
     * Fetches and renders missing titles for one BoxSet card.
     * Bails out silently at each await point if isExpanded becomes false.
     * @param {HTMLElement} card
     */
    async function processCard(card) {
        if (!isExpanded)                              return;
        if (inProgress.has(card))                    return;
        if (card.dataset.jeMissing)                  return; // already done
        if (card.getAttribute('data-type') !== 'BoxSet') return;

        const jellyfinId = card.getAttribute('data-id');
        if (!jellyfinId) return;

        inProgress.add(card);

        const cardBox = card.querySelector('.cardBox');
        if (!cardBox) { inProgress.delete(card); return; }

        // Widen the card and show a loading placeholder immediately
        card.classList.add('je-coll-expanded');

        const listEl = document.createElement('div');
        listEl.className = 'je-missing-list';
        listEl.innerHTML = '<span class="je-missing-note">Loading\u2026</span>';
        cardBox.appendChild(listEl);

        try {
            // Step 1: resolve TMDB collection ID
            const tmdbCollectionId = await fetchTmdbCollectionId(jellyfinId);
            if (!isExpanded) { collapseCard(card); return; }

            if (!tmdbCollectionId) {
                listEl.innerHTML = '<span class="je-missing-note">No TMDB link</span>';
                card.dataset.jeMissing = 'done';
                return;
            }

            // Step 2: try Seerr; fall back to AutoCollections if unavailable
            let missing = await fetchMissingMovies(tmdbCollectionId);
            if (!isExpanded) { collapseCard(card); return; }

            if (missing === null) {
                log('Seerr unavailable — trying AutoCollections fallback');
                missing = await fetchMissingFromAutoCollections(jellyfinId);
                if (!isExpanded) { collapseCard(card); return; }
            }

            listEl.innerHTML = '';
            const indicator = card.querySelector('.countIndicator');

            if (missing === null) {
                listEl.innerHTML = '<span class="je-missing-note">Seerr unavailable</span>';
            } else {
                renderMissingItems(listEl, missing, indicator);
            }

            card.dataset.jeMissing = 'done';

        } catch (e) {
            logWarn('Error processing card', jellyfinId, e);
            if (listEl.isConnected) {
                listEl.innerHTML = '<span class="je-missing-note">Error</span>';
            }
        } finally {
            inProgress.delete(card);
        }
    }

    /**
     * Expand all visible BoxSet cards in batches so we don't fire dozens of
     * requests at once against the Jellyfin Enhanced / Seerr endpoints.
     * @param {Element} root
     */
    async function expandAll(root) {
        const cards = Array.from(root.querySelectorAll('.card[data-type="BoxSet"]'));
        log(`Expanding ${cards.length} BoxSet cards`);
        for (let i = 0; i < cards.length; i += BATCH_SIZE) {
            if (!isExpanded) break;
            await Promise.all(cards.slice(i, i + BATCH_SIZE).map(c => processCard(c)));
        }
    }

    /**
     * Collapse all expanded cards across the whole document
     * (handles pages where multiple containers may exist).
     */
    function collapseAll() {
        document.querySelectorAll('.card[data-type="BoxSet"].je-coll-expanded')
                .forEach(collapseCard);
        // Clean up any cards that were only partially processed
        document.querySelectorAll('.je-missing-list').forEach(el => el.remove());
    }

    // ─── MutationObserver — handle infinite-scroll / lazy-loaded cards ───────
    function setupCardObserver() {
        if (cardObserver) cardObserver.disconnect();

        const container = getActivePage().querySelector('.itemsContainer');
        if (!container) return;

        cardObserver = new MutationObserver(mutations => {
            if (!isExpanded) return;
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;

                    // The node itself might be a BoxSet card
                    if (node.matches('.card[data-type="BoxSet"]') && !node.dataset.jeMissing) {
                        processCard(node);
                    }

                    // Or it might be a wrapper containing BoxSet cards
                    node.querySelectorAll?.('.card[data-type="BoxSet"]:not([data-je-missing])')
                        .forEach(c => processCard(c));
                }
            }
        });

        cardObserver.observe(container, { childList: true, subtree: true });
        log('Card observer attached to', container.className);
    }

    // ─── SPA navigation / poll loop ──────────────────────────────────────────
    /**
     * Full teardown called whenever the URL changes.
     * Removes the button, collapses cards, disconnects observer.
     */
    function resetState() {
        isExpanded     = false;
        buttonInjected = false;

        document.getElementById(BUTTON_ID)?.remove();

        if (cardObserver) {
            cardObserver.disconnect();
            cardObserver = null;
        }

        collapseAll();
    }

    /** Called repeatedly to handle SPA navigation and late DOM rendering. */
    function checkAndRender() {
        const hash = window.location.hash;

        if (hash !== lastHash) {
            log('Hash changed:', lastHash, '->', hash);
            lastHash = hash;
            resetState();
        }

        if (!isCollectionListPage()) return;

        if (!buttonInjected) {
            const ok = injectButton();
            if (ok) {
                buttonInjected = true;
                setupCardObserver();
            }
        }
    }

    function startPolling() {
        function tick() {
            checkAndRender();
            setTimeout(tick, POLL_INTERVAL);
        }
        setTimeout(tick, POLL_INTERVAL);
    }

    // ─── Bootstrap ───────────────────────────────────────────────────────────
    startPolling();

    // Run once immediately in case we're already on a collection list page
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(checkAndRender, 800);
    } else {
        document.addEventListener('DOMContentLoaded', () => setTimeout(checkAndRender, 800));
    }

})();
