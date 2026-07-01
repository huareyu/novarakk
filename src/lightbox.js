/**
 * Lightbox-оверлей для просмотра сгенерированных картинок (.iig-generated-image)
 * в полноэкранном размере. Клик по картинке в чате открывает её в оверлее
 * поверх всего UI; закрытие — клик по бэкдропу / крестику / Esc.
 *
 * Фичи: zoom (wheel + pinch), pan (drag), показ промпта, скачивание.
 *
 * Критичный момент — все pointer/touch/click события внутри оверлея
 * останавливаем (stopPropagation), иначе ST-драуеры ловят клик «снаружи
 * своей области» и закрываются.
 */

import { t } from './i18n.js';

const OVERLAY_ID = 'iig_lightbox';
const MIN_SCALE = 1;
const MAX_SCALE = 8;

let state = {
    scale: 1,
    translateX: 0,
    translateY: 0,
    isDragging: false,
    didDrag: false,
    startX: 0,
    startY: 0,
    lastTranslateX: 0,
    lastTranslateY: 0,
    initialPinchDist: 0,
    initialPinchScale: 1,
    prompt: '',
    style: '',
    imgSrc: '',
};

function resetState() {
    state.scale = 1;
    state.translateX = 0;
    state.translateY = 0;
    state.isDragging = false;
    state.didDrag = false;
    state.prompt = '';
    state.style = '';
    state.imgSrc = '';
}

function applyTransform(imgEl) {
    imgEl.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
}


/**
 * Инициализирует lightbox один раз. Повторный вызов — no-op.
 */
