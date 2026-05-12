// Jellyfin Branding CSS Sectioner
// Inject via any custom JS loader that runs on admin pages.
//
// On the Branding admin page (/web/#/dashboard/branding) the single
// "Custom CSS" textarea is replaced with a set of collapsible, named section
// panels.  Each panel contains its own textarea.  All edits are immediately
// serialised back into the hidden original textarea so Jellyfin's Save button
// works without any modifications.
//
// Section delimiter format (written into the CSS):
//
//   /* ═══ [branding-css-sectioner] ═══ */     ← written once at the top
//   /* ═-═ Section name ═-═ 0 */               ← normal section (order index)
//   /* ═-═ Footer name ═-═ bottom */           ← pinned-to-bottom section
//
// Backward compatible: old-format markers without an order tag are also parsed.
// Any CSS above the managed marker is preserved in a locked read-only panel.

(function () {
    'use strict';

    // ─── Constants ───────────────────────────────────────────────────────────
    const LOG_PREFIX     = '[BrandingCssSectioner]';
    const MANAGED_MARKER = '/* ═══ [branding-css-sectioner] ═══ */';
    // Matches both old format (no tag) and new format (number or "bottom").
    const SECTION_RE     = /\/\* \u2550-\u2550 (.+?) \u2550-\u2550(?:\s+(\d+|bottom))? \*\//g;
    const POLL_INTERVAL  = 1500;

    function sectionHeader(name, pinned, order) {
        // Strip comment-close sequences to prevent CSS comment injection.
        const safeName = String(name ?? '').replace(/\*\//g, '');
        return pinned ? `/* ═-═ ${safeName} ═-═ bottom */`
                      : `/* ═-═ ${safeName} ═-═ ${order} */`;
    }

    // ─── State ───────────────────────────────────────────────────────────────
    let sections       = [];   // [{ name, content, pinned, locked? }]
    let sourceTextarea = null;
    let uiRoot         = null;
    let retryTimer     = null;
    let lastHash       = window.location.hash;
    let dragSrcIndex   = -1;

    // ─── Logging ─────────────────────────────────────────────────────────────
    function log(...a)  { console.log(LOG_PREFIX, ...a); }
    function warn(...a) { console.warn(LOG_PREFIX, ...a); }

    log('Script loaded');

    // ─── Parsing / serialisation ─────────────────────────────────────────────

    function parseSections(css) {
        const markerIdx = css.indexOf(MANAGED_MARKER);

        // Not yet managed — treat the whole value as one editable section.
        if (markerIdx === -1) {
            return [{ name: 'Main', content: css.trim(), pinned: false }];
        }

        const preamble   = css.slice(0, markerIdx).trim();
        const managedCss = css.slice(markerIdx + MANAGED_MARKER.length);

        const headers = [...managedCss.matchAll(SECTION_RE)];
        // Split on both old-format and new-format markers.
        const parts   = managedCss.split(/\/\* \u2550-\u2550 .+? \u2550-\u2550(?:\s+(?:\d+|bottom))? \*\//);

        const normal = [];
        const pinned = [];

        for (let i = 0; i < headers.length; i++) {
            const name    = headers[i][1].trim();
            const tag     = headers[i][2]; // undefined | digit string | "bottom"
            const content = (parts[i + 1] || '').trim();
            const isPin   = tag === 'bottom';
            const order   = (tag && tag !== 'bottom') ? parseInt(tag, 10) : null;

            const section = { name, content, pinned: isPin, order };
            isPin ? pinned.push(section) : normal.push(section);
        }

        // Sort normal sections by their stored order index; preserve file order
        // when no order tag is present (old format), since null orders are stable.
        normal.sort((a, b) => {
            if (a.order === null && b.order === null) return 0;
            if (a.order === null) return 1;
            if (b.order === null) return -1;
            return a.order - b.order;
        });

        const result = [];
        if (preamble) result.push({ name: '(pre-existing)', content: preamble, locked: true, pinned: false });
        result.push(...normal, ...pinned);

        if (result.filter(s => !s.locked).length === 0) {
            result.push({ name: 'Section 1', content: '', pinned: false });
        }

        return result;
    }

    function serializeSections(secs) {
        const preamble  = secs.find(s => s.locked);
        const nonPinned = secs.filter(s => !s.locked && !s.pinned);
        const pinnedSecs = secs.filter(s => !s.locked && s.pinned);

        const managed = [
            ...nonPinned.map((s, i) => `${sectionHeader(s.name, false, i)}\n${s.content.trim()}`),
            ...pinnedSecs.map(s     => `${sectionHeader(s.name, true)}\n${s.content.trim()}`),
        ].join('\n\n');

        const body = `${MANAGED_MARKER}\n${managed}`;
        return preamble ? `${preamble.content.trim()}\n\n${body}` : body;
    }

    // ─── React-controlled textarea sync ──────────────────────────────────────
    // Jellyfin's branding form is React-managed; setting .value directly does
    // not trigger React's synthetic onChange.  We must use the native prototype
    // setter then dispatch a real 'input' event.

    const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
    ).set;

    function syncToSource() {
        if (!sourceTextarea) return;
        nativeSetter.call(sourceTextarea, serializeSections(sections));
        sourceTextarea.dispatchEvent(new Event('input',  { bubbles: true }));
        sourceTextarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ─── Export CSS ──────────────────────────────────────────────────────────

    function exportCSS() {
        const css  = serializeSections(sections);
        const blob = new Blob([css], { type: 'text/css' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'branding.css';
        a.click();
        URL.revokeObjectURL(url);
        log('Exported CSS');
    }

    // ─── Prism.js syntax highlighting ────────────────────────────────────────

    let prismReady = false;
    const prismCbs = [];

    function onPrismReady(cb) {
        if (prismReady) { cb(); return; }
        prismCbs.push(cb);
    }

    function loadPrism() {
        if (document.getElementById('bcs-prism-css')) return;
        // SECURITY: These assets are loaded from a third-party CDN without Subresource
        // Integrity (SRI) checks.  If your threat model requires it, either replace these
        // URLs with self-hosted copies or add integrity="sha384-…" and crossOrigin="anonymous"
        // attributes. SRI hashes can be generated at https://www.srihash.org/ or retrieved
        // from the jsDelivr API: https://data.jsdelivr.com/v1/package/npm/prismjs@1.29.0
        const link = document.createElement('link');
        link.id   = 'bcs-prism-css';
        link.rel  = 'stylesheet';
        link.crossOrigin = 'anonymous';
        link.href = 'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-okaidia.min.css';
        document.head.appendChild(link);
        const s1 = document.createElement('script');
        s1.crossOrigin = 'anonymous';
        s1.src    = 'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js';
        s1.onload = () => {
            const s2 = document.createElement('script');
            s2.crossOrigin = 'anonymous';
            s2.src    = 'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-css.min.js';
            s2.onload = () => { prismReady = true; prismCbs.splice(0).forEach(fn => fn()); };
            document.head.appendChild(s2);
        };
        document.head.appendChild(s1);
    }

    // ─── UI helpers ──────────────────────────────────────────────────────────

    function makeIconBtn(icon, color, title) {
        const btn = document.createElement('button');
        btn.type  = 'button';
        btn.title = title;
        btn.innerHTML = `<i class="material-icons" style="font-size:18px;">${icon}</i>`;
        Object.assign(btn.style, {
            background: 'none',
            border:     'none',
            padding:    '0.25em',
            cursor:     'pointer',
            color,
            lineHeight: '1',
            flexShrink: '0',
        });
        return btn;
    }

    // ─── Panel container rebuild ─────────────────────────────────────────────
    // All operations that change sections[] call rebuildPanels() to re-render.

    function rebuildPanels() {
        const container = document.getElementById('bcs-panels');
        if (!container) return;
        container.innerHTML = '';

        const normal = sections.filter(s => !s.pinned);
        const pinned = sections.filter(s => s.pinned);

        normal.forEach(s => container.appendChild(makeSectionPanel(s)));

        if (pinned.length > 0) {
            const divider = document.createElement('div');
            Object.assign(divider.style, {
                display:       'flex',
                alignItems:    'center',
                gap:           '0.5em',
                margin:        '0.25em 0 0.75em',
                color:         '#888',
                fontSize:      '0.75em',
                letterSpacing: '0.06em',
            });
            divider.innerHTML = '<i class="material-icons" style="font-size:14px;color:#ffb833;">push_pin</i>PINNED TO BOTTOM';
            container.appendChild(divider);
            pinned.forEach(s => container.appendChild(makeSectionPanel(s)));
        }
    }

    // ─── Section panel ───────────────────────────────────────────────────────

    function makeSectionPanel(section) {
        const details = document.createElement('details');
        // Start collapsed
        Object.assign(details.style, {
            background:   section.pinned ? 'rgba(255,200,80,0.06)' : 'rgba(255,255,255,0.05)',
            borderRadius: '8px',
            marginBottom: '0.75em',
            border:       section.pinned ? '1px solid rgba(255,200,80,0.2)' : '1px solid transparent',
        });

        // ── Summary row ──
        const summary = document.createElement('summary');
        Object.assign(summary.style, {
            listStyle:      'none',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            padding:        '0.6em 1em',
            cursor:         'pointer',
            userSelect:     'none',
        });
        summary.addEventListener('click', e => {
            if (e.target.closest('button, .bcs-drag-handle')) e.preventDefault();
        });

        // Left: drag handle (non-locked, non-pinned only) + arrow + name
        const left = document.createElement('div');
        left.style.cssText = 'display:flex;align-items:center;gap:0.5em;flex:1;min-width:0;';

        if (!section.locked && !section.pinned) {
            const handle = document.createElement('i');
            handle.className   = 'material-icons bcs-drag-handle';
            handle.textContent = 'drag_indicator';
            handle.title       = 'Drag to reorder';
            Object.assign(handle.style, {
                fontSize:   '20px',
                color:      '#555',
                cursor:     'grab',
                flexShrink: '0',
            });
            // Only start drag when the pointer is on the handle.
            handle.addEventListener('mousedown', () => { details.draggable = true; });
            handle.addEventListener('mouseup',   () => { details.draggable = false; });
            left.appendChild(handle);
        }

        const arrow = document.createElement('i');
        arrow.className   = 'material-icons';
        arrow.textContent = 'arrow_right';
        arrow.style.cssText = 'transition:transform 0.2s;font-size:20px;transform:rotate(0deg);flex-shrink:0;';
        details.addEventListener('toggle', () => {
            arrow.style.transform = details.open ? 'rotate(90deg)' : 'rotate(0deg)';
        });

        const nameEl = document.createElement('span');
        nameEl.textContent = section.name;
        nameEl.style.cssText = 'font-weight:600;font-size:0.95em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

        if (section.pinned) {
            const pinIcon = document.createElement('i');
            pinIcon.className   = 'material-icons';
            pinIcon.textContent = 'push_pin';
            pinIcon.title       = 'Pinned to bottom';
            pinIcon.style.cssText = 'font-size:14px;color:#ffb833;flex-shrink:0;';
            left.append(arrow, pinIcon, nameEl);
        } else {
            left.append(arrow, nameEl);
        }

        // Right: action buttons
        const right = document.createElement('div');
        right.style.cssText = 'display:flex;align-items:center;gap:0.25em;flex-shrink:0;';

        if (section.locked) {
            const lockIcon = document.createElement('i');
            lockIcon.className   = 'material-icons';
            lockIcon.textContent = 'lock';
            lockIcon.title       = 'Pre-existing CSS — read-only';
            lockIcon.style.cssText = 'font-size:16px;color:#777;';
            right.appendChild(lockIcon);
        } else {
            const pinBtn = makeIconBtn('push_pin', section.pinned ? '#ffb833' : '#555',
                section.pinned ? 'Unpin (restore to normal order)' : 'Pin to bottom');
            pinBtn.querySelector('i').style.fontSize = '16px';
            pinBtn.addEventListener('click', e => {
                e.stopPropagation();
                section.pinned = !section.pinned;
                syncToSource();
                rebuildPanels();
            });

            const renameBtn = makeIconBtn('edit', '#aaa', 'Rename section');
            renameBtn.addEventListener('click', e => {
                e.stopPropagation();
                const newName = prompt('Section name:', section.name);
                if (newName && newName.trim()) {
                    section.name       = newName.trim().replace(/\*\//g, '');
                    nameEl.textContent = section.name;
                    syncToSource();
                }
            });

            const deleteBtn = makeIconBtn('delete', '#cc3333', 'Delete section');
            deleteBtn.addEventListener('click', e => {
                e.stopPropagation();
                if (sections.filter(s => !s.locked).length <= 1) {
                    alert('Cannot delete the only section.');
                    return;
                }
                if (!confirm(`Delete section "${section.name}"?`)) return;
                sections.splice(sections.indexOf(section), 1);
                syncToSource();
                rebuildPanels();
            });

            right.append(pinBtn, renameBtn, deleteBtn);
        }

        summary.append(left, right);

        // ── Body: mirror editor (Prism Okaidia highlight + transparent textarea) ──
        const body = document.createElement('div');
        body.style.cssText = 'padding:0.75em 1em 1em;border-top:1px solid rgba(255,255,255,0.08);';

        // Shared font metrics — must be identical on both pre and textarea so
        // the highlight layer stays pixel-aligned with the cursor.
        const editorFont = {
            fontFamily:   "'Consolas', 'Courier New', monospace",
            fontSize:     '13px',
            lineHeight:   '1.5',
            padding:      '0.6em',
            boxSizing:    'border-box',
            tabSize:      '2',
            whiteSpace:   'pre-wrap',
            overflowWrap: 'break-word',
        };

        const editorWrap = document.createElement('div');
        Object.assign(editorWrap.style, { position: 'relative', minHeight: '300px', width: '100%' });

        // Highlight layer — sits behind the textarea.
        const pre = document.createElement('pre');
        pre.className = 'language-css';
        Object.assign(pre.style, { ...editorFont,
            position:      'absolute',
            top: '0', left: '0', right: '0', bottom: '0',
            margin:        '0',
            pointerEvents: 'none',
            overflow:      'hidden',
            borderRadius:  '4px',
            border:        '1px solid rgba(255,255,255,0.12)',
            background:    section.locked ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.25)',
        });
        const code = document.createElement('code');
        code.className   = 'language-css';
        code.textContent = section.content;
        pre.appendChild(code);

        // Input layer — transparent so the highlight layer shows through.
        const ta = document.createElement('textarea');
        ta.value        = section.content;
        ta.readOnly     = !!section.locked;
        ta.spellcheck   = false;
        ta.autocomplete = 'off';
        ta.setAttribute('autocorrect', 'off');
        ta.setAttribute('autocapitalize', 'none');
        ta.placeholder  = section.locked ? '' : '/* your CSS here */';
        Object.assign(ta.style, { ...editorFont,
            display:      'block',
            position:     'relative',
            zIndex:       '1',
            width:        '100%',
            minHeight:    '300px',
            background:   'transparent',
            color:        'transparent',
            caretColor:   '#e8e8d3',
            border:       '1px solid rgba(255,255,255,0.12)',
            borderRadius: '4px',
            resize:       'vertical',
            opacity:      section.locked ? '0.5' : '1',
        });

        function updateHighlight() {
            code.textContent = ta.value;
            if (window.Prism) Prism.highlightElement(code);
            pre.scrollTop  = ta.scrollTop;
            pre.scrollLeft = ta.scrollLeft;
        }

        ta.addEventListener('scroll', () => {
            pre.scrollTop  = ta.scrollTop;
            pre.scrollLeft = ta.scrollLeft;
        });

        ta.addEventListener('input', () => {
            section.content = ta.value;
            updateHighlight();
            syncToSource();
        });

        // Tab key inserts two spaces instead of shifting focus.
        ta.addEventListener('keydown', e => {
            if (e.key !== 'Tab') return;
            e.preventDefault();
            const start = ta.selectionStart;
            const end   = ta.selectionEnd;
            ta.value = ta.value.slice(0, start) + '  ' + ta.value.slice(end);
            ta.selectionStart = ta.selectionEnd = start + 2;
            section.content = ta.value;
            updateHighlight();
            syncToSource();
        });

        // Highlight once Prism finishes loading (async CDN).
        onPrismReady(updateHighlight);

        editorWrap.append(pre, ta);
        body.appendChild(editorWrap);
        details.append(summary, body);

        // ── HTML5 drag-and-drop (non-locked, non-pinned sections only) ──
        if (!section.locked && !section.pinned) {
            details.addEventListener('dragstart', e => {
                if (!details.draggable) { e.preventDefault(); return; }
                dragSrcIndex = sections.indexOf(section);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(dragSrcIndex));
                details.style.opacity = '0.4';
                log('Drag start, index', dragSrcIndex);
            });

            details.addEventListener('dragend', () => {
                details.draggable = false;
                details.style.opacity = '';
                document.querySelectorAll('#bcs-panels > details').forEach(el => {
                    el.style.borderTop = '';
                });
            });

            details.addEventListener('dragover', e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const tgtIdx = sections.indexOf(section);
                if (tgtIdx === dragSrcIndex) return;
                document.querySelectorAll('#bcs-panels > details').forEach(el => {
                    el.style.borderTop = '';
                });
                details.style.borderTop = '2px solid #00a4dc';
            });

            details.addEventListener('drop', e => {
                e.preventDefault();
                const tgtIdx = sections.indexOf(section);
                if (tgtIdx === dragSrcIndex || dragSrcIndex === -1) return;
                const moved = sections.splice(dragSrcIndex, 1)[0];
                sections.splice(tgtIdx, 0, moved);
                dragSrcIndex = -1;
                log('Moved section', moved.name, 'to index', tgtIdx);
                syncToSource();
                rebuildPanels();
            });
        }

        return details;
    }

    // ─── UI build / teardown ─────────────────────────────────────────────────

    function buildUI(textarea) {
        loadPrism();
        sourceTextarea = textarea;
        sections = parseSections(textarea.value);
        log('Parsed', sections.length, 'section(s).');

        const wrapper = textarea.closest('.MuiFormControl-root') || textarea.parentElement;
        wrapper.style.display = 'none';

        uiRoot    = document.createElement('div');
        uiRoot.id = 'bcs-root';
        uiRoot.style.cssText = 'margin-bottom:1.5em;';

        // ── Header row: label + export button ──
        const headerRow = document.createElement('div');
        Object.assign(headerRow.style, {
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            marginBottom:   '0.75em',
        });

        const label = document.createElement('label');
        label.textContent  = 'Custom CSS code';
        label.style.cssText = 'font-size:0.8em;color:#aaa;letter-spacing:0.03em;';

        const exportBtn = document.createElement('button');
        exportBtn.type      = 'button';
        exportBtn.className = 'emby-button';
        exportBtn.innerHTML = '<i class="material-icons" style="font-size:16px;vertical-align:middle;margin-right:4px;">download</i>Export .css';
        Object.assign(exportBtn.style, {
            background:   'none',
            border:       '1px solid rgba(255,255,255,0.18)',
            padding:      '0.25em 0.65em',
            fontSize:     '0.78em',
            cursor:       'pointer',
            borderRadius: '4px',
        });
        exportBtn.addEventListener('click', exportCSS);

        headerRow.append(label, exportBtn);
        uiRoot.appendChild(headerRow);

        // ── Panel container ──
        const panelContainer = document.createElement('div');
        panelContainer.id = 'bcs-panels';
        uiRoot.appendChild(panelContainer);

        // Insert into the DOM NOW so document.getElementById('bcs-panels') works
        // inside rebuildPanels() and any subsequent calls.
        wrapper.parentElement.insertBefore(uiRoot, wrapper);

        rebuildPanels();

        // ── Bottom button row ──
        const addRow = document.createElement('div');
        addRow.style.cssText = 'display:flex;gap:0.5em;margin-top:0.25em;flex-wrap:wrap;';

        const addBtn = document.createElement('button');
        addBtn.type      = 'button';
        addBtn.className = 'raised emby-button';
        addBtn.innerHTML = '<i class="material-icons" style="font-size:18px;vertical-align:middle;margin-right:4px;">add</i>Add Section';
        addBtn.addEventListener('click', () => {
            const n    = sections.filter(s => !s.locked && !s.pinned).length;
            const name = prompt('New section name:', `Section ${n + 1}`);
            if (!name || !name.trim()) return;
            const section = { name: name.trim().replace(/\*\//g, ''), content: '', pinned: false };
            // Insert before the first pinned section so it stays in the normal group.
            const firstPinIdx = sections.findIndex(s => s.pinned);
            firstPinIdx === -1 ? sections.push(section) : sections.splice(firstPinIdx, 0, section);
            syncToSource();
            rebuildPanels();
        });

        const addFooterBtn = document.createElement('button');
        addFooterBtn.type      = 'button';
        addFooterBtn.className = 'emby-button';
        addFooterBtn.title     = 'Add a section that always serialises at the very end of the CSS';
        addFooterBtn.innerHTML = '<i class="material-icons" style="font-size:18px;vertical-align:middle;margin-right:4px;color:#ffb833;">push_pin</i>Add Footer Section';
        Object.assign(addFooterBtn.style, {
            background: 'none',
            border:     '1px solid rgba(255,200,80,0.3)',
        });
        addFooterBtn.addEventListener('click', () => {
            const n    = sections.filter(s => s.pinned).length;
            const name = prompt('Footer section name:', `Footer ${n + 1}`);
            if (!name || !name.trim()) return;
            sections.push({ name: name.trim().replace(/\*\//g, ''), content: '', pinned: true });
            syncToSource();
            rebuildPanels();
        });

        addRow.append(addBtn, addFooterBtn);
        uiRoot.appendChild(addRow);
    }

    function teardown() {
        document.getElementById('bcs-root')?.remove();
        if (sourceTextarea) {
            const wrapper = sourceTextarea.closest('.MuiFormControl-root') || sourceTextarea.parentElement;
            if (wrapper) wrapper.style.display = '';
        }
        sourceTextarea = null;
        uiRoot         = null;
        sections       = [];
    }

    // ─── Page detection & attachment ─────────────────────────────────────────

    function isBrandingPage() {
        return window.location.hash.includes('/dashboard/branding');
    }

    function tryAttach() {
        const existingRoot = document.getElementById('bcs-root');
        if (existingRoot) {
            if (sourceTextarea && !document.contains(sourceTextarea)) {
                existingRoot.remove();
            } else {
                return true;
            }
        }
        const ta = document.querySelector('textarea[name="CustomCss"]');
        if (!ta) return false;
        buildUI(ta);
        return true;
    }

    function onNavigate() {
        clearInterval(retryTimer);
        teardown();
        if (!isBrandingPage()) return;
        let attempts = 0;
        retryTimer = setInterval(() => {
            if (tryAttach() || ++attempts > 30) clearInterval(retryTimer);
        }, 200);
    }

    // ─── SPA navigation polling ───────────────────────────────────────────────
    setInterval(() => {
        const hash = window.location.hash;
        if (hash === lastHash) return;
        lastHash = hash;
        onNavigate();
    }, POLL_INTERVAL);

    // Attach immediately if on the branding page at load time.
    if (isBrandingPage()) onNavigate();

})();
