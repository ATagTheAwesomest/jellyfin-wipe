// Jellyfin Rating Tag Overlay
// Adds content rating badges (PG-13, R, TV-MA, etc.) to media cards.
// Inserts into the card's own scalable image container.

(function () {
    'use strict';

    const LOG_PREFIX = '[RatingTag]';
    const POLL_INTERVAL = 1500;
    const BATCH_SIZE = 10;
    const RATING_CONTAINER_CLASS = 'rating-overlay-container';
    const RATING_LABEL_CLASS = 'rating-overlay-label';

    // Track processed cards to avoid duplicates
    let processedCards = new WeakSet();
    // Batch queue for API requests
    let pendingItems = [];
    let batchTimer = null;

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    function logWarn(...args) {
        console.warn(LOG_PREFIX, ...args);
    }

    function injectStyleOnce() {
        if (document.getElementById('je-rating-tag-style')) return;

        const style = document.createElement('style');
        style.id = 'je-rating-tag-style';
        style.textContent = [
            '.rating-overlay-container {',
            '  z-index: 2;',
            '  transition: opacity 0.15s ease;',
            '  pointer-events: none;',
            '}',
            // Hide badge when card overlay states are active (hover/focus/selected style modes)
            '.card:hover .rating-overlay-container,',
            '.card:focus-within .rating-overlay-container,',
            '.cardBox:hover .rating-overlay-container,',
            '.cardBox:focus-within .rating-overlay-container,',
            '.card.selected .rating-overlay-container,',
            '.cardBox.selected .rating-overlay-container,',
            '.card[data-selected="true"] .rating-overlay-container,',
            '.cardBox[data-selected="true"] .rating-overlay-container {',
            '  opacity: 0 !important;',
            '}',
        ].join('\n');

        document.head.appendChild(style);
    }

    function resetForNavigation() {
        // Reset in-memory state so existing/reused card nodes can be processed again.
        processedCards = new WeakSet();
        pendingItems = [];
        batchTimer = null;

        // Remove existing overlays so they can be reattached after navigation/render cycles.
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
        // Try data-id attribute first
        const dataId = card.getAttribute('data-id');
        if (dataId) {
            log('Found itemId from card data-id:', dataId);
            return dataId;
        }

        // Try to find it in the link href
        const link = card.querySelector('a[href*="id="]');
        if (link) {
            const href = link.getAttribute('href');
            const match = href.match(/[?&]id=([^&]+)/);
            if (match) {
                log('Found itemId from link href:', match[1]);
                return match[1];
            }
        }

        // Try itemAction buttons with data-id
        const actionBtn = card.querySelector('[data-id]');
        if (actionBtn) {
            log('Found itemId from [data-id] child:', actionBtn.getAttribute('data-id'));
            return actionBtn.getAttribute('data-id');
        }

        // Try .cardOverlayButton-br children (as in your sample)
        const overlayBtn = card.querySelector('.cardOverlayButton-br [data-id]');
        if (overlayBtn) {
            log('Found itemId from .cardOverlayButton-br [data-id]:', overlayBtn.getAttribute('data-id'));
            return overlayBtn.getAttribute('data-id');
        }

        logWarn('Could not find itemId for card', card);
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
                insertRatingOverlay(entry.anchor, rating);
            }
        }

        // Process remaining items
        if (pendingItems.length > 0) {
            batchTimer = setTimeout(processBatch, 100);
        }
    }

    function queueForProcessing(anchor, itemId) {
        pendingItems.push({ anchor, itemId });

        if (!batchTimer) {
            batchTimer = setTimeout(() => {
                batchTimer = null;
                processBatch();
            }, 150);
        }
    }

    // ─── Insert Rating Overlay ───────────────────────────────────────────────
    function insertRatingOverlay(anchor, rating) {
        if (anchor.querySelector('.' + RATING_CONTAINER_CLASS)) return;

        if (!anchor.style.position) {
            anchor.style.position = 'relative';
        }

        const container = document.createElement('div');
        container.className = RATING_CONTAINER_CLASS;

        const label = document.createElement('div');
        label.className = RATING_LABEL_CLASS;
        label.setAttribute('data-rating', rating);
        label.textContent = rating;

        // Color coding based on rating
        const ratingColors = {
            // Movies
            'G': '#22c55e',        // green
            'PG': '#84cc16',       // lime
            'PG-13': '#eab308',    // yellow
            'R': '#f97316',        // orange
            'NC-17': '#ef4444',    // red
            'NR': '#6b7280',       // gray
            'UR': '#6b7280',       // gray
            // TV
            'TV-Y': '#22c55e',
            'TV-Y7': '#22c55e',
            'TV-G': '#22c55e',
            'TV-PG': '#84cc16',
            'TV-14': '#eab308',
            'TV-MA': '#ef4444',
        };

        const bgColor = ratingColors[rating] || '#6b7280';

        label.style.cssText = `
            background: ${bgColor};
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.4);
            opacity: 0.7;
        `;

        container.appendChild(label);

        const indicators = anchor.querySelector('.cardIndicators');
        const countIndicator = indicators && indicators.querySelector('.countIndicator');

        if (indicators && countIndicator) {
            indicators.style.display = 'flex';
            indicators.style.alignItems = 'flex-start';
            indicators.style.justifyContent = 'flex-end';
            indicators.style.gap = '6px';

            container.style.cssText = 'position: static; display: inline-flex; align-items: center;';
            indicators.insertBefore(container, countIndicator);
            return;
        }

        container.style.cssText = 'position: absolute; top: 6px; right: 6px;';
        anchor.appendChild(container);
    }

    // ─── Process Card ────────────────────────────────────────────────────────
    function processCard(card) {
        if (processedCards.has(card)) {
            log('Card already processed');
            return;
        }

        const anchor = card.querySelector('.cardScalable');
        if (!anchor) {
            logWarn('No .cardScalable found in card', card);
            return;
        }

        if (anchor.querySelector('.' + RATING_CONTAINER_CLASS)) {
            log('Rating overlay already present');
            return;
        }

        const itemId = getItemIdFromCard(card);
        if (!itemId) {
            logWarn('No itemId found for card', card);
            return;
        }

        processedCards.add(card);
        log('Queueing card for processing, itemId:', itemId);
        queueForProcessing(anchor, itemId);
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
        for (const m of mutations) {
            if (m.addedNodes.length > 0) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1) {
                        if (node.classList && node.classList.contains('card')) {
                            processCard(node);
                        } else if (node.querySelector) {
                            const cards = node.querySelectorAll('.card');
                            if (cards.length > 0) shouldScan = true;
                        }
                    }
                }
            }
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
            // Retry twice to catch delayed card/tag-host rendering after SPA navigation.
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
            injectStyleOnce();
            setTimeout(scanForCards, 1000);
        });
    }

    poll();
    log('Initialized');
})();
