// Jellyfin Play Stats
// Inject this script into the Jellyfin web client to display runtime-weighted play stats on media detail pages.
// Queries the Playback Reporting Plugin API (/user_usage_stats/submit_custom_query).
// Hover over the badge to see a per-user pie chart breakdown weighted by watch time.

(function () {
    'use strict';

    const POLL_INTERVAL = 1500;
    const BADGE_ID = 'item-play-stats-badge';
    const POPUP_ID = 'item-play-stats-popup';
    const LOG_PREFIX = '[JW-PlayStats]';

    function colorFromName(name) {
        // Normalize: strip non-alpha chars, lowercase
        const key = name.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'x';
        // Simple djb2-style hash
        let hash = 5381;
        for (let i = 0; i < key.length; i++) {
            hash = ((hash << 5) + hash) ^ key.charCodeAt(i);
            hash = hash >>> 0; // keep 32-bit unsigned
        }
        // Map to a hue, fix saturation/lightness to keep colors vivid but not harsh
        const hue = hash % 360;
        return 'hsl(' + hue + ',60%,62%)';
    }

    function log(...args) { console.log(LOG_PREFIX, ...args); }
    function logWarn(...args) { console.warn(LOG_PREFIX, ...args); }

    log('Script loaded');

    // ─── Helpers ────────────────────────────────────────────────────────────────

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getApiClient() {
        if (window.ApiClient) return window.ApiClient;
        if (window.Emby && window.Emby.Page && window.Emby.Page.apiClient) return window.Emby.Page.apiClient;
        logWarn('ApiClient not found');
        return null;
    }

    function getActivePage() {
        return document.querySelector('.page:not(.hide)') || document.body;
    }

    function getActiveHeader() {
        return getActivePage().querySelector('.itemMiscInfo.itemMiscInfo-primary');
    }

    function getActiveBadge() {
        return getActivePage().querySelector('#' + BADGE_ID);
    }

    function isMediaDetailPage() {
        const hash = window.location.hash;
        if (!hash.startsWith('#/details')) return false;
        return getActivePage().querySelector('.itemMiscInfo') !== null;
    }

    function getItemId() {
        const match = window.location.hash.match(/[?&]id=([a-f0-9-]+)/i);
        return match ? match[1] : null;
    }

    function formatDuration(totalSeconds) {
        const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;

        if (h > 0) {
            return h + 'h ' + String(m).padStart(2, '0') + 'm';
        }
        if (m > 0) {
            return m + 'm ' + String(sec).padStart(2, '0') + 's';
        }
        return sec + 's';
    }

    function formatEquivalentPlays(value) {
        const n = Number(value) || 0;
        if (n >= 10) return n.toFixed(1);
        return n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    }

    // Playback Reporting setups vary: some store seconds, some milliseconds, some ticks.
    function normalizeDurationToSeconds(rawDuration, runtimeSeconds) {
        const raw = Number(rawDuration);
        if (!Number.isFinite(raw) || raw <= 0) return 0;

        const sec = raw;
        const ms = raw / 1000;
        const ticks = raw / 10000000;

        if (!runtimeSeconds || runtimeSeconds <= 0) {
            if (raw > 1e9) return ticks;
            if (raw > 1e6) return ms;
            return sec;
        }

        const maxReasonableEquivalent = 50;
        const secEq = sec / runtimeSeconds;
        const msEq = ms / runtimeSeconds;
        const ticksEq = ticks / runtimeSeconds;

        const secReasonable = secEq <= maxReasonableEquivalent;
        const msReasonable = msEq <= maxReasonableEquivalent;
        const ticksReasonable = ticksEq <= maxReasonableEquivalent;

        if (secReasonable) return sec;
        if (msReasonable) return ms;
        if (ticksReasonable) return ticks;

        if (Math.abs(msEq - 1) < Math.abs(secEq - 1)) return ms;
        if (Math.abs(ticksEq - 1) < Math.abs(secEq - 1)) return ticks;
        return sec;
    }

    // Only allow hex characters and hyphens — guards against injection via tampered URLs
    function isValidItemId(id) {
        return id && /^[0-9a-f-]+$/i.test(id);
    }

    // ─── API ─────────────────────────────────────────────────────────────────────

    async function queryPlaybackReporting(apiClient, itemId) {
        const serverUrl = apiClient.serverAddress();
        const token = apiClient.accessToken();

        // Sanitize to hex + hyphens only before embedding in SQL
        const safeId = itemId.replace(/[^0-9a-fA-F-]/g, '');

        const sql = `SELECT UserId, COUNT(*) as PlayCount, COALESCE(SUM(PlayDuration), 0) as TotalPlayDuration FROM PlaybackActivity WHERE ItemId = '${safeId}' GROUP BY UserId ORDER BY TotalPlayDuration DESC, PlayCount DESC`;
        log('SQL:', sql);

        try {
            const res = await fetch(serverUrl + '/user_usage_stats/submit_custom_query', {
                method: 'POST',
                headers: {
                    'Authorization': 'MediaBrowser Token="' + token + '"',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ CustomQueryString: sql, ReplaceUserId: false })
            });

            if (!res.ok) {
                logWarn('Playback Reporting API returned', res.status, res.statusText);
                return null;
            }

            return await res.json();
        } catch (e) {
            logWarn('Error querying Playback Reporting Plugin:', e);
            return null;
        }
    }

    async function fetchUserNames(apiClient) {
        const serverUrl = apiClient.serverAddress();
        const token = apiClient.accessToken();

        try {
            const res = await fetch(serverUrl + '/Users', {
                headers: { 'Authorization': 'MediaBrowser Token="' + token + '"' }
            });
            if (!res.ok) return {};
            const users = await res.json();
            const map = {};
            users.forEach(function (u) { map[u.Id.toLowerCase()] = u.Name; });
            return map;
        } catch (e) {
            logWarn('Failed to fetch user list:', e);
            return {};
        }
    }

    async function fetchItemRuntimeSeconds(apiClient, itemId) {
        const serverUrl = apiClient.serverAddress();
        const token = apiClient.accessToken();
        const currentUserId = typeof apiClient.getCurrentUserId === 'function' ? apiClient.getCurrentUserId() : null;

        const basePath = currentUserId
            ? '/Users/' + encodeURIComponent(currentUserId) + '/Items/' + encodeURIComponent(itemId)
            : '/Items/' + encodeURIComponent(itemId);

        try {
            const res = await fetch(serverUrl + basePath + '?Fields=RunTimeTicks', {
                headers: { 'Authorization': 'MediaBrowser Token="' + token + '"' }
            });

            if (!res.ok) {
                logWarn('Failed to fetch item runtime:', res.status, res.statusText);
                return 0;
            }

            const item = await res.json();
            const runTimeTicks = Number(item.RunTimeTicks || 0);
            if (!Number.isFinite(runTimeTicks) || runTimeTicks <= 0) return 0;
            return runTimeTicks / 10000000;
        } catch (e) {
            logWarn('Failed to fetch item runtime:', e);
            return 0;
        }
    }

    function parseStats(data, userNames, runtimeSeconds) {
        // Plugin has a typo — "colums" — but handle both spellings
        const columns = (data.colums || data.columns || []).map(function (c) { return c.toLowerCase(); });
        const results = data.results || [];

        const userIdIdx = columns.indexOf('userid');
        const countIdx = columns.indexOf('playcount');
        const durationIdx = columns.indexOf('totalplayduration') !== -1
            ? columns.indexOf('totalplayduration')
            : columns.indexOf('playduration');

        if (userIdIdx === -1 || countIdx === -1) {
            log('No play data returned from API.');
            return [];
        }

        return results
            .map(function (row) {
                const userId = (row[userIdIdx] || '').toLowerCase();
                const count = parseInt(row[countIdx], 10) || 0;
                const rawDuration = durationIdx !== -1 ? row[durationIdx] : 0;
                const durationSec = durationIdx !== -1
                    ? normalizeDurationToSeconds(rawDuration, runtimeSeconds)
                    : (runtimeSeconds > 0 ? count * runtimeSeconds : 0);
                const equivalentPlays = runtimeSeconds > 0 ? (durationSec / runtimeSeconds) : count;
                const name = userNames[userId] || (userId.substring(0, 8) + '…');
                return { userId, name, count, durationSec, equivalentPlays };
            })
            .filter(function (s) { return s.equivalentPlays > 0 || s.count > 0; });
    }

    // ─── Pie Chart ───────────────────────────────────────────────────────────────

    function buildPopupHTML(stats) {
        const totalEquivalent = stats.reduce(function (s, x) { return s + x.equivalentPlays; }, 0);
        const totalDuration = stats.reduce(function (s, x) { return s + x.durationSec; }, 0);

        if (totalEquivalent === 0) {
            return '<p style="color:#aaa;margin:0;font-size:13px">No plays recorded yet.</p>';
        }

        const size = 130;
        const cx = size / 2;
        const cy = size / 2;
        const r = cx - 8;

        let svgContent = '';

        if (stats.length === 1) {
            // Single user — full circle, no arc math needed
            svgContent = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + colorFromName(stats[0].name) + '" />';
        } else {
            let startAngle = -Math.PI / 2;
            stats.forEach(function (s, i) {
                const color = colorFromName(s.name);
                const fraction = s.equivalentPlays / totalEquivalent;
                const endAngle = startAngle + fraction * 2 * Math.PI;

                const x1 = (cx + r * Math.cos(startAngle)).toFixed(2);
                const y1 = (cy + r * Math.sin(startAngle)).toFixed(2);
                const x2 = (cx + r * Math.cos(endAngle)).toFixed(2);
                const y2 = (cy + r * Math.sin(endAngle)).toFixed(2);
                const largeArc = fraction > 0.5 ? 1 : 0;

                svgContent += '<path d="M ' + cx + ' ' + cy +
                    ' L ' + x1 + ' ' + y1 +
                    ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + x2 + ' ' + y2 +
                    ' Z" fill="' + color + '" stroke="#1c1c26" stroke-width="1.5" />';

                startAngle = endAngle;
            });
        }

        let legendHtml = '';
        stats.forEach(function (s, i) {
            const color = colorFromName(s.name);
            const pct = Math.round((s.equivalentPlays / totalEquivalent) * 100);
            legendHtml +=
                '<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">' +
                '<div style="width:10px;height:10px;border-radius:2px;background:' + color + ';flex-shrink:0"></div>' +
                '<span style="font-size:12px;color:#ddd;white-space:nowrap">' +
                escapeHtml(s.name) + ': ' + formatEquivalentPlays(s.equivalentPlays) + 'x' +
                ' <span style="color:#aaa">(' + formatDuration(s.durationSec) + ', ' + s.count + ' start' + (s.count !== 1 ? 's' : '') + ')</span>' +
                ' <span style="color:#888">(' + pct + '%)</span>' +
                '</span>' +
                '</div>';
        });

        return '<div style="display:flex;gap:16px;align-items:center">' +
            '<div style="flex-shrink:0">' +
            '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
            svgContent + '</svg>' +
            '</div>' +
            '<div style="flex:1;min-width:130px">' +
            legendHtml +
            '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #3a3a4a;font-size:12px;color:#aaa">' +
                'Total: <strong style="color:#ddd">' + formatEquivalentPlays(totalEquivalent) + 'x plays</strong>' +
                ' <span style="color:#888">(' + formatDuration(totalDuration) + ' watched)</span>' +
            '</div>' +
            '</div>' +
            '</div>';
    }

    // ─── Popup ───────────────────────────────────────────────────────────────────

    function removePopup() {
        const p = document.getElementById(POPUP_ID);
        if (p) p.remove();
    }

    function showPopup(anchorEl, stats) {
        removePopup();

        const popup = document.createElement('div');
        popup.id = POPUP_ID;

        Object.assign(popup.style, {
            position: 'fixed',
            zIndex: '99999',
            background: 'rgba(24,24,36,0.97)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: '10px',
            padding: '16px',
            boxShadow: '0 8px 36px rgba(0,0,0,0.65)',
            backdropFilter: 'blur(10px)',
            pointerEvents: 'none',
            minWidth: '280px',
            maxWidth: '420px',
            fontFamily: 'inherit'
        });

        popup.innerHTML =
            '<div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:12px;letter-spacing:0.02em">Play History</div>' +
            buildPopupHTML(stats);

        document.body.appendChild(popup);

        // Position below the anchor, clamped to viewport
        const rect = anchorEl.getBoundingClientRect();
        const pw = popup.offsetWidth;
        const ph = popup.offsetHeight;

        let top = rect.bottom + 8;
        let left = rect.left;

        if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
        if (top + ph > window.innerHeight - 12) top = rect.top - ph - 8;
        if (left < 8) left = 8;
        if (top < 8) top = 8;

        popup.style.top = top + 'px';
        popup.style.left = left + 'px';
    }

    // ─── Badge ───────────────────────────────────────────────────────────────────

    function insertOrUpdateBadge(label, stats) {
        let badge = getActiveBadge();

        if (badge) {
            badge.querySelector('.ps-label').textContent = label;
            badge._stats = stats;
            log('Badge updated:', label);
            return;
        }

        const header = getActiveHeader();
        if (!header) {
            logWarn('.itemMiscInfo-primary not found in active page, cannot insert badge');
            return;
        }

        badge = document.createElement('div');
        badge.id = BADGE_ID;
        badge.className = 'mediaInfoItem';
        badge._stats = stats;

        Object.assign(badge.style, {
            cursor: 'default',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px'
        });

        badge.innerHTML = '<span style="opacity:0.65;font-size:0.9em">▶</span><span class="ps-label">' + label + '</span>';

        badge.addEventListener('mouseenter', function () {
            showPopup(badge, badge._stats || []);
        });
        badge.addEventListener('mouseleave', function () {
            setTimeout(function () {
                if (!badge.matches(':hover')) removePopup();
            }, 150);
        });

        // Insert after the last existing mediaInfoItem
        const items = header.querySelectorAll('.mediaInfoItem');
        const last = items[items.length - 1];
        if (last) {
            last.after(badge);
        } else {
            header.appendChild(badge);
        }

        log('Badge inserted:', label);
    }

    // ─── Main ────────────────────────────────────────────────────────────────────

    let _lastItemId = null;
    let _running = false;

    async function checkAndDisplayStats() {
        if (_running) return;
        if (!isMediaDetailPage()) return;

        const itemId = getItemId();
        if (!itemId || !isValidItemId(itemId)) {
            logWarn('No valid item ID in URL');
            return;
        }

        if (itemId === _lastItemId && getActiveBadge()) {
            log('Badge already shown for item', itemId, '— skipping');
            return;
        }

        const apiClient = getApiClient();
        if (!apiClient) return;

        _running = true;
        _lastItemId = itemId;
        log('Querying play stats for item:', itemId);

        try {
            const [reportData, userNames, runtimeSeconds] = await Promise.all([
                queryPlaybackReporting(apiClient, itemId),
                fetchUserNames(apiClient),
                fetchItemRuntimeSeconds(apiClient, itemId)
            ]);

            if (reportData === null) {
                logWarn('Playback Reporting Plugin unavailable or returned no data');
                _running = false;
                return;
            }

            if (runtimeSeconds <= 0) {
                logWarn('Runtime unavailable; using raw play counts as fallback');
            }

            const stats = parseStats(reportData, userNames, runtimeSeconds);
            const totalEquivalent = stats.reduce(function (s, x) { return s + x.equivalentPlays; }, 0);
            const label = totalEquivalent === 0
                ? '0 plays'
                : (formatEquivalentPlays(totalEquivalent) + 'x plays');

            log('Stats:', JSON.stringify(stats), '| Runtime(s):', runtimeSeconds, '| TotalEquivalent:', totalEquivalent);
            insertOrUpdateBadge(label, stats);
        } catch (e) {
            logWarn('Unexpected error in checkAndDisplayStats:', e);
        }

        _running = false;
    }

    // ─── SPA Navigation (hash polling + MutationObserver) ───────────────────────

    let _lastHash = '';

    function poll() {
        const hash = window.location.hash;
        if (hash !== _lastHash) {
            log('Hash changed:', _lastHash, '->', hash);
            _lastHash = hash;
            _lastItemId = null;
            removePopup();
            // Remove badges from ALL pages (including now-hidden previous page)
            document.querySelectorAll('#' + BADGE_ID).forEach(function (el) { el.remove(); });
            document.querySelectorAll('#' + POPUP_ID).forEach(function (el) { el.remove(); });
            setTimeout(checkAndDisplayStats, 1000);
        }
        setTimeout(poll, POLL_INTERVAL);
    }

    let _observerDebounce = null;
    const observer = new MutationObserver(function () {
        if (_running || _observerDebounce) return;
        if (!isMediaDetailPage()) return;
        if (getActiveBadge()) return;  // badge already in active page
        if (!getActiveHeader()) return; // header not ready yet
        _observerDebounce = setTimeout(function () {
            _observerDebounce = null;
            log('MutationObserver: header appeared in active page, scheduling stats check');
            checkAndDisplayStats();
        }, 400);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    log('Document readyState:', document.readyState);
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(checkAndDisplayStats, 1000);
    } else {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(checkAndDisplayStats, 1000);
        });
    }

    log('Starting hash poll (interval:', POLL_INTERVAL, 'ms)');
    poll();
})();
