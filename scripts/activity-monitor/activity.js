// Jellyfin Activity Monitor
// Inject via any custom JS loader on admin pages.
//
// Adds an "Activity" button to the Jellyfin header (headerRight).
// Clicking it opens a fullscreen modal that shows:
//   • All active streams with playback position, transcoding details, bitrate, etc.
//   • Server-side activity log (recent events)
//   • All users with last seen / last played info
//
// Polls active sessions every 4 s while the modal is open.
// Uses only the standard Jellyfin REST API via window.ApiClient.

(function () {
    // Inject critical Activity Monitor CSS inline so modal/tab hiding always works
    function injectActivityMonitorCSS() {
        if (document.getElementById('am-inline-style')) return;
        const style = document.createElement('style');
        style.id = 'am-inline-style';
        style.textContent = `
#am-modal { display: none; position: absolute; inset: 0; z-index: 2; font-family: inherit; pointer-events: auto; }
#am-modal.am-visible { display: block; }
.am-tab-pane { display: none; }
.am-tab-pane.am-tab-pane-active { display: block; }
body.am-no-scroll { overflow: hidden !important; }
`;
        document.head.appendChild(style);
    }
    injectActivityMonitorCSS();
    'use strict';

    // ─── Constants ───────────────────────────────────────────────────────────
    const LOG_PREFIX   = '[ActivityMonitor]';
    const BUTTON_ID    = 'am-header-btn';
    const MODAL_ID     = 'am-modal';
    const POLL_MS      = 4000;
    const ACTIVITY_LIMIT = 100;

    // ─── State ───────────────────────────────────────────────────────────────
    let modalOpen    = false;
    let pollTimer    = null;
    let activeTab    = 'streams';
    let allUsers     = [];
    const trickplayCache = new Map(); // itemId → info | null
    const sessionState   = new Map(); // sessionId → { lastPosTicks, lastUpdate, isPaused, speed, durTicks, itemId }
    let animFrameId      = null;

    // ─── Logging ─────────────────────────────────────────────────────────────
    function log(...a)  { console.log(LOG_PREFIX, ...a); }
    function warn(...a) { console.warn(LOG_PREFIX, ...a); }

    log('Script loaded');

    // ─── API helpers ─────────────────────────────────────────────────────────
    function api() { return window.ApiClient; }

    function headers() {
        const a = api();
        return {
            'X-Emby-Token':       a.accessToken(),
            'X-Jellyfin-User-Id': a.getCurrentUserId(),
            'Content-Type':       'application/json'
        };
    }

    async function apiFetch(path, params = {}) {
        const a = api();
        if (!a) throw new Error('ApiClient not ready');
        const qs = new URLSearchParams(params).toString();
        const url = a.getUrl(path) + (qs ? '?' + qs : '');
        const resp = await fetch(url, { headers: headers() });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText} — ${path}`);
        return resp.json();
    }

    async function apiPost(path, body = {}) {
        const a = api();
        if (!a) throw new Error('ApiClient not ready');
        const url = a.getUrl(path);
        const resp = await fetch(url, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText} — POST ${path}`);
        return resp.status === 204 ? null : resp.json().catch(() => null);
    }

    async function apiDelete(path) {
        const a = api();
        if (!a) throw new Error('ApiClient not ready');
        const url = a.getUrl(path);
        const resp = await fetch(url, { method: 'DELETE', headers: headers() });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText} — DELETE ${path}`);
    }

    // ─── Formatters ──────────────────────────────────────────────────────────
    /**
     * Convert Jellyfin ticks (100-nanosecond units) to HH:MM:SS or MM:SS.
     */
    function ticksToTime(ticks) {
        if (!ticks && ticks !== 0) return '—';
        const totalSec = Math.floor(ticks / 10_000_000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        const mm = String(m).padStart(2, '0');
        const ss = String(s).padStart(2, '0');
        return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    function formatBitrate(bps) {
        if (!bps) return '—';
        if (bps >= 1_000_000) return (bps / 1_000_000).toFixed(1) + ' Mbps';
        if (bps >= 1_000)     return (bps / 1_000).toFixed(0) + ' Kbps';
        return bps + ' bps';
    }

    function formatDate(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleString();
        } catch { return iso; }
    }

    function formatRelative(iso) {
        if (!iso) return '—';
        const diff = Date.now() - new Date(iso).getTime();
        const s = Math.floor(diff / 1000);
        if (s < 60)   return `${s}s ago`;
        const m = Math.floor(s / 60);
        if (m < 60)   return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24)   return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
    }

    function pct(pos, total) {
        if (!total) return 0;
        return Math.min(100, Math.max(0, (pos / total) * 100));
    }

    function imgUrl(itemId, tag, type = 'Primary', maxW = 300) {
        if (!itemId || !tag) return null;
        const a = api();
        return a.getUrl(`/Items/${itemId}/Images/${type}?tag=${tag}&maxWidth=${maxW}&quality=80`);
    }

    function thumbUrl(session) {
        const item = session.NowPlayingItem;
        if (!item) return null;
        if (item.BackdropImageTags && item.BackdropImageTags[0]) {
            const id = item.ParentBackdropItemId || item.Id;
            return imgUrl(id, item.BackdropImageTags[0], 'Backdrop', 400);
        }
        if (item.ImageTags && item.ImageTags.Primary) {
            return imgUrl(item.Id, item.ImageTags.Primary, 'Primary', 300);
        }
        return null;
    }

    function logoUrl(session) {
        const item = session.NowPlayingItem;
        if (!item) return null;
        const logoItemId = item.ParentLogoItemId || item.Id;
        const logoTag    = item.ParentLogoImageTag || (item.ImageTags && item.ImageTags.Logo);
        if (logoTag) return imgUrl(logoItemId, logoTag, 'Logo', 160);
        return null;
    }

    function deviceIcon(client) {
        const c = (client || '').toLowerCase();
        if (c.includes('firefox'))  return 'devices/firefox.svg';
        if (c.includes('chrome'))   return 'devices/chrome.svg';
        if (c.includes('safari'))   return 'devices/safari.svg';
        if (c.includes('edge'))     return 'devices/edgeChromium.svg';
        if (c.includes('android'))  return 'devices/android.svg';
        if (c.includes('ios') || c.includes('iphone') || c.includes('ipad')) return 'devices/apple.svg';
        if (c.includes('roku'))     return 'devices/roku.svg';
        if (c.includes('kodi'))     return 'devices/kodi.svg';
        if (c.includes('infuse'))   return 'devices/infuse.svg';
        return 'devices/other.svg';
    }

    // ─── Modal skeleton ───────────────────────────────────────────────────────
    function buildModal() {
        const el = document.createElement('div');
        el.id = MODAL_ID;
        el.innerHTML = `
