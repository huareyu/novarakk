/**
 * Chat Image Gallery — modal overlay showing all generated images
 * in the current chat as a browseable grid with file-manager actions:
 * view (lightbox), select, bulk download, bulk delete,
 * pagination, sorting, and configurable page size.
 */

import { t } from './i18n.js';
import { getSettings, iigLog } from './settings.js';
import { sanitizeForHtml } from './utils.js';
import { rerenderMessageHtml } from './parser.js';

const GALLERY_OVERLAY_ID = 'iig_gallery_overlay';
const PAGE_SIZE_OPTIONS = [6, 12, 24, 48];
const DEFAULT_PER_PAGE = 12;

// ── Collect images from current chat ──

function collectChatImages() {
    const context = SillyTavern.getContext();
    if (!context.chat || context.chat.length === 0) return [];

    const results = [];
    const messageElements = document.querySelectorAll('#chat .mes');

    for (const mesEl of messageElements) {
        const mesId = mesEl.getAttribute('mesid');
        if (mesId === null) continue;
        const messageId = parseInt(mesId, 10);
        const message = context.chat[messageId];
        if (!message) continue;

        const imgs = mesEl.querySelectorAll('img[data-iig-instruction]');
        for (let i = 0; i < imgs.length; i++) {
            const img = imgs[i];
            if (!img.src || img.src.endsWith('[IMG:GEN]')) continue;
            if (img.classList.contains('iig-error-image')) continue;

            let prompt = '';
            let style = '';
            const instruction = img.getAttribute('data-iig-instruction');
            if (instruction) {
                try {
                    const decoded = instruction
                        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
                        .replace(/&#39;/g, "'").replace(/&#34;/g, '"')
                        .replace(/&amp;/g, '&');
                    const data = JSON.parse(decoded);
                    prompt = data.prompt || '';
                    style = data.style || '';
                } catch { /* ignore */ }
            }

            const src = img.src;
            const filename = src.includes('/') ? src.split('/').pop() : src;

            results.push({
                src,
                prompt,
                style,
                messageId,
                tagIndex: i,
                filename: filename || `image_${i}`,
                isUser: !!message.is_user,
                charName: message.name || '',
            });
        }
    }

    return results;
}

// ── Gallery state ──

let gs = {
    images: [],
    selected: new Set(),
    selectMode: false,
    page: 0,
    sort: 'newest',
    perPage: DEFAULT_PER_PAGE,
};

function resetState() {
    const perPage = gs.perPage || DEFAULT_PER_PAGE;
    gs = { images: [], selected: new Set(), selectMode: false, page: 0, sort: 'newest', perPage };
}

function getSorted() {
    const imgs = gs.images.slice();
    switch (gs.sort) {
        case 'oldest':
            imgs.sort((a, b) => a.messageId - b.messageId || a.tagIndex - b.tagIndex);
            break;
        case 'name-asc':
            imgs.sort((a, b) => a.filename.localeCompare(b.filename));
            break;
        case 'name-desc':
            imgs.sort((a, b) => b.filename.localeCompare(a.filename));
            break;
        default: // newest
            imgs.sort((a, b) => b.messageId - a.messageId || b.tagIndex - a.tagIndex);
            break;
    }
    return imgs;
}

function getTotalPages() {
    return Math.max(1, Math.ceil(getSorted().length / gs.perPage));
}

function getPageImages() {
    const sorted = getSorted();
    const start = gs.page * gs.perPage;
    return sorted.slice(start, start + gs.perPage);
}

function clampPage() {
    const tp = getTotalPages();
    if (gs.page >= tp) gs.page = Math.max(0, tp - 1);
}

// ── Refresh helper ──

function refreshGallery() {
    gs.images = collectChatImages();
    gs.selected.clear();
    clampPage();
    const overlay = document.getElementById(GALLERY_OVERLAY_ID);
    if (!overlay) return;
    const bodyEl = overlay.querySelector('#iig_gallery_body');
    updateSelectionUI(overlay);
    if (bodyEl) renderContent(bodyEl);
}

// ── Gallery modal ──

export function openGallery() {
    if (document.getElementById(GALLERY_OVERLAY_ID)) return;

    const images = collectChatImages();
    resetState();
    gs.images = images;

    const overlay = document.createElement('div');
    overlay.id = GALLERY_OVERLAY_ID;
    overlay.className = 'iig-gallery-overlay';

    overlay.innerHTML = `
        <div class="iig-gallery-modal">
            <div class="iig-gallery-header">
                <span class="iig-gallery-title"><i class="fa-solid fa-images"></i> ${t`Chat Gallery`}</span>
                <span class="iig-gallery-count" id="iig_gallery_count"></span>
                <div class="iig-gallery-header-actions">
                    <select class="iig-gallery-sort" id="iig_gallery_sort" title="${t`Sort`}">
                        <option value="newest" selected>${t`Newest`}</option>
                        <option value="oldest">${t`Oldest`}</option>
                        <option value="name-asc">A → Z</option>
                        <option value="name-desc">Z → A</option>
                    </select>
                    <select class="iig-gallery-perpage" id="iig_gallery_perpage" title="${t`Per page`}">
                        ${PAGE_SIZE_OPTIONS.map(n => `<option value="${n}" ${n === gs.perPage ? 'selected' : ''}>${n}</option>`).join('')}
                    </select>
                    <button class="iig-gallery-btn" id="iig_gallery_select_toggle" type="button" title="${t`Selection mode`}">
                        <i class="fa-regular fa-square-check"></i>
                    </button>
                    <button class="iig-gallery-btn" id="iig_gallery_select_all" type="button" title="${t`Select all`}" style="display:none">
                        <i class="fa-solid fa-check-double"></i>
                    </button>
                    <button class="iig-gallery-btn iig-gallery-btn-danger" id="iig_gallery_delete_selected" type="button" title="${t`Delete selected`}" style="display:none">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                    <button class="iig-gallery-btn" id="iig_gallery_download_selected" type="button" title="${t`Download selected`}" style="display:none">
                        <i class="fa-solid fa-download"></i>
                    </button>
                    <button class="iig-gallery-btn iig-gallery-close" id="iig_gallery_close" type="button" title="${t`Close`}">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>
            <div class="iig-gallery-body" id="iig_gallery_body"></div>
        </div>
    `;

    document.body.appendChild(overlay);

    const modal = overlay.querySelector('.iig-gallery-modal');
    const bodyEl = overlay.querySelector('#iig_gallery_body');

    // Close
    const close = () => { resetState(); overlay.remove(); };
    overlay.querySelector('#iig_gallery_close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape' && document.getElementById(GALLERY_OVERLAY_ID)) {
            e.stopPropagation();
            close();
            document.removeEventListener('keydown', escHandler, true);
        }
    }, true);

    // Stop bubbling
    for (const ev of ['click', 'mousedown', 'pointerdown']) {
        modal.addEventListener(ev, (e) => e.stopPropagation());
    }

    // Sort
    overlay.querySelector('#iig_gallery_sort').addEventListener('change', (e) => {
        gs.sort = e.target.value;
        gs.page = 0;
        gs.selected.clear();
        updateSelectionUI(overlay);
        renderContent(bodyEl);
    });

    // Per page
    overlay.querySelector('#iig_gallery_perpage').addEventListener('change', (e) => {
        gs.perPage = parseInt(e.target.value, 10) || DEFAULT_PER_PAGE;
        gs.page = 0;
        gs.selected.clear();
        updateSelectionUI(overlay);
        renderContent(bodyEl);
    });

    // Selection mode toggle
    overlay.querySelector('#iig_gallery_select_toggle').addEventListener('click', () => {
        gs.selectMode = !gs.selectMode;
        gs.selected.clear();
        updateSelectionUI(overlay);
        renderContent(bodyEl);
    });

    // Select all (on current page)
    overlay.querySelector('#iig_gallery_select_all').addEventListener('click', () => {
        const pageImgs = getPageImages();
        const allOnPage = pageImgs.every((_, i) => gs.selected.has(gs.page * gs.perPage + i));
        if (allOnPage) {
            pageImgs.forEach((_, i) => gs.selected.delete(gs.page * gs.perPage + i));
        } else {
            pageImgs.forEach((_, i) => gs.selected.add(gs.page * gs.perPage + i));
        }
        updateSelectionUI(overlay);
        renderContent(bodyEl);
    });

    // Download selected
    overlay.querySelector('#iig_gallery_download_selected').addEventListener('click', async () => {
        const selected = getSelectedImages();
        for (const img of selected) {
            await downloadGalleryImage(img);
        }
        toastr.success(`${t`Download`}: ${selected.length}`, t`Gallery`, { timeOut: 2000 });
    });

    // Delete selected
    overlay.querySelector('#iig_gallery_delete_selected').addEventListener('click', async () => {
        const selected = getSelectedImages();
        if (selected.length === 0) return;
        const confirmed = confirm(`${t`Delete selected`} (${selected.length})? ${t`This cannot be undone.`}`);
        if (!confirmed) return;

        for (const img of selected) {
            await deleteImageFromChat(img);
        }

        refreshGallery();
        toastr.success(`${t`Delete selected`}: ${selected.length}`, t`Gallery`, { timeOut: 2000 });
    });

    renderContent(bodyEl);
    updateCount(overlay);
}