export function initLightbox() {
    if (document.getElementById(OVERLAY_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'iig-lightbox';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
        <div class="iig-lightbox-backdrop"></div>
        <div class="iig-lightbox-toolbar">
            <button class="iig-lightbox-btn iig-lightbox-zoom-in" type="button" title="${t`Zoom in`}" aria-label="${t`Zoom in`}">
                <i class="fa-solid fa-magnifying-glass-plus"></i>
            </button>
            <button class="iig-lightbox-btn iig-lightbox-zoom-out" type="button" title="${t`Zoom out`}" aria-label="${t`Zoom out`}">
                <i class="fa-solid fa-magnifying-glass-minus"></i>
            </button>
            <span class="iig-lightbox-zoom-level">100%</span>
            <button class="iig-lightbox-btn iig-lightbox-download" type="button" title="${t`Download`}" aria-label="${t`Download`}">
                <i class="fa-solid fa-download"></i>
            </button>
            <button class="iig-lightbox-btn iig-lightbox-prompt-toggle" type="button" title="${t`Show prompt`}" aria-label="${t`Show prompt`}">
                <i class="fa-solid fa-file-lines"></i>
            </button>
            <button class="iig-lightbox-btn iig-lightbox-close" type="button" title="${t`Close`}" aria-label="${t`Close`}">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="iig-lightbox-content">
            <img class="iig-lightbox-img" src="" alt="">
        </div>
        <div class="iig-lightbox-prompt-panel" aria-hidden="true">
            <div class="iig-lightbox-prompt-header">
                <span>${t`Prompt`}</span>
                <button class="iig-lightbox-btn iig-lightbox-prompt-copy" type="button" title="${t`Copy`}" aria-label="${t`Copy`}">
                    <i class="fa-solid fa-copy"></i>
                </button>
            </div>
            <div class="iig-lightbox-prompt-style"></div>
            <pre class="iig-lightbox-prompt-text"></pre>
        </div>
    `;
    document.body.appendChild(overlay);

    const imgEl = /** @type {HTMLImageElement} */ (overlay.querySelector('.iig-lightbox-img'));
    const zoomLevelEl = /** @type {HTMLElement} */ (overlay.querySelector('.iig-lightbox-zoom-level'));
    const promptPanel = /** @type {HTMLElement} */ (overlay.querySelector('.iig-lightbox-prompt-panel'));
    const promptTextEl = /** @type {HTMLElement} */ (overlay.querySelector('.iig-lightbox-prompt-text'));
    const promptStyleEl = /** @type {HTMLElement} */ (overlay.querySelector('.iig-lightbox-prompt-style'));
    const contentEl = /** @type {HTMLElement} */ (overlay.querySelector('.iig-lightbox-content'));

    function updateZoomLevel() {
        zoomLevelEl.textContent = `${Math.round(state.scale * 100)}%`;
        imgEl.style.cursor = state.scale > 1 ? 'grab' : 'zoom-in';
    }

    function zoom(delta, centerX, centerY) {
        const oldScale = state.scale;
        state.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, state.scale * delta));
        if (state.scale === oldScale) return;

        if (centerX !== undefined && centerY !== undefined) {
            const rect = contentEl.getBoundingClientRect();
            const cx = centerX - rect.left - rect.width / 2;
            const cy = centerY - rect.top - rect.height / 2;
            state.translateX = cx - (cx - state.translateX) * (state.scale / oldScale);
            state.translateY = cy - (cy - state.translateY) * (state.scale / oldScale);
        }

        if (state.scale <= 1) {
            state.translateX = 0;
            state.translateY = 0;
        }

        applyTransform(imgEl);
        updateZoomLevel();
    }

    const close = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden', 'true');
        promptPanel.setAttribute('aria-hidden', 'true');
        promptPanel.classList.remove('open');
        document.body.style.overflow = '';
        imgEl.src = '';
        imgEl.style.transform = '';
        resetState();
        updateZoomLevel();
    };

    // --- Close ---
    overlay.querySelector('.iig-lightbox-backdrop')?.addEventListener('click', close);
    overlay.querySelector('.iig-lightbox-close')?.addEventListener('click', close);

    // --- Zoom buttons ---
    overlay.querySelector('.iig-lightbox-zoom-in')?.addEventListener('click', (e) => {
        e.stopPropagation();
        zoom(1.4);
    });
    overlay.querySelector('.iig-lightbox-zoom-out')?.addEventListener('click', (e) => {
        e.stopPropagation();
        zoom(1 / 1.4);
    });

    // --- Download ---
    overlay.querySelector('.iig-lightbox-download')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const src = state.imgSrc;
        if (!src) return;
        let url = src;
        let cleanup = null;
        if (!src.startsWith('data:')) {
            try {
                const resp = await fetch(src);
                const blob = await resp.blob();
                url = URL.createObjectURL(blob);
                cleanup = () => URL.revokeObjectURL(url);
            } catch {
                return;
            }
        }
        const ext = guessExtension(src);
        const a = document.createElement('a');
        a.href = url;
        a.download = `iig_${Date.now()}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (cleanup) setTimeout(cleanup, 100);
    });

    // --- Prompt toggle ---
    overlay.querySelector('.iig-lightbox-prompt-toggle')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = promptPanel.classList.toggle('open');
        promptPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    });

    // --- Prompt copy ---
    overlay.querySelector('.iig-lightbox-prompt-copy')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = state.style
            ? `Style: ${state.style}\n\n${state.prompt}`
            : state.prompt;
        navigator.clipboard.writeText(text).then(() => {
            toastr.success(t`Copied to clipboard`, '', { timeOut: 1500 });
        });
    });

    // --- Wheel zoom ---
    contentEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        zoom(delta, e.clientX, e.clientY);
    }, { passive: false });

    // --- Click on image: zoom in if scale=1, reset if zoomed (but NOT after drag) ---
    imgEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (state.didDrag) {
            state.didDrag = false;
            return;
        }
        if (state.scale > 1) {
            state.scale = 1;
            state.translateX = 0;
            state.translateY = 0;
            applyTransform(imgEl);
            updateZoomLevel();
        } else {
            zoom(2.5, e.clientX, e.clientY);
        }
    });

    // --- Drag/pan ---
    const DRAG_THRESHOLD = 5;

    contentEl.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (state.scale <= 1) return;
        state.isDragging = true;
        state.didDrag = false;
        state.startX = e.clientX;
        state.startY = e.clientY;
        state.lastTranslateX = state.translateX;
        state.lastTranslateY = state.translateY;
        imgEl.style.cursor = 'grabbing';
        imgEl.setPointerCapture(e.pointerId);
    });

    contentEl.addEventListener('pointermove', (e) => {
        if (!state.isDragging) return;
        e.stopPropagation();
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (!state.didDrag && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
            state.didDrag = true;
        }
        state.translateX = state.lastTranslateX + dx;
        state.translateY = state.lastTranslateY + dy;
        applyTransform(imgEl);
    });

    const endDrag = (e) => {
        if (!state.isDragging) return;
        e?.stopPropagation();
        state.isDragging = false;
        imgEl.style.cursor = state.scale > 1 ? 'grab' : 'zoom-in';
    };
    contentEl.addEventListener('pointerup', endDrag);
    contentEl.addEventListener('pointercancel', endDrag);

    // --- Pinch-to-zoom (touch) ---
    let activeTouches = [];
    contentEl.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        activeTouches = Array.from(e.touches);
        if (activeTouches.length === 2) {
            e.preventDefault();
            state.initialPinchDist = getTouchDist(activeTouches);
            state.initialPinchScale = state.scale;
        }
    }, { passive: false });

    contentEl.addEventListener('touchmove', (e) => {
        e.stopPropagation();
        if (e.touches.length === 2) {
            e.preventDefault();
            const dist = getTouchDist(Array.from(e.touches));
            const delta = dist / state.initialPinchDist;
            const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, state.initialPinchScale * delta));
            if (newScale !== state.scale) {
                state.scale = newScale;
                if (state.scale <= 1) {
                    state.translateX = 0;
                    state.translateY = 0;
                }
                applyTransform(imgEl);
                updateZoomLevel();
            }
        }
    }, { passive: false });

    contentEl.addEventListener('touchend', (e) => {
        e.stopPropagation();
        activeTouches = Array.from(e.touches);
    }, { passive: true });

    // --- Block native drag so ST doesn't try to import the image ---
    imgEl.draggable = false;
    imgEl.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
    const blockDrag = (e) => { e.preventDefault(); e.stopPropagation(); };
    overlay.addEventListener('dragstart', blockDrag);
    overlay.addEventListener('dragover', blockDrag);
    overlay.addEventListener('dragenter', blockDrag);
    overlay.addEventListener('dragleave', blockDrag);
    overlay.addEventListener('drop', blockDrag);

    // --- Stop all bubbles to protect ST drawers ---
    const stopBubble = (e) => e.stopPropagation();
    overlay.addEventListener('touchstart', stopBubble, { passive: true });
    overlay.addEventListener('touchend', stopBubble, { passive: true });
    overlay.addEventListener('pointerdown', stopBubble);
    overlay.addEventListener('pointerup', stopBubble);
    overlay.addEventListener('mousedown', stopBubble);

    // --- Esc ---
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('open')) {
            close(e);
        }
    });

    // --- Delegation: click on chat images ---
    const chatEl = document.getElementById('chat');
    chatEl?.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        const img = /** @type {HTMLImageElement|null} */ (
            target?.closest('.iig-generated-image') || target?.closest('img[data-iig-instruction]')
        );
        if (!img) return;
        if (img.classList.contains('iig-error-image')) return;

        e.preventDefault();
        e.stopPropagation();

        resetState();
        state.imgSrc = img.src;

        imgEl.src = img.src;
        imgEl.alt = img.alt || '';
        imgEl.style.transform = '';

        // Extract prompt from data-iig-instruction
        const instruction = img.getAttribute('data-iig-instruction');
        if (instruction) {
            try {
                const decoded = instruction
                    .replace(/&quot;/g, '"')
                    .replace(/&apos;/g, "'")
                    .replace(/&#39;/g, "'")
                    .replace(/&#34;/g, '"')
                    .replace(/&amp;/g, '&');
                const data = JSON.parse(decoded);
                state.prompt = data.prompt || '';
                state.style = data.style || '';
            } catch {
                state.prompt = img.alt || '';
                state.style = '';
            }
        } else {
            state.prompt = img.alt || '';
            state.style = '';
        }

        promptTextEl.textContent = state.prompt || t`No prompt available`;
        if (state.style) {
            promptStyleEl.textContent = `Style: ${state.style}`;
            promptStyleEl.style.display = '';
        } else {
            promptStyleEl.textContent = '';
            promptStyleEl.style.display = 'none';
        }

        promptPanel.classList.remove('open');
        promptPanel.setAttribute('aria-hidden', 'true');

        updateZoomLevel();

        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    });
}

function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
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