<div class="am-backdrop"></div>
<div class="am-panel">
  <div class="am-header">
    <span class="material-icons am-header-icon">monitor_heart</span>
    <span class="am-header-title">Activity Monitor</span>
    <span class="am-header-sub" id="am-last-update"></span>
    <div class="am-tabs">
      <button class="am-tab am-tab-active" data-tab="streams">
        <span class="material-icons">play_circle</span> Streams
        <span class="am-badge" id="am-badge-streams">0</span>
      </button>
      <button class="am-tab" data-tab="activity">
        <span class="material-icons">history</span> Activity Log
      </button>
      <button class="am-tab" data-tab="users">
        <span class="material-icons">group</span> Users
      </button>
      <button class="am-tab" data-tab="server">
        <span class="material-icons">dns</span> Server
      </button>
    </div>
    <div class="am-header-actions">
      <button class="am-icon-btn" id="am-refresh-btn" title="Refresh now">
        <span class="material-icons">refresh</span>
      </button>
      <button class="am-icon-btn" id="am-close-btn" title="Close (Esc)">
        <span class="material-icons">close</span>
      </button>
    </div>
  </div>

  <div class="am-body">
    <!-- STREAMS TAB -->
    <div class="am-tab-pane am-tab-pane-active" id="am-pane-streams">
      <div id="am-streams-container">
        <div class="am-loading"><span class="material-icons am-spin">sync</span> Loading sessions…</div>
      </div>
    </div>

    <!-- ACTIVITY TAB -->
    <div class="am-tab-pane" id="am-pane-activity">
      <div class="am-activity-header">
        <span class="am-section-label">Last ${ACTIVITY_LIMIT} server events</span>
        <button class="am-small-btn" id="am-activity-load-btn">
          <span class="material-icons">refresh</span> Reload
        </button>
      </div>
      <div id="am-activity-container">
        <div class="am-loading"><span class="material-icons am-spin">sync</span> Loading activity…</div>
      </div>
    </div>

    <!-- USERS TAB -->
    <div class="am-tab-pane" id="am-pane-users">
      <div id="am-users-container">
        <div class="am-loading"><span class="material-icons am-spin">sync</span> Loading users…</div>
      </div>
    </div>

    <!-- SERVER TAB -->
    <div class="am-tab-pane" id="am-pane-server">
      <div id="am-server-container">
        <div class="am-loading"><span class="material-icons am-spin">sync</span> Loading server info…</div>
      </div>
    </div>
  </div>