function getSelectedImages() {
    const sorted = getSorted();
    return Array.from(gs.selected)
        .sort((a, b) => b - a)
        .map(idx => sorted[idx])
        .filter(Boolean);
}

function updateSelectionUI(overlay) {
    const toggleBtn = overlay.querySelector('#iig_gallery_select_toggle');
    const selectAllBtn = overlay.querySelector('#iig_gallery_select_all');
    const deleteBtn = overlay.querySelector('#iig_gallery_delete_selected');
    const downloadBtn = overlay.querySelector('#iig_gallery_download_selected');

    toggleBtn.classList.toggle('iig-gallery-btn-active', gs.selectMode);
    selectAllBtn.style.display = gs.selectMode ? '' : 'none';
    deleteBtn.style.display = gs.selectMode ? '' : 'none';
    downloadBtn.style.display = gs.selectMode ? '' : 'none';

    deleteBtn.disabled = gs.selected.size === 0;
    downloadBtn.disabled = gs.selected.size === 0;

    updateCount(overlay);
}

function updateCount(overlay) {
    const countEl = overlay.querySelector('#iig_gallery_count');
    if (!countEl) return;
    const total = gs.images.length;
    const selCount = gs.selected.size;
    if (gs.selectMode && selCount > 0) {
        countEl.textContent = `${selCount} / ${total}`;
    } else {
        countEl.textContent = `${total}`;
    }
}

