// Jellyfin Rating Tag Overlay — JE Edition
// Works alongside Jellyfin Enhanced (JE) plugin.
//
// Injects a .parental-tag element INSIDE JE's existing .genre-overlay-container
// (fallback: .quality-overlay-container).  JE's own corner assignment controls
// where the container sits — we just piggyback on it.
//
// .genre-tag icons are hidden by default so only the parental badge shows.
// Change corner via JE settings; control visibility via Jellyfin custom CSS:
//
//   /* Show genre icons too */
//   .je-tag-host .genre-tag { display: flex !important; }
//
//   /* Hide parental badge */
//   .je-tag-host .parental-tag { display: none !important; }
//
//   /* Show both */
//   .je-tag-host .genre-tag  { display: flex !important; }
//
// Falls back to floating top-right badge if JE tag host is not present.

(function () {
    'use strict';

    const LOG_PREFIX = '[JW-RatingTag-JE]';
    const POLL_INTERVAL = 1500;
    const BATCH_SIZE = 10;
    const RATING_CONTAINER_CLASS = 'parental-tag';

    const RATING_STYLE_GROUPS = [
        {
            key: 'all-audiences',
            ratings: ['G', 'U', 'FSK0', 'TV-Y7'],
            innerColor: '#2E7D32',
            outerColor: '#4CAF50',
        },
        {
            key: 'parental-guidance',
            ratings: ['PG', '12A', 'DE-6'],
            innerColor: 'linear-gradient(135deg, #D4AF37 0%, #D19A00 100%)',
            outerColor: '#FFC107',
        },
        {
            key: 'parents-strongly-cautioned',
            ratings: ['PG-13', '15', 'AU-M'],
            innerColor: '#B25900',
            outerColor: '#FF6F00',
        },
        {
            key: 'mature-accompanied',
            ratings: ['MA15+', 'FR-16'],
            innerColor: '#D50000',
            outerColor: '#FF1744',
        },
        {
            key: 'restricted',
            ratings: ['R', '18', 'DE-18'],
            innerColor: '#8B0000',
            outerColor: '#B71C1C',
        },
        {
            key: 'adults-only',
            ratings: ['NC-17', 'X18+'],
            innerColor: '#880E4F',
            outerColor: '#C2185B',
        },
        {
            key: 'special-categories',
            ratings: ['S'],
            innerColor: '#4A148C',
            outerColor: '#7B1FA2',
        },
        {
            key: 'educational-exempt',
            ratings: ['EDU', 'EXEMPT'],
            innerColor: '#0D47A1',
            outerColor: '#1976D2',
        },
        {
            key: 'unrated-unknown',
            ratings: ['UNRATED', 'NR', 'UR'],
            innerColor: '#424242',
            outerColor: '#757575',
        },
    ];

    const DEFAULT_RATING_STYLE = {
        innerColor: '#424242',
        outerColor: '#757575',
    };

    const RATING_STYLE_MAP = buildRatingStyleMap();

    let processedCards = new WeakSet();
    // Cards that received the cardScalable fallback badge (JE not loaded yet).
    // When JE containers appear later, upgradeFallbackCard() moves the badge.
    let fallbackCards = new WeakSet();
    // itemId → rating; survives JE reinitialiseGenreTags() container wipe.
    const ratingCache = new Map();
    let pendingItems = [];
    let batchTimer = null;

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    function logWarn(...args) {
        console.warn(LOG_PREFIX, ...args);
    }

    function normalizeRatingKey(rating) {
        return String(rating || '').trim().toUpperCase().replace(/\s+/g, '');
    }

    function buildRatingStyleMap() {
        const map = {};
        for (const group of RATING_STYLE_GROUPS) {
            for (const rating of group.ratings) {
                map[normalizeRatingKey(rating)] = {
                    innerColor: group.innerColor,
                    outerColor: group.outerColor,
                };
            }
        }

        map['TV-Y'] = map['G'] || DEFAULT_RATING_STYLE;
        map['TV-G'] = map['G'] || DEFAULT_RATING_STYLE;
        map['TV-PG'] = map['PG'] || DEFAULT_RATING_STYLE;
        map['TV-14'] = map['PG-13'] || DEFAULT_RATING_STYLE;
        map['TV-MA'] = map['MA15+'] || DEFAULT_RATING_STYLE;

        return map;
    }

    function getRatingStyle(rating) {
        return RATING_STYLE_MAP[normalizeRatingKey(rating)] || DEFAULT_RATING_STYLE;
    }

    function injectStyleOnce() {
        if (document.getElementById('je-rating-tag-je-style')) return;

        const style = document.createElement('style');
        style.id = 'je-rating-tag-je-style';
        style.textContent = [
            // ── Hide genre icon tags; keep container (JE positions its corner) ─
            '.je-tag-host .genre-tag {',
            '  display: none;',
            '}',

            // ── Parental rating badge (lives inside .genre-overlay-container) ──
            '.parental-tag {',
            '  background: var(--rating-inner-color, #424242);',
            '  color: #ffffff;',
            '  border: 2px solid var(--rating-outer-color, #757575);',
            '  padding: 2px 6px;',
            '  border-radius: 4px;',
            '  font-size: 11px;',
            '  font-weight: 700;',
            '  text-transform: uppercase;',
            '  letter-spacing: 0.5px;',
            '  box-shadow: 0 1px 3px rgba(0,0,0,0.4);',
            '  opacity: 0.7;',
            '  pointer-events: none;',
            '  flex-shrink: 0;',
            '}',

            // ── Fallback: floating badge directly on .cardScalable ────────────
            '.cardScalable > .parental-tag {',
            '  z-index: 2;',
            '  position: absolute;',
            '  top: 6px;',
            '  right: 6px;',
            '}',

            // ── Hide on hover / focus / selected ─────────────────────────────
            '.card:hover .parental-tag,',
            '.card:focus-within .parental-tag,',
            '.cardBox:hover .parental-tag,',
            '.cardBox:focus-within .parental-tag,',
            '.card.selected .parental-tag,',
            '.cardBox.selected .parental-tag,',
            '.card[data-selected="true"] .parental-tag,',
            '.cardBox[data-selected="true"] .parental-tag {',
            '  opacity: 0 !important;',
            '}',
        ].join('\n');

        document.head.appendChild(style);
    }

    function resetForNavigation() {
        processedCards = new WeakSet();
        fallbackCards = new WeakSet();
        ratingCache.clear();
        pendingItems = [];
        if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }

        const existing = document.querySelectorAll('.' + RATING_CONTAINER_CLASS);
        for (const node of existing) {
            node.remove();
        }
    }

    log('Script loaded');

    // ─── API Client ──────────────────────────────────────────────────────────
    function getApiClient() {
        if (window.ApiClient) return window.ApiClient;
        if (window.Emby && window.Emby.Page && window.Emby.Page.apiClient) {
            return window.Emby.Page.apiClient;
        }
        return null;
    }

    // ─── Extract Item ID from Card ───────────────────────────────────────────
    function getItemIdFromCard(card) {
        const dataId = card.getAttribute('data-id');
        if (dataId) return dataId;

        const link = card.querySelector('a[href*="id="]');
        if (link) {
            const href = link.getAttribute('href');
            const match = href.match(/[?&]id=([^&]+)/);
            if (match) return match[1];
        }

        const actionBtn = card.querySelector('[data-id]');
        if (actionBtn) return actionBtn.getAttribute('data-id');

        const overlayBtn = card.querySelector('.cardOverlayButton-br [data-id]');
        if (overlayBtn) return overlayBtn.getAttribute('data-id');

        return null;
    }

    // ─── Fetch Items with Ratings ────────────────────────────────────────────
    async function fetchItemsRatings(itemIds) {
        const apiClient = getApiClient();
        if (!apiClient) {
            logWarn('ApiClient not available');
            return {};
        }

        try {
            const userId = apiClient.getCurrentUserId();
            const serverUrl = apiClient.serverAddress();
            const token = apiClient.accessToken();

            const url = serverUrl + '/Users/' + userId + '/Items'
                + '?Ids=' + itemIds.join(',')
                + '&Fields=OfficialRating';

            const response = await fetch(url, {
                headers: {
                    'Authorization': 'MediaBrowser Token="' + token + '"'
                }
            });

            if (!response.ok) {
                logWarn('Failed to fetch items:', response.status);
                return {};
            }

            const data = await response.json();
            const ratingMap = {};
            for (const item of data.Items) {
                if (item.OfficialRating) {
                    ratingMap[item.Id] = item.OfficialRating;
                }
            }
            return ratingMap;
        } catch (e) {
            logWarn('Error fetching ratings:', e);
            return {};
        }
    }

    // ─── Process Batch ───────────────────────────────────────────────────────
    async function processBatch() {
        if (pendingItems.length === 0) return;

        const batch = pendingItems.splice(0, BATCH_SIZE);
        const itemIds = batch.map(entry => entry.itemId);

        log('Fetching ratings for', itemIds.length, 'items');
        const ratingMap = await fetchItemsRatings(itemIds);

        for (const entry of batch) {
            const rating = ratingMap[entry.itemId];
            if (rating) {
                insertRatingOverlay(entry.card, rating);
            }
        }

        if (pendingItems.length > 0) {
            batchTimer = setTimeout(processBatch, 100);
        }
    }

    function queueForProcessing(card, itemId) {
        pendingItems.push({ card, itemId });

        if (!batchTimer) {
            batchTimer = setTimeout(() => {
                batchTimer = null;
                processBatch();
            }, 150);
        }
    }

    function shouldSkipCard(card) {
        if (!card.classList) return false;
        if (card.classList.contains('chapterCard')) return true;
        if (card.classList.contains('jellyseerr-card')) return true;
        if (card.closest('#scenesCollapsible') || card.closest('#scenesContent')) return true;
        if (card.querySelector('a[href*="dashboard/users"]')) return true;
        return false;
    }

    // ─── Upgrade Fallback Card ───────────────────────────────────────────────
    // Called when JE containers appear in a card that previously got a fallback badge.
    function upgradeFallbackCard(card) {
        // Read cached rating from existing fallback badge before removing it.
        const existing = card.querySelector('.' + RATING_CONTAINER_CLASS);
        const cachedRating = existing ? existing.getAttribute('data-rating') : null;
        if (existing) existing.remove();

        processedCards.delete(card);
        fallbackCards.delete(card);

        if (cachedRating) {
            // Re-inject without an extra API call.
            insertRatingOverlay(card, cachedRating);
            // If we landed in JE container this time, lock it as done.
            // If JE containers still aren't fully rendered, fallbackCards gets
            // the card again and the next container mutation will retry.
            if (!fallbackCards.has(card)) {
                processedCards.add(card);
            }
        } else {
            // No cached rating (badge was already gone) — full re-process.
            processCard(card);
        }
    }

    // ─── Reinject From Cache ─────────────────────────────────────────────────
    // Called when JE rebuilds its containers for an already-processed card
    // (e.g. user moves the genre corner in JE settings).
    // JE's reinitializeGenreTags() wipes all .genre-overlay-container nodes,
    // taking our badge with them, then creates fresh ones.  We re-inject from
    // the cached rating so no extra API call is needed.
    function reinjectFromCache(card) {
        const itemId = getItemIdFromCard(card);
        if (!itemId) return;
        const cachedRating = ratingCache.get(itemId);
        if (!cachedRating) return;

        // Remove any stale badge that may still be floating in the card.
        const stale = card.querySelector('.' + RATING_CONTAINER_CLASS);
        if (stale) stale.remove();

        processedCards.delete(card);
        insertRatingOverlay(card, cachedRating);
        if (!fallbackCards.has(card)) {
            processedCards.add(card);
        }
    }

    // ─── JE Panel: Badge / Genre Mode Toggle ──────────────────────────────
    // When the JE settings panel opens we inject a 3-way toggle beneath the
    // "Show Genre Tags" row so the user can switch between:
    //   rating  — parental badge only  (default, no custom CSS needed)
    //   both    — badge + genre icons visible simultaneously
    //   genres  — genre icons only, badge hidden
    //
    // Chosen mode is persisted in the current user's DisplayPreferences
    // CustomPrefs dictionary under key "jw-rating-mode".  No admin rights
    // required; each user can have their own preference.
    // The live page style is also updated immediately (no reload required).

    const JW_PREF_KEY = 'jw-rating-mode';

    function getStoredMode(prefs) {
        const val = prefs && prefs.CustomPrefs && prefs.CustomPrefs[JW_PREF_KEY];
        return (val === 'both' || val === 'genres') ? val : 'rating';
    }

    function applyModeStyle(mode) {
        const id = 'je-rating-tag-je-mode-style';
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('style');
            el.id = id;
            document.head.appendChild(el);
        }
        if (mode === 'both') {
            el.textContent = '.je-tag-host .genre-tag { display: flex !important; }';
        } else if (mode === 'genres') {
            el.textContent = '.je-tag-host .genre-tag { display: flex !important; }\n.je-tag-host .parental-tag { display: none !important; }';
        } else {
            el.textContent = ''; // base style hides genre-tag by default
        }
    }

    async function getDisplayPrefs() {
        const apiClient = getApiClient();
        if (!apiClient) return null;
        try {
            const userId = apiClient.getCurrentUserId();
            const resp = await fetch(
                apiClient.serverAddress() + '/DisplayPreferences/usersettings?userId=' + userId + '&client=emby',
                { headers: { 'Authorization': 'MediaBrowser Token="' + apiClient.accessToken() + '"' } }
            );
            return resp.ok ? resp.json() : null;
        } catch { return null; }
    }

    async function saveDisplayMode(mode) {
        const apiClient = getApiClient();
        if (!apiClient) return false;
        try {
            const userId = apiClient.getCurrentUserId();
            const prefs = await getDisplayPrefs();
            if (!prefs) return false;
            if (!prefs.CustomPrefs) prefs.CustomPrefs = {};
            if (mode === 'rating') {
                delete prefs.CustomPrefs[JW_PREF_KEY];
            } else {
                prefs.CustomPrefs[JW_PREF_KEY] = mode;
            }
            const resp = await fetch(
                apiClient.serverAddress() + '/DisplayPreferences/usersettings?userId=' + userId + '&client=emby',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': 'MediaBrowser Token="' + apiClient.accessToken() + '"',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(prefs),
                }
            );
            return resp.ok;
        } catch { return false; }
    }

    function injectJEPanelToggle(panel) {
        const genreToggle = panel.querySelector('#genreTagsToggle');
        if (!genreToggle) return;
        const row = genreToggle.closest('[style*="border-left"]');
        if (!row || row.querySelector('.jw-rt-toggle')) return;

        getDisplayPrefs().then(function(prefs) {
            let mode = getStoredMode(prefs);

            const wrap = document.createElement('div');
            wrap.className = 'jw-rt-toggle';
            wrap.style.cssText = 'display:flex; align-items:center; gap:6px; margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.1);';

            const lbl = document.createElement('span');
            lbl.style.cssText = 'font-size:11px; flex-shrink:0; white-space:nowrap;';
            const _lblR = document.createElement('span');
            _lblR.textContent = 'Rating';
            _lblR.style.cssText = 'color:#00A4DC; font-weight:700;';
            const _lblS = document.createElement('span');
            _lblS.textContent = ' / Genre';
            _lblS.style.cssText = 'color:rgba(255,255,255,0.45);';
            lbl.appendChild(_lblR);
            lbl.appendChild(_lblS);
            wrap.appendChild(lbl);

            const MODES = [
                { key: 'rating', label: 'Rating' },
                { key: 'both',   label: 'Both'   },
                { key: 'genres', label: 'Genres' },
            ];

            function refreshButtons() {
                wrap.querySelectorAll('.jw-rt-btn').forEach(function(b) {
                    const on = b.dataset.mode === mode;
                    b.style.background   = on ? '#00A4DC' : 'rgba(255,255,255,0.08)';
                    b.style.color        = on ? '#fff'    : 'rgba(255,255,255,0.5)';
                    b.style.borderColor  = on ? '#00A4DC' : 'rgba(255,255,255,0.15)';
                    b.style.fontWeight   = on ? '600'     : '400';
                });
            }

            MODES.forEach(function(m) {
                const btn = document.createElement('button');
                btn.className = 'jw-rt-btn';
                btn.dataset.mode = m.key;
                btn.textContent  = m.label;
                btn.style.cssText = 'font-family:inherit; font-size:11px; padding:3px 10px; border-radius:4px; border:1px solid transparent; cursor:pointer; transition:all 0.15s; flex:1;';
                btn.addEventListener('click', function() {
                    const prev = mode;
                    mode = m.key;
                    refreshButtons();
                    applyModeStyle(mode);
                    saveDisplayMode(mode).then(function(ok) {
                        if (!ok) {
                            logWarn('Failed to save display mode; reverting');
                            mode = prev;
                            refreshButtons();
                            applyModeStyle(mode);
                        }
                    });
                });
                wrap.appendChild(btn);
            });

            refreshButtons();
            row.appendChild(wrap);
        });
    }

    // ─── Insert Rating Overlay ───────────────────────────────────────────────
    function insertRatingOverlay(card, rating) {
        // Cache so we can re-inject without an API call if JE rebuilds containers.
        const _itemId = getItemIdFromCard(card);
        if (_itemId) ratingCache.set(_itemId, rating);

        function makeTag() {
            const tag = document.createElement('div');
            tag.className = RATING_CONTAINER_CLASS;
            tag.setAttribute('data-rating', rating);
            tag.textContent = rating;
            const styleToken = getRatingStyle(rating);
            tag.style.setProperty('--rating-inner-color', styleToken.innerColor);
            tag.style.setProperty('--rating-outer-color', styleToken.outerColor);
            return tag;
        }

        // ── Path 1: inject inside JE's already-positioned container ──────────
        const tagHost = card.querySelector('.je-tag-host');
        if (tagHost) {
            const target = tagHost.querySelector('.genre-overlay-container')
                        || tagHost.querySelector('.quality-overlay-container');
            if (target) {
                if (target.querySelector('.' + RATING_CONTAINER_CLASS)) return;
                target.insertBefore(makeTag(), target.firstChild);
                return;
            }
        }

        // ── Path 2: Fallback — floating badge on cardScalable ────────────────
        const anchor = card.querySelector('.cardScalable');
        if (!anchor) {
            logWarn('No JE genre/quality container or .cardScalable found in card');
            return;
        }

        if (anchor.querySelector('.' + RATING_CONTAINER_CLASS)) return;

        if (!anchor.style.position) {
            anchor.style.position = 'relative';
        }

        // Mark so the MutationObserver can upgrade this card when JE loads later.
        fallbackCards.add(card);
        const tag = makeTag();

        const indicators = anchor.querySelector('.cardIndicators');
        const countIndicator = indicators && indicators.querySelector('.countIndicator');

        if (indicators && countIndicator) {
            indicators.style.display = 'flex';
            indicators.style.alignItems = 'flex-start';
            indicators.style.justifyContent = 'flex-end';
            indicators.style.gap = '6px';
            tag.style.position = 'static';
            tag.style.display = 'inline-flex';
            tag.style.alignItems = 'center';
            indicators.insertBefore(tag, countIndicator);
            return;
        }

        anchor.appendChild(tag);
    }

    // ─── Process Card ────────────────────────────────────────────────────────
    function processCard(card) {
        if (processedCards.has(card)) return;

        if (shouldSkipCard(card)) {
            const existingOverlay = card.querySelector('.' + RATING_CONTAINER_CLASS);
            if (existingOverlay) existingOverlay.remove();
            processedCards.add(card);
            return;
        }

        const hasAnchor = card.querySelector('.je-tag-host') || card.querySelector('.cardScalable');
        if (!hasAnchor) return; // non-media card (person, trailer header, etc.)

        const itemId = getItemIdFromCard(card);
        if (!itemId) {
            logWarn('No itemId found for card', card);
            return;
        }

        processedCards.add(card);
        queueForProcessing(card, itemId);
    }

    // ─── Scan Page for Cards ─────────────────────────────────────────────────
    function scanForCards() {
        const cards = document.querySelectorAll('.card');
        for (const card of cards) {
            processCard(card);
        }
    }

    // ─── Mutation Observer ───────────────────────────────────────────────────
    const observer = new MutationObserver(function (mutations) {
        let shouldScan = false;
        const cardsToUpgrade = new Set();   // fallback → JE container just appeared
        const cardsToReinject = new Set();  // JE reinit → container rebuilt

        for (const m of mutations) {
            if (m.addedNodes.length > 0) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;

                    if (node.classList && node.classList.contains('card')) {
                        processCard(node);
                    } else {
                        // JE settings panel opened → inject badge/genre toggle
                        if (node.id === 'jellyfin-enhanced-panel') {
                            injectJEPanelToggle(node);
                        }

                        if (node.classList &&
                            (node.classList.contains('je-tag-host') ||
                             node.classList.contains('genre-overlay-container') ||
                             node.classList.contains('quality-overlay-container'))) {
                            const card = node.closest('.card');
                            if (card) {
                                if (fallbackCards.has(card)) {
                                    // JE loaded after our fallback badge was placed.
                                    cardsToUpgrade.add(card);
                                } else if (processedCards.has(card)) {
                                    // JE rebuilt the container (corner change / re-init).
                                    // Our badge was inside the old container and is now gone.
                                    cardsToReinject.add(card);
                                }
                            }
                        }

                        if (node.querySelector) {
                            const cards = node.querySelectorAll('.card');
                            if (cards.length > 0) shouldScan = true;
                        }
                    }
                }
            }
        }

        for (const card of cardsToUpgrade) {
            upgradeFallbackCard(card);
        }
        for (const card of cardsToReinject) {
            reinjectFromCache(card);
        }

        if (shouldScan) {
            setTimeout(scanForCards, 200);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // ─── Hash Change Detection (SPA navigation) ─────────────────────────────
    let lastHash = '';
    function poll() {
        const currentHash = window.location.hash;
        if (currentHash !== lastHash) {
            log('Hash changed:', lastHash, '->', currentHash);
            lastHash = currentHash;
            resetForNavigation();
            setTimeout(scanForCards, 500);
            setTimeout(scanForCards, 1500);
        }
        setTimeout(poll, POLL_INTERVAL);
    }

    // ─── Initialize ──────────────────────────────────────────────────────────
    injectStyleOnce();

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(scanForCards, 1000);
    } else {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(scanForCards, 1000);
        });
    }

    poll();

    // Apply saved display mode from user display preferences (async; page shown with default meanwhile)
    getDisplayPrefs().then(function(prefs) {
        applyModeStyle(getStoredMode(prefs));
    });

    // Handle case where JE panel was already in DOM before this script loaded
    const _existingPanel = document.querySelector('#jellyfin-enhanced-panel');
    if (_existingPanel) injectJEPanelToggle(_existingPanel);

    log('Initialized');
})();