</div>`;
        amHost.appendChild(el);

        // Tab switching
        el.querySelectorAll('.am-tab').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // Close
        el.querySelector('#am-close-btn').addEventListener('click', closeModal);
        el.querySelector('.am-backdrop').addEventListener('click', closeModal);

        // Refresh
        el.querySelector('#am-refresh-btn').addEventListener('click', () => refreshAll(true));

        // Activity reload
        el.querySelector('#am-activity-load-btn').addEventListener('click', loadActivity);

        // Keyboard close
        document.addEventListener('keydown', onKeyDown);

        return el;
    }

    // ─── Tab management ───────────────────────────────────────────────────────
    function switchTab(name) {
        activeTab = name;
        const modal = document.getElementById(MODAL_ID);
        if (!modal) return;
        modal.querySelectorAll('.am-tab').forEach(b => b.classList.toggle('am-tab-active', b.dataset.tab === name));
        modal.querySelectorAll('.am-tab-pane').forEach(p => p.classList.toggle('am-tab-pane-active', p.id === `am-pane-${name}`));

        if (name === 'activity') loadActivity();
        if (name === 'users')    loadUsers();
        if (name === 'server')   loadServerInfo();
    }

    // ─── Open / close ─────────────────────────────────────────────────────────
    function openModal() {
        if (modalOpen) return;
        modalOpen = true;
        activeTab = 'streams';

        let modal = document.getElementById(MODAL_ID);
        if (!modal) modal = buildModal();

        // Reset to streams tab
        modal.querySelectorAll('.am-tab').forEach(b => b.classList.toggle('am-tab-active', b.dataset.tab === 'streams'));
        modal.querySelectorAll('.am-tab-pane').forEach(p => p.classList.toggle('am-tab-pane-active', p.id === 'am-pane-streams'));

        modal.classList.add('am-visible');
        document.body.classList.add('am-no-scroll');

        refreshAll(true);
        pollTimer = setInterval(() => refreshAll(false), POLL_MS);
        startAnimLoop();
    }

    function closeModal() {
        if (!modalOpen) return;
        modalOpen = false;
        clearInterval(pollTimer);
        pollTimer = null;
        stopAnimLoop();
        document.removeEventListener('keydown', onKeyDown);

        hideTrickplayTooltip();
        const modal = document.getElementById(MODAL_ID);
        if (modal) modal.classList.remove('am-visible');
        document.body.classList.remove('am-no-scroll');
    }

    // ─── Animation loop for smooth progress ──────────────────────────────────
    function startAnimLoop() {
        if (animFrameId) return;
        const tick = () => {
            updateProgressBars();
            animFrameId = requestAnimationFrame(tick);
        };
        animFrameId = requestAnimationFrame(tick);
    }

    function stopAnimLoop() {
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
    }

    function updateProgressBars() {
        const now = Date.now();
        sessionState.forEach((state, sessionId) => {
            if (state.isPaused || !state.durTicks) return;
            const elapsedMs    = now - state.lastUpdate;
            const elapsedTicks = elapsedMs * 10_000 * state.speed;
            const currentTicks = Math.min(state.lastPosTicks + elapsedTicks, state.durTicks);
            const pctPos       = (currentTicks / state.durTicks) * 100;

            const card = document.querySelector(`.am-stream-card[data-sessionid="${sessionId}"]`);
            if (!card) return;

            const posBar  = card.querySelector('.am-progress-pos');
            const tick    = card.querySelector('.am-progress-tick');
            const timeEl  = card.querySelector('.am-stream-time');

            if (posBar) posBar.style.width = pctPos + '%';
            if (tick)   tick.style.left    = pctPos + '%';
            if (timeEl) timeEl.textContent = `${ticksToTime(currentTicks)} / ${ticksToTime(state.durTicks)}`;

            // Update trickplay thumbnail
            updateTrickplayThumb(card, state.itemId, currentTicks, state.durTicks);
        });
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') closeModal();
    }

    // ─── Data loading ─────────────────────────────────────────────────────────
    async function refreshAll(showSpinner) {
        if (!modalOpen) return;
        await Promise.allSettled([loadSessions(showSpinner)]);
    }

    // ────────────────────────── STREAMS ──────────────────────────────────────
    async function loadSessions(showSpinner) {
        const container = document.getElementById('am-streams-container');
        if (!container) return;

        if (showSpinner && !container.querySelector('.am-stream-card')) {
            container.innerHTML = '<div class="am-loading"><span class="material-icons am-spin">sync</span> Loading sessions…</div>';
        }

        try {
            const sessions = await apiFetch('/Sessions', {
                ActiveWithinSeconds: 960,
                ControllableByUserId: ''
            });

            // Update badge
            const activeSessions = sessions.filter(s => s.NowPlayingItem);
            const badge = document.getElementById('am-badge-streams');
            if (badge) badge.textContent = activeSessions.length;

            reconcileSessions(container, sessions);

            const sub = document.getElementById('am-last-update');
            if (sub) sub.textContent = 'Updated ' + new Date().toLocaleTimeString();
        } catch (e) {
            warn('loadSessions error', e);
            container.innerHTML = `<div class="am-error"><span class="material-icons">error</span> ${e.message}</div>`;
        }
    }

    function reconcileSessions(container, sessions) {
        // Sort: playing first, then by username
        sessions.sort((a, b) => {
            const ap = !!a.NowPlayingItem, bp = !!b.NowPlayingItem;
            if (ap !== bp) return ap ? -1 : 1;
            return (a.UserName || '').localeCompare(b.UserName || '');
        });

        const existingIds = new Set();
        container.querySelectorAll('.am-stream-card[data-sessionid]').forEach(el => {
            existingIds.add(el.dataset.sessionid);
        });

        const newIds = new Set(sessions.map(s => s.Id));

        // Remove sessions that are gone
        existingIds.forEach(id => {
            if (!newIds.has(id)) {
                const el = container.querySelector(`.am-stream-card[data-sessionid="${id}"]`);
                if (el) el.remove();
                sessionState.delete(id);
            }
        });

        // Clear loading message if present
        const loading = container.querySelector('.am-loading');
        if (loading) loading.remove();

        // Add or update sessions
        sessions.forEach((s, idx) => {
            const existing = container.querySelector(`.am-stream-card[data-sessionid="${s.Id}"]`);
            if (existing) {
                updateSessionCard(existing, s);
            } else {
                const html = renderSessionCard(s);
                const temp = document.createElement('div');
                temp.innerHTML = html;
                const card = temp.firstElementChild;
                
                // Insert at correct position
                const allCards = container.querySelectorAll('.am-stream-card');
                if (allCards[idx]) {
                    container.insertBefore(card, allCards[idx]);
                } else {
                    container.appendChild(card);
                }
                wireCardActions(card);
                initTrickplayThumb(card, s);
            }

            // Update session state for interpolation
            const ps = s.PlayState || {};
            const now = s.NowPlayingItem;
            if (now) {
                sessionState.set(s.Id, {
                    lastPosTicks:    ps.PositionTicks  || 0,
                    lastUpdate:      Date.now(),
                    isPaused:        ps.IsPaused       || false,
                    speed:           ps.PlaybackRate   || 1,
                    durTicks:        now.RunTimeTicks  || 0,
                    itemId:          now.Id,
                    mediaSourceId:   ps.MediaSourceId  || now.Id
                });
            } else {
                sessionState.delete(s.Id);
            }
        });

        // Show empty if none
        if (!sessions.length && !container.querySelector('.am-empty')) {
            container.innerHTML = '<div class="am-empty"><span class="material-icons">tv_off</span><p>No active sessions</p></div>';
        }
    }

    function wireCardActions(card) {
        card.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const { action, sessionid } = btn.dataset;
                handleSessionAction(action, sessionid, null, btn);
            });
        });
        // Click card body to toggle trickplay overlay
        card.addEventListener('click', e => {
            if (e.target.closest('[data-action]')) return;
            toggleCardTrickplay(card);
        });
    }

    function toggleCardTrickplay(card) {
        const overlay = card.querySelector('.am-tp-overlay');
        if (!overlay) return;
        const isSelected = card.classList.contains('am-stream-selected');
        const itemId = overlay.dataset.itemid;
        log('toggleCardTrickplay', itemId, 'isSelected:', isSelected);

        // Collapse any other expanded card
        document.querySelectorAll('.am-stream-card.am-stream-selected').forEach(c => {
            if (c === card) return;
            c.classList.remove('am-stream-selected');
            const ov = c.querySelector('.am-tp-overlay');
            if (ov) ov.style.display = 'none';
        });

        if (isSelected) {
            card.classList.remove('am-stream-selected');
            overlay.style.display = 'none';
        } else {
            card.classList.add('am-stream-selected');
            overlay.style.display = '';
            if (itemId && overlay.dataset.tpLoaded !== 'true' && !overlay.dataset.tpFetching) {
                overlay.dataset.tpFetching = '1';
                const unavail = overlay.querySelector('.am-tp-unavail');
                log('Trickplay: starting fetch for itemId', itemId);
                fetchTrickplayInfo(itemId).then(info => {
                    delete overlay.dataset.tpFetching;
                    log('Trickplay fetch result for', itemId, '→', info);
                    if (info) {
                        overlay.dataset.tpLoaded = 'true';
                    } else {
                        warn('Trickplay: no data returned for', itemId, '— showing unavailable');
                        if (unavail) unavail.style.display = '';
                    }
                });
            } else {
                log('Trickplay: skip fetch — loaded:', overlay.dataset.tpLoaded, 'fetching:', overlay.dataset.tpFetching, 'itemId:', itemId);
            }
        }
    }

    function updateSessionCard(card, s) {
        const ps  = s.PlayState       || {};
        const tc  = s.TranscodingInfo || {};
        const now = s.NowPlayingItem;

        if (!now) {
            // Session went idle - could remove or mark idle
            card.classList.remove('am-stream-card-active');
            return;
        }

        const durTicks  = now.RunTimeTicks || 0;
        const posTicks  = ps.PositionTicks || 0;
        const posPercent = pct(posTicks, durTicks);
        const bufPercent = tc.CompletionPercentage != null ? tc.CompletionPercentage : 0;

        // Update progress bar
        const bufBar = card.querySelector('.am-progress-buf');
        if (bufBar) bufBar.style.width = bufPercent + '%';

        // Update transcode buffer chip
        const tcChip = card.querySelector('.am-tc-pct');
        if (tcChip) {
            if (tc.CompletionPercentage != null) {
                tcChip.textContent = tc.CompletionPercentage.toFixed(0) + '% buffered';
                tcChip.style.display = '';
            } else {
                tcChip.style.display = 'none';
            }
        }

        // Update paused badge
        const pauseBtn = card.querySelector('[data-action="pause"], [data-action="unpause"]');
        if (pauseBtn) {
            pauseBtn.dataset.action = ps.IsPaused ? 'unpause' : 'pause';
            pauseBtn.title = ps.IsPaused ? 'Resume' : 'Pause';
            pauseBtn.querySelector('.material-icons').textContent = ps.IsPaused ? 'play_arrow' : 'pause';
        }

        const pausedBadge = card.querySelector('.am-paused-badge');
        if (pausedBadge) {
            pausedBadge.style.display = ps.IsPaused ? '' : 'none';
        }

        // Update speed badge
        const speedBadge = card.querySelector('.am-speed-badge');
        if (speedBadge) {
            const rate = ps.PlaybackRate || 1;
            if (rate !== 1) {
                speedBadge.textContent = rate + 'x';
                speedBadge.style.display = '';
            } else {
                speedBadge.style.display = 'none';
            }
        }

        // Update bitrate
        const brEl = card.querySelector('[data-stat="bitrate"]');
        if (brEl) brEl.textContent = formatBitrate(tc.Bitrate);
    }

    function getStreamInfo(now, tc) {
        const video = now?.MediaStreams?.find(s => s.Type === 'Video') || {};
        const audio = now?.MediaStreams?.find(s => s.Type === 'Audio') || {};
        const sub   = now?.MediaStreams?.find(s => s.Type === 'Subtitle' && s.IsExternal === false) || 
                      now?.MediaStreams?.find(s => s.Type === 'Subtitle') || {};

        return {
            // Video
            videoCodec:     tc.VideoCodec || video.Codec || '—',
            videoProfile:   video.Profile || '',
            videoLevel:     video.Level || '',
            videoBitDepth:  video.BitDepth || null,
            videoRange:     video.VideoRange || video.VideoRangeType || '',
            videoDoVi:      video.VideoDoViTitle || '',
            frameRate:      video.RealFrameRate || video.AverageFrameRate || null,
            width:          tc.Width  || now?.Width  || video.Width  || null,
            height:         tc.Height || now?.Height || video.Height || null,
            aspectRatio:    video.AspectRatio || '',
            pixelFormat:    video.PixelFormat || '',
            isInterlaced:   video.IsInterlaced || false,
            isAnamorphic:   video.IsAnamorphic || false,
            refFrames:      video.RefFrames || null,
            colorSpace:     video.ColorSpace || '',
            colorTransfer:  video.ColorTransfer || '',
            colorPrimaries: video.ColorPrimaries || '',
            
            // Audio
            audioCodec:     tc.AudioCodec || audio.Codec || '—',
            audioChannels:  tc.AudioChannels || audio.Channels || null,
            audioLayout:    audio.ChannelLayout || '',
            audioBitRate:   audio.BitRate || null,
            audioSampleRate:audio.SampleRate || null,
            audioBitDepth:  audio.BitDepth || null,
            audioProfile:   audio.Profile || '',
            audioLang:      audio.Language || audio.DisplayLanguage || '',
            audioTitle:     audio.DisplayTitle || audio.Title || '',
            
            // Subtitle
            subCodec:       sub.Codec || '',
            subLang:        sub.Language || sub.DisplayLanguage || '',
            subTitle:       sub.DisplayTitle || sub.Title || '',
            subIsForced:    sub.IsForced || false,
            subIsDefault:   sub.IsDefault || false,
            subIsExternal:  sub.IsExternal || false,

            // Container
            container:      tc.Container || (now?.Container ? now.Container.split(',')[0] : null) || '—',

            // Transcoding specifics
            tcVideoDecoder: tc.VideoDecodingCodec || '',
            tcVideoEncoder: tc.VideoEncoderCodec  || tc.VideoCodec || '',
            tcAudioDecoder: tc.AudioDecodingCodec || '',
            tcAudioEncoder: tc.AudioEncoderCodec  || tc.AudioCodec || '',
            tcHwType:       tc.HardwareAccelerationType || '',
            tcIsVideoDirect:tc.IsVideoDirect,
            tcIsAudioDirect:tc.IsAudioDirect,
            tcReasons:      Array.isArray(tc.TranscodeReasons) ? tc.TranscodeReasons
                          : (tc.TranscodeReasons ? tc.TranscodeReasons.split(',') : []),
            tcBitrate:      tc.Bitrate || null,
            tcCompPct:      tc.CompletionPercentage,
            tcFramerate:    tc.Framerate || null,
            tcWidth:        tc.Width || null,
            tcHeight:       tc.Height || null
        };
    }

    function renderSessionCard(s) {
        const ps   = s.PlayState       || {};
        const tc   = s.TranscodingInfo || {};
        const now  = s.NowPlayingItem;
        const isPlaying = !!now;

        const bg      = thumbUrl(s);
        const logo    = logoUrl(s);
        // Encode single-quote in server-provided URL to prevent CSS url() context breakout.
        const bgStyle = bg ? `background-image:url('${bg.replace(/'/g, '%27')}')` : '';

        const posTicks   = ps.PositionTicks || 0;
        const durTicks   = now?.RunTimeTicks || 0;
        const posPercent = pct(posTicks, durTicks);
        const bufPercent = tc.CompletionPercentage || 0;
        const playSpeed  = ps.PlaybackRate || 1;

        const playMethod  = ps.PlayMethod || '';
        const methodLabel = playMethod === 'DirectStream' ? 'Direct Stream'
                          : playMethod === 'DirectPlay'   ? 'Direct Play'
                          : playMethod === 'Transcode'    ? 'Transcoding'
                          : playMethod || '—';
        const methodClass = playMethod === 'DirectPlay'   ? 'am-badge-green'
                          : playMethod === 'DirectStream' ? 'am-badge-blue'
                          : playMethod === 'Transcode'    ? 'am-badge-orange'
                          : 'am-badge-gray';

        const info = isPlaying ? getStreamInfo(now, tc) : null;

        const titleLine = now ? escHtml(now.Name || '—') : '<em>Idle</em>';
        const subLine   = now
            ? [now.SeriesName && escHtml(now.SeriesName),
               now.SeasonName && escHtml(now.SeasonName),
               now.ProductionYear].filter(Boolean).join(' · ')
            : escHtml(s.DeviceName || '');

        const timeStr = durTicks
            ? `${ticksToTime(posTicks)} / ${ticksToTime(durTicks)}`
            : isPlaying ? ticksToTime(posTicks) : '';

        const logoImg = logo
            ? `<img class="am-stream-logo" src="${logo}" alt="${escHtml(now?.Name || '')}" loading="lazy">`
            : '';

        // Build detailed stats
        let statsHtml = '';
        if (isPlaying && info) {
            // Video row
            const videoStr = info.tcVideoDecoder 
                ? `${info.tcVideoDecoder} → ${info.tcVideoEncoder}` 
                : info.videoCodec;
            const videoExtra = [
                info.videoProfile,
                info.videoBitDepth ? `${info.videoBitDepth}-bit` : '',
                info.videoRange,
                info.videoDoVi
            ].filter(Boolean).join(' ');

            const resolution = info.width && info.height ? `${info.width}×${info.height}` : '—';
            const fps = info.frameRate ? `${info.frameRate.toFixed(2)} fps` : '';
            const aspect = info.aspectRatio || '';

            // Audio row  
            const audioStr = info.tcAudioDecoder 
                ? `${info.tcAudioDecoder} → ${info.tcAudioEncoder}` 
                : info.audioCodec;
            const chLabel = info.audioChannels 
                ? (info.audioLayout || `${info.audioChannels}ch`)
                : '';
            const audioSr = info.audioSampleRate ? `${(info.audioSampleRate/1000).toFixed(1)}kHz` : '';
            const audioBd = info.audioBitDepth ? `${info.audioBitDepth}-bit` : '';
            const audioBr = info.audioBitRate ? formatBitrate(info.audioBitRate) : '';

            // Subtitle
            const subStr = info.subCodec 
                ? `${info.subCodec}${info.subLang ? ' (' + info.subLang + ')' : ''}${info.subIsForced ? ' [Forced]' : ''}` 
                : '—';

            // Transcode reasons
            const reasonsStr = info.tcReasons.length 
                ? info.tcReasons.map(r => `<span class="am-chip am-chip-orange am-chip-sm">${escHtml(r)}</span>`).join(' ')
                : '';

            statsHtml = `
<div class="am-stream-stats am-stream-stats-full">
  <div class="am-stat-group">
    <div class="am-stat-group-title">Video</div>
    <div class="am-stat"><span class="am-stat-label">Codec</span><span class="am-stat-val">${escHtml(videoStr)}</span></div>
    <div class="am-stat"><span class="am-stat-label">Profile</span><span class="am-stat-val">${escHtml(videoExtra) || '—'}</span></div>
    <div class="am-stat"><span class="am-stat-label">Resolution</span><span class="am-stat-val">${resolution}</span></div>
    <div class="am-stat"><span class="am-stat-label">Framerate</span><span class="am-stat-val">${fps || '—'}</span></div>
    <div class="am-stat"><span class="am-stat-label">Aspect</span><span class="am-stat-val">${escHtml(aspect) || '—'}</span></div>
    ${info.colorSpace ? `<div class="am-stat"><span class="am-stat-label">Color</span><span class="am-stat-val">${escHtml(info.colorSpace)} / ${escHtml(info.colorTransfer)}</span></div>` : ''}
    ${info.pixelFormat ? `<div class="am-stat"><span class="am-stat-label">Pixel Fmt</span><span class="am-stat-val">${escHtml(info.pixelFormat)}</span></div>` : ''}
    ${info.isInterlaced ? `<div class="am-stat"><span class="am-stat-label">Interlaced</span><span class="am-stat-val">Yes</span></div>` : ''}
  </div>
  <div class="am-stat-group">
    <div class="am-stat-group-title">Audio</div>
    <div class="am-stat"><span class="am-stat-label">Codec</span><span class="am-stat-val">${escHtml(audioStr)}</span></div>
    <div class="am-stat"><span class="am-stat-label">Channels</span><span class="am-stat-val">${escHtml(chLabel) || '—'}</span></div>
    <div class="am-stat"><span class="am-stat-label">Sample Rate</span><span class="am-stat-val">${audioSr || '—'}</span></div>
    ${audioBd ? `<div class="am-stat"><span class="am-stat-label">Bit Depth</span><span class="am-stat-val">${audioBd}</span></div>` : ''}
    ${audioBr ? `<div class="am-stat"><span class="am-stat-label">Bitrate</span><span class="am-stat-val">${audioBr}</span></div>` : ''}
    ${info.audioLang ? `<div class="am-stat"><span class="am-stat-label">Language</span><span class="am-stat-val">${escHtml(info.audioLang)}</span></div>` : ''}
  </div>
  <div class="am-stat-group">
    <div class="am-stat-group-title">Subtitle</div>
    <div class="am-stat"><span class="am-stat-label">Track</span><span class="am-stat-val">${subStr}</span></div>
  </div>
  <div class="am-stat-group">
    <div class="am-stat-group-title">Stream</div>
    <div class="am-stat"><span class="am-stat-label">Container</span><span class="am-stat-val">${escHtml(info.container)}</span></div>
    <div class="am-stat"><span class="am-stat-label">Bitrate</span><span class="am-stat-val" data-stat="bitrate">${formatBitrate(info.tcBitrate)}</span></div>
    <div class="am-stat"><span class="am-stat-label">IP</span><span class="am-stat-val">${escHtml(s.RemoteEndPoint || 'local')}</span></div>
    ${info.tcHwType ? `<div class="am-stat"><span class="am-stat-label">HW Accel</span><span class="am-stat-val">${escHtml(info.tcHwType.toUpperCase())}</span></div>` : ''}
  </div>
  ${reasonsStr ? `<div class="am-stat-group am-stat-group-wide"><div class="am-stat-group-title">Transcode Reasons</div><div class="am-tc-reasons">${reasonsStr}</div></div>` : ''}
</div>`;
        }

        // Hardware / transcode chips
        const hwChip = info?.tcHwType
            ? `<span class="am-chip am-chip-purple">${info.tcHwType.toUpperCase()}</span>`
            : '';

        const tcPctChip = tc.CompletionPercentage != null
            ? `<span class="am-chip am-chip-teal am-tc-pct">${tc.CompletionPercentage.toFixed(0)}% buffered</span>`
            : '<span class="am-chip am-chip-teal am-tc-pct" style="display:none"></span>';

        const pausedBadge = `<span class="am-chip am-chip-gray am-paused-badge" style="${ps.IsPaused ? '' : 'display:none'}">PAUSED</span>`;

        const speedBadge = `<span class="am-chip am-chip-blue am-speed-badge" style="${playSpeed !== 1 ? '' : 'display:none'}">${playSpeed}x</span>`;

        const actions = isPlaying ? `
<div class="am-stream-actions">
  <button class="am-icon-btn am-action-btn" data-action="${ps.IsPaused ? 'unpause' : 'pause'}" data-sessionid="${escAttr(s.Id)}" title="${ps.IsPaused ? 'Resume' : 'Pause'}">
    <span class="material-icons">${ps.IsPaused ? 'play_arrow' : 'pause'}</span>
  </button>
  <button class="am-icon-btn am-action-btn" data-action="stop" data-sessionid="${escAttr(s.Id)}" title="Stop">
    <span class="material-icons">stop</span>
  </button>
</div>` : '';

        return `
<div class="am-stream-card${isPlaying ? ' am-stream-card-active' : ''}" data-sessionid="${escAttr(s.Id)}">
  <div class="am-stream-bg" style="${bgStyle}"></div>
  <div class="am-stream-inner">
    <div class="am-stream-top">
      <div class="am-stream-device">
        <img src="assets/img/${deviceIcon(s.Client)}" class="am-device-icon" alt="${escHtml(s.Client || '')}">
        <div>
          <div class="am-device-name">${escHtml(s.DeviceName || 'Unknown')}</div>
          <div class="am-device-client">${escHtml(s.Client || '')} ${escHtml(s.ApplicationVersion || '')}</div>
        </div>
      </div>
      <div class="am-stream-user">
        <span class="material-icons">person</span>
        ${escHtml(s.UserName || 'Unknown')}
      </div>
      <div class="am-stream-method-wrap">
        <span class="am-chip ${methodClass}">${methodLabel}</span>
        ${hwChip}
        ${tcPctChip}
        ${pausedBadge}
        ${speedBadge}
        ${actions}
      </div>
    </div>

    <div class="am-stream-mid">
      ${logoImg}
      <div class="am-stream-title-block">
        <div class="am-stream-title">${titleLine}</div>
        <div class="am-stream-sub">${subLine}</div>
        ${timeStr ? `<div class="am-stream-time">${timeStr}</div>` : ''}
      </div>
    </div>

    ${isPlaying ? `
    <div class="am-progress-wrap">
      <div class="am-progress-track" data-itemid="${escAttr(now.Id)}" data-durticks="${durTicks}">
        <div class="am-progress-buf" style="width:${bufPercent}%"></div>
        <div class="am-progress-pos" style="width:${posPercent}%"></div>
        <div class="am-progress-tick" style="left:${posPercent}%"></div>
      </div>
    </div>
    <div class="am-tp-overlay" data-itemid="${escAttr(now.Id)}" data-mediasourceid="${escAttr(ps.MediaSourceId || now.Id)}" style="display:none">
      <div class="am-tp-frame"></div>
      <div class="am-tp-overlay-footer">
        <span class="am-tp-time"></span>
        <span class="am-tp-unavail" style="display:none">No trickplay data</span>
      </div>
    </div>` : ''}

    ${statsHtml}
  </div>
</div>`;
    }

    function initTrickplayThumb(card, s) {
        // trickplay is loaded lazily on card click — nothing to do at init
    }

    function updateTrickplayThumb(card, itemId, posTicks) {
        if (!card.classList.contains('am-stream-selected')) return;
        const overlay = card.querySelector('.am-tp-overlay');
        if (!overlay || overlay.dataset.tpLoaded !== 'true') return;

        const tpInfo = trickplayCache.get(itemId);
        if (!tpInfo) return;

        const posMs        = Math.floor(posTicks / 10_000);
        const tileIndex    = Math.floor(posMs / tpInfo.interval);
        const clampedIdx   = Math.min(Math.max(0, tileIndex), tpInfo.thumbnailCount - 1);
        const sheetIdx     = Math.floor(clampedIdx / tpInfo.tilesPerSheet);
        const indexInSheet = clampedIdx % tpInfo.tilesPerSheet;
        const col          = indexInSheet % tpInfo.tileWidth;
        const row          = Math.floor(indexInSheet / tpInfo.tileWidth);
        const bgX          = -(col * tpInfo.thumbW);
        const bgY          = -(row * tpInfo.thumbH);

        const a             = api();
        const mediaSourceId = overlay.dataset.mediasourceid || itemId;
        const sheetUrl      = a.getUrl(`/Videos/${itemId}/Trickplay/${tpInfo.width}/${sheetIdx}.jpg`, {
            ApiKey:        a.accessToken(),
            MediaSourceId: mediaSourceId
        });

        const frame  = overlay.querySelector('.am-tp-frame');
        const timeEl = overlay.querySelector('.am-tp-time');

        if (frame && (overlay.dataset.lastSheet !== sheetUrl ||
                      overlay.dataset.lastX !== String(bgX) ||
                      overlay.dataset.lastY !== String(bgY))) {

            overlay.dataset.lastSheet = sheetUrl;
            overlay.dataset.lastX     = String(bgX);
            overlay.dataset.lastY     = String(bgY);

            frame.style.width              = tpInfo.thumbW + 'px';
            frame.style.height             = tpInfo.thumbH + 'px';
            frame.style.backgroundImage    = `url('${sheetUrl.replace(/'/g, '%27')}')`;
            frame.style.backgroundSize     = `${tpInfo.tileWidth * tpInfo.thumbW}px ${tpInfo.tileHeight * tpInfo.thumbH}px`;
            frame.style.backgroundPosition = `${bgX}px ${bgY}px`;
        }
        if (timeEl) timeEl.textContent = ticksToTime(posTicks);
    }

    async function handleSessionAction(action, sessionId, _playStateId, btn) {
        btn.disabled = true;
        try {
            if (action === 'pause') {
                await apiPost(`/Sessions/${sessionId}/Playing/Pause`);
            } else if (action === 'unpause') {
                await apiPost(`/Sessions/${sessionId}/Playing/Unpause`);
            } else if (action === 'stop') {
                await apiPost(`/Sessions/${sessionId}/Playing/Stop`);
            }
            setTimeout(() => loadSessions(false), 600);
        } catch (e) {
            warn('Session action failed', action, e);
        } finally {
            btn.disabled = false;
        }
    }

    // ────────────────────────── ACTIVITY LOG ──────────────────────────────────
    async function loadActivity() {
        const container = document.getElementById('am-activity-container');
        if (!container) return;
        container.innerHTML = '<div class="am-loading"><span class="material-icons am-spin">sync</span> Loading…</div>';

        try {
            const data = await apiFetch('/System/ActivityLog/Entries', {
                Limit:     ACTIVITY_LIMIT,
                StartIndex: 0
            });
            const entries = data.Items || [];
            renderActivity(container, entries);

            // Wire up item navigation
            container.querySelectorAll('tr[data-itemid]').forEach(row => {
                row.addEventListener('click', () => {
                    closeModal();
                    window.location.hash = '#/details?id=' + encodeURIComponent(row.dataset.itemid);
                });
            });
        } catch (e) {
            warn('loadActivity error', e);
            container.innerHTML = `<div class="am-error"><span class="material-icons">error</span> ${e.message}</div>`;
        }
    }

    function renderActivity(container, entries) {
        if (!entries.length) {
            container.innerHTML = '<div class="am-empty"><span class="material-icons">history_toggle_off</span><p>No activity found</p></div>';
            return;
        }

        const severityIcon = s =>
            s === 'Error'   ? '<span class="material-icons am-sev-error">error</span>'
          : s === 'Warning' ? '<span class="material-icons am-sev-warn">warning</span>'
          : '<span class="material-icons am-sev-info">info</span>';

        container.innerHTML = `
<table class="am-table">
  <thead>
    <tr>
      <th></th>
      <th>Time</th>
      <th>User</th>
      <th>Event</th>
      <th>Details</th>
    </tr>
  </thead>
  <tbody>
    ${entries.map(e => `
    <tr class="am-row-${(e.Severity || 'Info').toLowerCase()}${e.ItemId ? ' am-row-linkable' : ''}"${e.ItemId ? ` data-itemid="${escAttr(e.ItemId)}"` : ''}>
      <td>${severityIcon(e.Severity)}</td>
      <td class="am-nowrap" title="${escHtml(formatDate(e.Date))}">${escHtml(formatRelative(e.Date))}</td>
      <td class="am-nowrap">${escHtml(e.UserName || '—')}</td>
      <td>${escHtml(e.Name || '—')}${e.ItemId ? ' <span class="material-icons am-row-link-icon" title="Go to item">open_in_new</span>' : ''}</td>
      <td class="am-activity-detail">${escHtml(e.ShortOverview || e.Overview || '')}</td>
    </tr>`).join('')}
  </tbody>
</table>`;
    }

    // ────────────────────────── USERS ────────────────────────────────────────
    async function loadUsers() {
        const container = document.getElementById('am-users-container');
        if (!container) return;
        container.innerHTML = '<div class="am-loading"><span class="material-icons am-spin">sync</span> Loading users…</div>';

        try {
            const [users, sessions] = await Promise.all([
                apiFetch('/Users'),
                apiFetch('/Sessions', { ActiveWithinSeconds: 960 })
            ]);
            allUsers = users;
            renderUsers(container, users, sessions);
        } catch (e) {
            warn('loadUsers error', e);
            container.innerHTML = `<div class="am-error"><span class="material-icons">error</span> ${e.message}</div>`;
        }
    }

    function renderUsers(container, users, sessions) {
        if (!users.length) {
            container.innerHTML = '<div class="am-empty"><span class="material-icons">group_off</span><p>No users found</p></div>';
            return;
        }

        // Map sessionId → session for lookup
        const sessionByUser = {};
        sessions.forEach(s => {
            if (s.UserId) {
                if (!sessionByUser[s.UserId] || s.NowPlayingItem) {
                    sessionByUser[s.UserId] = s;
                }
            }
        });

        users.sort((a, b) => {
            const aOn = !!sessionByUser[a.Id], bOn = !!sessionByUser[b.Id];
            if (aOn !== bOn) return aOn ? -1 : 1;
            return (a.Name || '').localeCompare(b.Name || '');
        });

        const cards = users.map(u => {
            const sess       = sessionByUser[u.Id];
            const isOnline   = !!sess;
            const isPlaying  = isOnline && !!sess.NowPlayingItem;
            const isAdmin    = u.Policy?.IsAdministrator;
            const isDisabled = u.Policy?.IsDisabled;

            const avatarStyle = u.PrimaryImageTag
                ? `background-image:url('${api().getUrl(`/Users/${u.Id}/Images/Primary?tag=${u.PrimaryImageTag}&maxWidth=80&quality=80`).replace(/'/g, '%27')}')`
                : '';

            const statusDot = isPlaying  ? 'am-dot-playing'
                            : isOnline   ? 'am-dot-online'
                            : 'am-dot-offline';

            const nowPlaying = isPlaying
                ? `<div class="am-user-playing">
                     <span class="material-icons">play_circle</span>
                     ${escHtml(sess.NowPlayingItem.Name || '')}
                     ${sess.NowPlayingItem.SeriesName ? ' · ' + escHtml(sess.NowPlayingItem.SeriesName) : ''}
                   </div>`
                : '';

            const lastActive = u.LastActivityDate
                ? `<div class="am-user-meta">Last active: ${formatRelative(u.LastActivityDate)}</div>`
                : '';

            const lastPlayed = u.LastPlaybackDate || (sess && sess.LastActivityDate)
                ? `<div class="am-user-meta">Last playback: ${formatRelative(u.LastPlaybackDate || sess?.LastActivityDate)}</div>`
                : '';

            const badges = [
                isAdmin    ? '<span class="am-chip am-chip-red">Admin</span>'    : '',
                isDisabled ? '<span class="am-chip am-chip-gray">Disabled</span>' : '',
                isOnline   ? '<span class="am-chip am-chip-green">Online</span>'  : ''
            ].filter(Boolean).join('');

            const deviceInfo = (isOnline && sess)
                ? `<div class="am-user-device">
                     <img src="assets/img/${deviceIcon(sess.Client)}" class="am-device-icon am-device-icon-sm" alt="">
                     ${escHtml(sess.DeviceName || '')} · ${escHtml(sess.Client || '')}
                   </div>`
                : '';

            const totalTime = u.Policy?.MaxParentalRating != null
                ? '' // not a useful stat here
                : '';

            const uid = escAttr(u.Id);
            return `
<div class="am-user-card${isOnline ? ' am-user-card-online' : ''}">
  <div class="am-user-avatar-wrap">
    <div class="am-user-avatar" style="${avatarStyle}">
      ${!avatarStyle ? '<span class="material-icons">person</span>' : ''}
    </div>
    <span class="am-status-dot ${statusDot}"></span>
  </div>
  <div class="am-user-info">
    <div class="am-user-name-row">
      <span class="am-user-name">${escHtml(u.Name || 'Unknown')}</span>
      ${badges}
    </div>
    ${deviceInfo}
    ${nowPlaying}
    ${lastActive}
    ${lastPlayed}
  </div>
  <div class="am-user-card-actions">
    <a class="am-icon-btn am-user-action-btn" href="#/dashboard/users/profile?userId=${uid}" title="Admin profile" target="_self">
      <span class="material-icons">manage_accounts</span>
    </a>
    <a class="am-icon-btn am-user-action-btn" href="#/mypreferencesmenu?userId=${uid}" title="Preferences" target="_self">
      <span class="material-icons">settings</span>
    </a>
  </div>
</div>`;
        }).join('');

        container.innerHTML = `<div class="am-user-grid">${cards}</div>`;
    }

    // ────────────────────────── SERVER INFO ──────────────────────────────────
    async function loadServerInfo() {
        const container = document.getElementById('am-server-container');
        if (!container) return;
        if (container.dataset.loaded === 'true') return; // only load once per session

        container.innerHTML = '<div class="am-loading"><span class="material-icons am-spin">sync</span> Loading…</div>';

        try {
            const [info, counts, sessions] = await Promise.allSettled([
                apiFetch('/System/Info'),
                apiFetch('/Items/Counts'),
                apiFetch('/Sessions', { ActiveWithinSeconds: 960 })
            ]);

            const si  = info.value   || {};
            const cnt = counts.value || {};
            const ses = sessions.value || [];

            container.dataset.loaded = 'true';
            renderServerInfo(container, si, cnt, ses);
        } catch (e) {
            warn('loadServerInfo error', e);
            container.innerHTML = `<div class="am-error"><span class="material-icons">error</span> ${e.message}</div>`;
        }
    }

    function renderServerInfo(container, si, cnt, ses) {
        const playing     = ses.filter(s => s.NowPlayingItem);
        const transcoding = playing.filter(s => s.PlayState?.PlayMethod === 'Transcode');
        const directPlay  = playing.filter(s => s.PlayState?.PlayMethod === 'DirectPlay');
        const directStream= playing.filter(s => s.PlayState?.PlayMethod === 'DirectStream');

        const uptime = si.SystemUpdateLevel != null
            ? `<div class="am-stat"><span class="am-stat-label">Update Channel</span><span class="am-stat-val">${escHtml(si.SystemUpdateLevel)}</span></div>` : '';

        // Library counts
        const libItems = [
            { label: 'Movies',       val: cnt.MovieCount       },
            { label: 'Series',       val: cnt.SeriesCount      },
            { label: 'Episodes',     val: cnt.EpisodeCount     },
            { label: 'Artists',      val: cnt.ArtistCount      },
            { label: 'Albums',       val: cnt.AlbumCount       },
            { label: 'Songs',        val: cnt.SongCount        },
            { label: 'Music Videos', val: cnt.MusicVideoCount  },
            { label: 'Books',        val: cnt.BookCount        },
            { label: 'Box Sets',     val: cnt.BoxSetCount      },
        ].filter(x => x.val).map(x =>
            `<div class="am-stat"><span class="am-stat-label">${x.label}</span><span class="am-stat-val am-stat-val-num">${x.val.toLocaleString()}</span></div>`
        ).join('');

        // Active transcoding rows
        const tcRows = transcoding.length
            ? transcoding.map(s => {
                const tc = s.TranscodingInfo || {};
                const reasonArr = Array.isArray(tc.TranscodeReasons) ? tc.TranscodeReasons
                                : (tc.TranscodeReasons ? tc.TranscodeReasons.split(',') : []);
                const reasons = reasonArr.length
                    ? reasonArr.map(r => `<span class="am-chip am-chip-orange am-chip-sm">${escHtml(r.trim())}</span>`).join(' ')
                    : '—';
                return `
<tr>
  <td>${escHtml(s.UserName || '?')}</td>
  <td>${escHtml(s.NowPlayingItem?.Name || '?')}</td>
  <td>${escHtml(tc.VideoCodec || '?')} → ${escHtml(tc.AudioCodec || '?')}</td>
  <td>${formatBitrate(tc.Bitrate)}</td>
  <td>${tc.HardwareAccelerationType ? `<span class="am-chip am-chip-purple">${escHtml(tc.HardwareAccelerationType.toUpperCase())}</span>` : '—'}</td>
  <td class="am-tc-reason-cell">${reasons}</td>
</tr>`;
            }).join('')
            : '<tr><td colspan="6" style="text-align:center;opacity:.45">No active transcoding</td></tr>';

        container.innerHTML = `
<div class="am-server-grid">

  <div class="am-server-card">
    <div class="am-server-card-title"><span class="material-icons">dns</span> Server</div>
    <div class="am-stat"><span class="am-stat-label">Name</span><span class="am-stat-val">${escHtml(si.ServerName || '—')}</span></div>
    <div class="am-stat"><span class="am-stat-label">Version</span><span class="am-stat-val">${escHtml(si.Version || '—')}</span></div>
    <div class="am-stat"><span class="am-stat-label">Product</span><span class="am-stat-val">${escHtml(si.ProductName || 'Jellyfin')}</span></div>
    <div class="am-stat"><span class="am-stat-label">OS</span><span class="am-stat-val">${escHtml(si.OperatingSystem || '—')}</span></div>
    <div class="am-stat"><span class="am-stat-label">Architecture</span><span class="am-stat-val">${escHtml(si.SystemArchitecture || '—')}</span></div>
    ${si.LocalAddress  ? `<div class="am-stat"><span class="am-stat-label">Local Address</span><span class="am-stat-val">${escHtml(si.LocalAddress)}</span></div>` : ''}
    ${si.WanAddress    ? `<div class="am-stat"><span class="am-stat-label">WAN Address</span><span class="am-stat-val">${escHtml(si.WanAddress)}</span></div>` : ''}
    ${uptime}
    <div class="am-stat"><span class="am-stat-label">Pending Restart</span><span class="am-stat-val${si.HasPendingRestart ? ' am-val-warn' : ''}">${si.HasPendingRestart ? '⚠ Yes' : 'No'}</span></div>
    ${si.HasPendingRestart ? `<div class="am-server-restart-note"><span class="material-icons">warning</span> A restart is pending — this may indicate a recent update was applied.</div>` : ''}
  </div>

  <div class="am-server-card">
    <div class="am-server-card-title"><span class="material-icons">video_library</span> Library</div>
    ${libItems || '<div class="am-empty-small">No library data</div>'}
  </div>

  <div class="am-server-card">
    <div class="am-server-card-title"><span class="material-icons">play_circle</span> Active Streams</div>
    <div class="am-stat"><span class="am-stat-label">Playing</span><span class="am-stat-val am-stat-val-num">${playing.length}</span></div>
    <div class="am-stat"><span class="am-stat-label">Direct Play</span><span class="am-stat-val am-stat-val-num am-val-green">${directPlay.length}</span></div>
    <div class="am-stat"><span class="am-stat-label">Direct Stream</span><span class="am-stat-val am-stat-val-num am-val-blue">${directStream.length}</span></div>
    <div class="am-stat"><span class="am-stat-label">Transcoding</span><span class="am-stat-val am-stat-val-num am-val-orange">${transcoding.length}</span></div>
    <div class="am-stat am-stat-note"><span class="am-stat-label">CPU / RAM</span><span class="am-stat-val am-stat-muted">Not exposed by API</span></div>
  </div>

</div>

${transcoding.length ? `
<div class="am-server-tc-wrap">
  <div class="am-server-card-title"><span class="material-icons">sync_alt</span> Active Transcoding</div>
  <div class="am-table-wrap">
    <table class="am-table am-tc-table">
      <thead><tr><th>User</th><th>Title</th><th>Codecs</th><th>Bitrate</th><th>HW</th><th>Reasons</th></tr></thead>
      <tbody>${tcRows}</tbody>
    </table>
  </div>
</div>` : ''}`;
    }

    // ─── Trickplay ────────────────────────────────────────────────────────────
    function parseTrickplayMap(map, itemId) {
        const widths = Object.keys(map || {})
            .map(Number)
            .filter(n => !isNaN(n) && n > 0)
            .sort((a, b) => a - b);
        log('Trickplay widths found:', widths);
        if (!widths.length) return null;
        // Prefer largest width for best quality
        const w    = widths[widths.length - 1];
        const info = map[w];
        log('Trickplay selected width', w, '→ info:', info);
        if (!info || !info.ThumbnailCount) {
            warn('Trickplay: info missing ThumbnailCount', info);
            return null;
        }
        return {
            itemId,
            width:          w,
            thumbW:         info.Width,
            thumbH:         info.Height,
            tileWidth:      info.TileWidth,
            tileHeight:     info.TileHeight,
            thumbnailCount: info.ThumbnailCount,
            interval:       info.Interval,
            tilesPerSheet:  info.TileWidth * info.TileHeight
        };
    }

    async function fetchTrickplayInfo(itemId) {
        if (trickplayCache.has(itemId)) {
            log('Trickplay cache hit for', itemId, '→', trickplayCache.get(itemId));
            return trickplayCache.get(itemId);
        }
        try {
            // Trickplay info lives on the item — fetch it via the user items endpoint
            // which returns the full item including Trickplay data.
            const userId = api().getCurrentUserId();
            const data   = await apiFetch(`/Users/${userId}/Items/${itemId}`);
            log('Item fetch for trickplay', itemId, '→ Trickplay key:', data?.Trickplay);

            // The Trickplay property is double-keyed:
            //   { "<mediaSourceId>": { "<width>": { Width, Height, ... } } }
            // We need to unwrap the outer mediaSource key first.
            let outerMap = data?.Trickplay || data?.TrickplayInfo || null;

            if (!outerMap) {
                warn('Trickplay: no Trickplay key on item', itemId, '— keys present:', Object.keys(data || {}));
                trickplayCache.set(itemId, null);
                return null;
            }

            // Unwrap: prefer the entry matching our itemId/mediaSourceId, else take first entry.
            let map = outerMap[itemId] || outerMap[Object.keys(outerMap)[0]] || null;
            if (!map) {
                warn('Trickplay: outer map empty for', itemId, outerMap);
                trickplayCache.set(itemId, null);
                return null;
            }

            const result = parseTrickplayMap(map, itemId);
            if (!result) {
                trickplayCache.set(itemId, null);
                return null;
            }
            log('Trickplay parsed result:', result);
            trickplayCache.set(itemId, result);
            return result;
        } catch (e) {
            warn('Trickplay fetch failed for', itemId, e);
            trickplayCache.set(itemId, null);
            return null;
        }
    }

    function getTrickplayTooltip() {
        let el = document.getElementById('am-trickplay-tt');
        if (!el) {
            el = document.createElement('div');
            el.id        = 'am-trickplay-tt';
            el.className = 'am-trickplay-tt';
            el.innerHTML = '<div class="am-trickplay-img"></div><div class="am-trickplay-time"></div>';
            amHost.appendChild(el);
        }
        return el;
    }

    function hideTrickplayTooltip() {
        const el = document.getElementById('am-trickplay-tt');
        if (el) el.classList.remove('am-trickplay-tt-visible');
    }

    function wireProgressHover(container) {
        container.querySelectorAll('.am-progress-track[data-itemid]').forEach(track => {
            const itemId = track.dataset.itemid;
            const durMs  = Math.floor((+track.dataset.durticks || 0) / 10_000);
            if (!durMs) return;

            let tpInfo       = null;
            let fetchStarted = false;

            track.addEventListener('mouseenter', async () => {
                if (!fetchStarted) {
                    fetchStarted = true;
                    tpInfo = await fetchTrickplayInfo(itemId);
                }
            });

            track.addEventListener('mousemove', e => {
                if (!tpInfo) return;
                const rect  = track.getBoundingClientRect();
                const frac  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const posMs = Math.floor(frac * durMs);

                const tileIndex    = Math.floor(posMs / tpInfo.interval);
                const clampedIdx   = Math.min(tileIndex, tpInfo.thumbnailCount - 1);
                const sheetIdx     = Math.floor(clampedIdx / tpInfo.tilesPerSheet);
                const indexInSheet = clampedIdx % tpInfo.tilesPerSheet;
                const col          = indexInSheet % tpInfo.tileWidth;
                const row          = Math.floor(indexInSheet / tpInfo.tileWidth);
                const bgX          = -(col * tpInfo.thumbW);
                const bgY          = -(row * tpInfo.thumbH);

                const a        = api();
                // Note: api_key in URL is required for CSS background-image — browsers cannot
                // send Authorization headers for image resources.  Treat this token as sensitive.
                const sheetUrl = a.getUrl(`/Videos/${tpInfo.itemId}/Trickplay/${tpInfo.width}/Tiles/${sheetIdx}.jpg`)
                               + `?api_key=${encodeURIComponent(a.accessToken())}`;

                const tt   = getTrickplayTooltip();
                const img  = tt.querySelector('.am-trickplay-img');
                const time = tt.querySelector('.am-trickplay-time');

                img.style.width              = tpInfo.thumbW + 'px';
                img.style.height             = tpInfo.thumbH + 'px';
            img.style.backgroundImage    = `url('${sheetUrl.replace(/'/g, '%27')}')`;
                img.style.backgroundSize     = `${tpInfo.tileWidth * tpInfo.thumbW}px ${tpInfo.tileHeight * tpInfo.thumbH}px`;
                img.style.backgroundPosition = `${bgX}px ${bgY}px`;

                time.textContent = ticksToTime(posMs * 10_000);

                const ttW  = tpInfo.thumbW + 4;
                let   left = e.clientX - ttW / 2;
                left       = Math.max(8, Math.min(left, window.innerWidth - ttW - 8));
                const ttH  = tpInfo.thumbH + 30;
                const top  = rect.top - ttH > 8 ? rect.top - ttH : rect.bottom + 8;

                tt.style.left = left + 'px';
                tt.style.top  = top  + 'px';
                tt.classList.add('am-trickplay-tt-visible');
            });

            track.addEventListener('mouseleave', hideTrickplayTooltip);
        });
    }

    // ─── Security helpers (XSS prevention) ───────────────────────────────────
    function escHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function escAttr(str) {
        return String(str ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ─── Dedicated host element ───────────────────────────────────────────────
    // Created synchronously at parse time so React always sees a stable set of
    // direct body children. Every element we create (button, modal, trickplay
    // tooltip) lives inside #am-host, never directly in body's React-managed
    // child list — eliminating the removeChild reconciler crashes.
    const amHost = (() => {
        let h = document.getElementById('am-host');
        if (!h) {
            h = document.createElement('div');
            h.id = 'am-host';
            // pointer-events:none on the container; children opt-in individually
            h.style.cssText = 'position:fixed;inset:0;z-index:9997;pointer-events:none;';
            // Append synchronously — no async, no observer
            (document.body || document.documentElement).appendChild(h);
        }
        return h;
    })();

    // ─── Button injection ─────────────────────────────────────────────────────
    async function isAdmin() {
        try {
            const user = await apiFetch(`/Users/${api().getCurrentUserId()}`);
            return user?.Policy?.IsAdministrator === true;
        } catch {
            return false;
        }
    }

    async function injectButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const headerRight = document.querySelector('.headerRight');
        if (!headerRight) return;

        if (!(await isAdmin())) {
            log('Not an admin — button not injected');
            return;
        }

        const btn = document.createElement('button');
        btn.id        = BUTTON_ID;
        btn.type      = 'button';
        btn.title     = 'Activity Monitor';
        btn.innerHTML = '<span class="material-icons">monitor_heart</span>';

        btn.addEventListener('click', () => {
            if (modalOpen) closeModal();
            else openModal();
        });

        headerRight.appendChild(btn);
        log('Header button injected into .headerRight');
    }

    // ─── Boot ─────────────────────────────────────────────────────────────────
    // Poll for ApiClient instead of using a MutationObserver.
    // A subtree MutationObserver on body fires on every React DOM write,
    // which can interfere with React's synchronous commit phase and cause
    // the "removeChild: node is not a child" reconciler crash.
    function boot() {
        const tid = setInterval(async () => {
            // Wait for ApiClient AND a valid (non-null) user session.
            // getCurrentUserId() returns null while the app is still
            // bootstrapping even after ApiClient is defined, which causes
            // a /Users/null 401 and an incorrect "not admin" result.
            if (!window.ApiClient) return;
            const uid = window.ApiClient.getCurrentUserId?.();
            if (!uid) return;
            if (!document.querySelector('.headerRight')) return;
            clearInterval(tid);
            await injectButton();
        }, 300);
    }

    // Close the modal whenever the SPA navigates to a new hash route,
    // so it doesn't float on top of pages that didn't load the external CSS.
    window.addEventListener('hashchange', () => { if (modalOpen) closeModal(); });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