// ── Render grid + pagination ──

function renderContent(bodyEl) {
    clampPage();
    const sorted = getSorted();

    if (sorted.length === 0) {
        bodyEl.innerHTML = `<div class="iig-gallery-empty"><i class="fa-regular fa-image"></i><p>${t`No generated images in this chat`}</p></div>`;
        return;
    }

    const pageImages = getPageImages();
    const startIdx = gs.page * gs.perPage;

    const cardsHtml = pageImages.map((img, i) => {
        const globalIdx = startIdx + i;
        const isSelected = gs.selected.has(globalIdx);
        const promptShort = (img.prompt || '').slice(0, 80) + ((img.prompt || '').length > 80 ? '…' : '');

        return `
            <div class="iig-gallery-card ${isSelected ? 'iig-gallery-card-selected' : ''}" data-gallery-idx="${globalIdx}">
                <div class="iig-gallery-thumb-wrap">
                    <img class="iig-gallery-thumb" src="${sanitizeForHtml(img.src)}" alt="" loading="lazy">
                    ${gs.selectMode ? `<div class="iig-gallery-checkbox ${isSelected ? 'checked' : ''}"><i class="fa-${isSelected ? 'solid fa-square-check' : 'regular fa-square'}"></i></div>` : ''}
                </div>
                <div class="iig-gallery-card-info">
                    <span class="iig-gallery-card-msg" title="${t`Message`} #${img.messageId}">#${img.messageId} · ${sanitizeForHtml(img.charName)}</span>
                    <span class="iig-gallery-card-filename" title="${sanitizeForHtml(img.filename)}">${sanitizeForHtml(img.filename)}</span>
                    ${promptShort ? `<span class="iig-gallery-card-prompt" title="${sanitizeForHtml(img.prompt)}">${sanitizeForHtml(promptShort)}</span>` : ''}
                </div>
                <div class="iig-gallery-card-actions">
                    <button class="iig-gallery-card-btn" data-gallery-action="download" data-gallery-idx="${globalIdx}" title="${t`Download`}"><i class="fa-solid fa-download"></i></button>
                    <button class="iig-gallery-card-btn iig-gallery-card-btn-danger" data-gallery-action="delete" data-gallery-idx="${globalIdx}" title="${t`Delete`}"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
    }).join('');

    const paginationHtml = buildPaginationHtml();

    bodyEl.innerHTML = `
        <div class="iig-gallery-grid">${cardsHtml}</div>
        ${paginationHtml}
    `;

    bodyEl.removeEventListener('click', handleBodyClick);
    bodyEl.addEventListener('click', handleBodyClick);
}

function buildPaginationHtml() {
    const totalPages = getTotalPages();
    if (totalPages <= 1) return '';

    const pages = [];
    for (let i = 0; i < totalPages; i++) {
        if (totalPages > 7) {
            const show = i === 0 || i === totalPages - 1
                || (i >= gs.page - 1 && i <= gs.page + 1);
            if (!show) {
                if (pages.length && pages[pages.length - 1] !== '…') pages.push('…');
                continue;
            }
        }
        pages.push(i);
    }

    const btns = pages.map(p => {
        if (p === '…') return `<span class="iig-gallery-page-ellipsis">…</span>`;
        return `<button class="iig-gallery-page-btn ${p === gs.page ? 'active' : ''}" data-gallery-page="${p}" type="button">${p + 1}</button>`;
    }).join('');

    return `
        <div class="iig-gallery-pagination">
            <button class="iig-gallery-page-btn" data-gallery-page-prev type="button" ${gs.page <= 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
            ${btns}
            <button class="iig-gallery-page-btn" data-gallery-page-next type="button" ${gs.page >= totalPages - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>
        </div>
    `;
}

// ── Delegated click handler ──

function handleBodyClick(e) {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    // Pagination
    const pageBtn = target.closest('[data-gallery-page]');
    if (pageBtn) {
        gs.page = parseInt(pageBtn.getAttribute('data-gallery-page'), 10);
        gs.selected.clear();
        const overlay = document.getElementById(GALLERY_OVERLAY_ID);
        const bodyEl = overlay?.querySelector('#iig_gallery_body');
        if (overlay) updateSelectionUI(overlay);
        if (bodyEl) renderContent(bodyEl);
        bodyEl?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    if (target.closest('[data-gallery-page-prev]')) {
        if (gs.page > 0) { gs.page--; gs.selected.clear(); }
        const overlay = document.getElementById(GALLERY_OVERLAY_ID);
        const bodyEl = overlay?.querySelector('#iig_gallery_body');
        if (overlay) updateSelectionUI(overlay);
        if (bodyEl) renderContent(bodyEl);
        bodyEl?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    if (target.closest('[data-gallery-page-next]')) {
        if (gs.page < getTotalPages() - 1) { gs.page++; gs.selected.clear(); }
        const overlay = document.getElementById(GALLERY_OVERLAY_ID);
        const bodyEl = overlay?.querySelector('#iig_gallery_body');
        if (overlay) updateSelectionUI(overlay);
        if (bodyEl) renderContent(bodyEl);
        bodyEl?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    // Card action buttons
    const actionBtn = target.closest('[data-gallery-action]');
    if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.getAttribute('data-gallery-action');
        const idx = parseInt(actionBtn.getAttribute('data-gallery-idx'), 10);
        const sorted = getSorted();
        const img = sorted[idx];
        if (!img) return;

        if (action === 'download') {
            downloadGalleryImage(img);
        } else if (action === 'delete') {
            handleSingleDelete(idx);
        }
        return;
    }

    // Card click — select mode or lightbox
    const card = target.closest('.iig-gallery-card[data-gallery-idx]');
    if (card) {
        const idx = parseInt(card.getAttribute('data-gallery-idx'), 10);
        if (gs.selectMode) {
            if (gs.selected.has(idx)) gs.selected.delete(idx);
            else gs.selected.add(idx);
            const overlay = document.getElementById(GALLERY_OVERLAY_ID);
            const bodyEl = overlay?.querySelector('#iig_gallery_body');
            if (overlay) updateSelectionUI(overlay);
            if (bodyEl) renderContent(bodyEl);
        } else {
            openGalleryLightbox(idx);
        }
    }
}

// ── Single delete ──

async function handleSingleDelete(idx) {
    const sorted = getSorted();
    const img = sorted[idx];
    if (!img) return;
    const confirmed = confirm(t`Delete this image from chat?`);
    if (!confirmed) return;

    await deleteImageFromChat(img);
    refreshGallery();
    toastr.success(t`Image deleted`, t`Gallery`, { timeOut: 2000 });
}

// ── Lightbox from gallery ──

function openGalleryLightbox(idx) {
    const sorted = getSorted();
    const img = sorted[idx];
    if (!img) return;

    const overlay = document.getElementById(GALLERY_OVERLAY_ID);
    if (overlay) overlay.style.display = 'none';

    const mesEl = document.querySelector(`#chat .mes[mesid="${img.messageId}"]`);
    if (!mesEl) { if (overlay) overlay.style.display = ''; return; }
    const imgs = mesEl.querySelectorAll('img[data-iig-instruction]');
    const target = imgs[img.tagIndex];
    if (target && !target.classList.contains('iig-error-image')) {
        target.click();

        const lightbox = document.getElementById('iig_lightbox');
        if (lightbox) {
            const observer = new MutationObserver(() => {
                if (!lightbox.classList.contains('open')) {
                    observer.disconnect();
                    if (overlay) overlay.style.display = '';
                }
            });
            observer.observe(lightbox, { attributes: true, attributeFilter: ['class'] });
        } else {
            if (overlay) overlay.style.display = '';
        }
    } else {
        if (overlay) overlay.style.display = '';
    }
}

// ── Download ──

async function downloadGalleryImage(img) {
    const src = img.src;
    let url = src;
    let cleanup = null;
    if (!src.startsWith('data:')) {
        try {
            const resp = await fetch(src);
            const blob = await resp.blob();
            url = URL.createObjectURL(blob);
            cleanup = () => URL.revokeObjectURL(url);
        } catch (err) {
            iigLog('ERROR', 'Gallery image download failed:', err);
            return;
        }
    }
    const ext = guessExtension(src);
    const a = document.createElement('a');
    a.href = url;
    a.download = img.filename || `iig_${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (cleanup) setTimeout(cleanup, 100);
}

function guessExtension(src) {
    if (src.startsWith('data:')) {
        const m = src.match(/^data:image\/([a-z0-9+]+)/i);
        if (m) return m[1].replace('jpeg', 'jpg');
    }
    const m = src.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    if (m) return m[1].toLowerCase();
    return 'png';
}

// ── Delete image from chat message ──

async function deleteImageFromChat(img) {
    const context = SillyTavern.getContext();
    const message = context.chat[img.messageId];
    if (!message) return;

    const srcPattern = img.src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const imgTagRegex = new RegExp(
        `<img\\s[^>]*src\\s*=\\s*["']${srcPattern}["'][^>]*>`,
        'i',
    );

    if (message.mes) message.mes = message.mes.replace(imgTagRegex, '');
    if (message.extra?.display_text) message.extra.display_text = message.extra.display_text.replace(imgTagRegex, '');

    const mesEl = document.querySelector(`#chat .mes[mesid="${img.messageId}"]`);
    const mesTextEl = mesEl?.querySelector('.mes_text');
    if (mesTextEl) {
        const settings = getSettings();
        rerenderMessageHtml(context, message, settings, img.messageId, mesTextEl);
    }

    await context.saveChat();

    if (img.src && !img.src.startsWith('data:')) {
        try {
            const path = img.src.startsWith('/') ? img.src : new URL(img.src, location.origin).pathname;
            await fetch('/api/images/delete', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({ path }),
            });
        } catch (err) {
            iigLog('WARN', 'Gallery: failed to delete image file:', err);
        }
    }
}

// ── Wand menu button ──

export function addGalleryWandButton() {
    if (document.getElementById('iig_gallery_wand_button')) return;

    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;

    const btn = document.createElement('div');
    btn.id = 'iig_gallery_wand_button';
    btn.className = 'list-group-item flex-container flexGap5';
    btn.innerHTML = `<div class="fa-solid fa-images extensionsMenuExtensionButton"></div><span>${t`Chat Gallery`}</span>`;
    btn.addEventListener('click', () => openGallery());
    menu.appendChild(btn);
}

// ── Init ──

export function initGallery() {
    const context = SillyTavern.getContext();
    context.eventSource.on(context.event_types.APP_READY, () => {
        addGalleryWandButton();
    });
}
