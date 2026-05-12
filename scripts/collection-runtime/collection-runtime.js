// Jellyfin Collection Total Runtime
// Inject this script into the Jellyfin web client to display total runtime on collection detail pages.
// Works by extracting item IDs from collection cards and fetching runtimes via the Jellyfin API.

(function () {
    'use strict';

    const POLL_INTERVAL = 1500;
    const RUNTIME_ELEMENT_ID = 'collection-total-runtime';
    const ENDSAT_ELEMENT_ID = 'collection-ends-at';
    const LOG_PREFIX = '[CollectionRuntime]';

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    function logWarn(...args) {
        console.warn(LOG_PREFIX, ...args);
    }

    log('Script loaded');

    function getCollectionId() {
        const hash = window.location.hash;
        const match = hash.match(/[?&]id=([^&]+)/);
        return match ? match[1] : null;
    }

    function isCollectionPage() {
        const hash = window.location.hash;
        // Must be on a detail page
        const isDetailPage = hash.startsWith('#/details');
        // The detail page must have the .collectionItems section visible in the current view
        const detailPage = document.querySelector('.page:not(.hide)');
        const hasCollectionItems = detailPage
            ? detailPage.querySelector('.collectionItems') !== null
            : document.querySelector('.collectionItems') !== null;
        const result = isDetailPage && hasCollectionItems;
        log('isCollectionPage:', result, '| isDetailPage:', isDetailPage, '| hasCollectionItems:', hasCollectionItems, '| URL:', hash);
        return result;
    }

    async function fetchCollectionItems(apiClient, collectionId) {
        try {
            const userId = apiClient.getCurrentUserId();
            const serverUrl = apiClient.serverAddress();
            const token = apiClient.accessToken();

            const url = serverUrl + '/Users/' + userId + '/Items'
                + '?ParentId=' + encodeURIComponent(collectionId)
                + '&Fields=RunTimeTicks'
                + '&Limit=10000';

            log('Fetching collection items | URL:', url);
            const response = await fetch(url, {
                headers: {
                    'Authorization': 'MediaBrowser Token="' + token + '"'
                }
            });

            if (!response.ok) {
                logWarn('Failed to fetch collection items | Status:', response.status, response.statusText);
                return null;
            }

            const data = await response.json();
            log('API returned TotalRecordCount:', data.TotalRecordCount, '| Items in response:', data.Items.length);
            return data;
        } catch (e) {
            logWarn('Failed to fetch collection items', e);
            return null;
        }
    }

    function ticksToMinutes(ticks) {
        return Math.floor(ticks / 600000000);
    }

    function formatRuntime(totalMinutes) {
        if (totalMinutes <= 0) return '0m';
        
        const days = Math.floor(totalMinutes / 1440); // 1440 minutes in a day
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        
        let parts = [];
        if (days > 0) parts.push(days + 'd');
        if (hours > 0) parts.push(hours + 'h');
        if (minutes > 0) parts.push(minutes + 'm');
        
        return parts.length > 0 ? parts.join(' ') : '0m';
    }

    function formatEndsAt(totalMinutes) {
        const now = new Date();
        const end = new Date(now.getTime() + totalMinutes * 60000);
        
        // Calculate days difference
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfEndDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        const daysDiff = Math.floor((startOfEndDay - startOfToday) / (1000 * 60 * 60 * 24));
        
        // Format time
        let hours = end.getHours();
        const mins = end.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        const minsStr = mins < 10 ? '0' + mins : '' + mins;
        const timeStr = hours + ':' + minsStr + ' ' + ampm;
        
        // Format date portion based on how far out it is
        if (daysDiff === 0) {
            return 'Ends at ' + timeStr;
        } else if (daysDiff === 1) {
            return 'Ends tomorrow at ' + timeStr;
        } else if (daysDiff < 7) {
            // Show day of week for less than a week
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            return 'Ends ' + days[end.getDay()] + ' at ' + timeStr;
        } else {
            // Show full date for a week or more
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const dateStr = months[end.getMonth()] + ' ' + end.getDate();
            if (end.getFullYear() !== now.getFullYear()) {
                return 'Ends ' + dateStr + ', ' + end.getFullYear() + ' at ' + timeStr;
            }
            return 'Ends ' + dateStr + ' at ' + timeStr;
        }
    }

    function getApiClient() {
        // Jellyfin web client exposes ApiClient globally
        if (window.ApiClient) {
            log('Using window.ApiClient');
            return window.ApiClient;
        }
        // Fallback: try to find it through the Emby namespace
        if (window.Emby && window.Emby.Page && window.Emby.Page.apiClient) {
            log('Using Emby.Page.apiClient (fallback)');
            return window.Emby.Page.apiClient;
        }
        logWarn('ApiClient not found on window or Emby namespace');
        return null;
    }

    function insertRuntimeElement(text) {
        // Remove existing element if present
        const existing = document.getElementById(RUNTIME_ELEMENT_ID);
        if (existing) {
            log('Updating runtime element:', text);
            existing.textContent = text;
            return;
        }

        const header = document.querySelector('.itemMiscInfo.itemMiscInfo-primary');
        if (!header) {
            logWarn('Header .itemMiscInfo-primary not found, cannot insert runtime');
            return;
        }

        // Find the rating element to insert after it
        let insertAfter = header.querySelector('.mediaInfoOfficialRating');
        log('Rating element found:', !!insertAfter);
        if (!insertAfter) {
            // Fallback: find the "X items" element
            const infoItems = header.querySelectorAll('.mediaInfoItem');
            for (let i = 0; i < infoItems.length; i++) {
                const txt = infoItems[i].textContent.trim();
                if (/^\d+\s+items?$/i.test(txt)) {
                    insertAfter = infoItems[i];
                    break;
                }
            }
        }

        const el = document.createElement('div');
        el.id = RUNTIME_ELEMENT_ID;
        el.className = 'mediaInfoItem';
        el.textContent = text;

        if (insertAfter && insertAfter.nextSibling) {
            header.insertBefore(el, insertAfter.nextSibling);
        } else if (insertAfter) {
            header.appendChild(el);
        } else {
            // Fallback: insert as second child (after first mediaInfoItem)
            const first = header.querySelector('.mediaInfoItem');
            if (first && first.nextSibling) {
                header.insertBefore(el, first.nextSibling);
            } else {
                header.appendChild(el);
            }
        }
    }

    function insertEndsAtElement(text) {
        const existing = document.getElementById(ENDSAT_ELEMENT_ID);
        if (existing) {
            log('Updating ends-at element:', text);
            existing.textContent = text;
            return;
        }

        const header = document.querySelector('.itemMiscInfo.itemMiscInfo-primary');
        if (!header) {
            logWarn('Header .itemMiscInfo-primary not found, cannot insert ends-at');
            return;
        }

        // Insert after the runtime element
        const runtimeEl = document.getElementById(RUNTIME_ELEMENT_ID);

        const el = document.createElement('div');
        el.id = ENDSAT_ELEMENT_ID;
        el.className = 'endsAt mediaInfoItem';
        el.textContent = text;

        if (runtimeEl && runtimeEl.nextSibling) {
            header.insertBefore(el, runtimeEl.nextSibling);
        } else if (runtimeEl) {
            header.appendChild(el);
        } else {
            header.appendChild(el);
        }
    }

    async function calculateAndDisplayRuntime() {
        log('calculateAndDisplayRuntime triggered');
        if (!isCollectionPage()) return;

        const collectionId = getCollectionId();
        if (!collectionId) {
            logWarn('Could not determine collection ID from URL');
            return;
        }

        // Don't re-run if already displayed for this collection
        const existing = document.getElementById(RUNTIME_ELEMENT_ID);
        if (existing && existing.getAttribute('data-collection-id') === collectionId) {
            log('Runtime already displayed for collection', collectionId, ', skipping');
            return;
        }

        const apiClient = getApiClient();
        if (!apiClient) {
            logWarn('ApiClient not available, cannot fetch runtimes');
            return;
        }

        log('Fetching collection items from API for collection:', collectionId);
        insertRuntimeElement('Loading...');
        insertEndsAtElement('');

        const data = await fetchCollectionItems(apiClient, collectionId);
        if (!data) {
            insertRuntimeElement('Error');
            return;
        }

        const totalCount = data.TotalRecordCount;
        const items = data.Items;

        log('Collection has', totalCount, 'item(s) total;', items.length, 'fetched');
        if (items.length < totalCount) {
            logWarn('Fetched', items.length, 'of', totalCount, 'items — results may be incomplete');
        }

        // Sum runtimes; stop accumulating once we reach totalCount items
        let counted = 0;
        let totalTicks = 0;
        for (const item of items) {
            if (counted >= totalCount) break;
            totalTicks += item.RunTimeTicks || 0;
            counted++;
        }

        const totalMinutes = ticksToMinutes(totalTicks);
        const formatted = formatRuntime(totalMinutes);
        const endsAt = formatEndsAt(totalMinutes);

        log('--- Results ---');
        log('Total items (from API):', totalCount);
        log('Items counted:', counted);
        log('Total ticks:', totalTicks);
        log('Total minutes:', totalMinutes);
        log('Formatted runtime:', formatted);
        log('Ends at:', endsAt);
        log('---------------');

        insertRuntimeElement(formatted);
        insertEndsAtElement(endsAt);

        // Tag so we don't refetch for the same collection
        const el = document.getElementById(RUNTIME_ELEMENT_ID);
        if (el) el.setAttribute('data-collection-id', collectionId);

        log('Done. Displayed', formatted, 'and', endsAt, 'for', counted, '/', totalCount, 'items');
    }

    // Observe page changes since Jellyfin is a SPA
    let lastHash = '';
    function poll() {
        const currentHash = window.location.hash;
        if (currentHash !== lastHash) {
            log('Hash changed:', lastHash, '->', currentHash);
            lastHash = currentHash;
            // Wait for DOM to settle after navigation
            setTimeout(calculateAndDisplayRuntime, 1000);
        }
        setTimeout(poll, POLL_INTERVAL);
    }

    // Also observe DOM mutations for when collection items load asynchronously
    const observer = new MutationObserver(function (mutations) {
        for (const m of mutations) {
            if (m.addedNodes.length > 0) {
                const hasCollectionItems = document.querySelector('.collectionItems');
                const noRuntime = !document.getElementById(RUNTIME_ELEMENT_ID);
                if (hasCollectionItems && noRuntime) {
                    log('MutationObserver: .collectionItems detected, triggering runtime calculation');
                    setTimeout(calculateAndDisplayRuntime, 500);
                    break;
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial run
    log('Document readyState:', document.readyState);
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        log('DOM ready, scheduling initial run');
        setTimeout(calculateAndDisplayRuntime, 1000);
    } else {
        log('Waiting for DOMContentLoaded');
        document.addEventListener('DOMContentLoaded', function () {
            log('DOMContentLoaded fired, scheduling initial run');
            setTimeout(calculateAndDisplayRuntime, 1000);
        });
    }

    log('Starting hash poll (interval:', POLL_INTERVAL, 'ms)');
    poll();
})();
