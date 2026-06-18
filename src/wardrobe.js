/**
 * Wardrobe module — ported from SillyImages SillyWardrobe.
 *
 * Single outfit per side (bot / user), shared / per-character wardrobe,
 * outfit types (customizable categories), try-on (AI full-body generation),
 * pagination, sorting, NPC manager, quick settings, maintenance tools.
 */

import { getSettings, iigLog, MODULE_NAME } from './settings.js';
import {
    resolveActiveProvider,
    validateSettings as validateProviderSettings,
} from './providers.js';
import {
    getCharacterAvatarBase64,
    getUserAvatarBase64,
} from './references.js';
import {
    imageUrlToDataUrl,
    convertDataUrlToPng,
    parseImageDataUrl,
} from './utils.js';
import { callVisionApi, DEFAULT_VISION_PROMPT } from './vision.js';

// ── Constants ──

const SW = 'silly_wardrobe';

function uid() { return Date.now().toString(36) + Math.random().toString(36).substring(2, 8); }
function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }

function swSanitizeDesc(raw) {
    let s = String(raw || '');
    s = s.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '');
    s = s.replace(/<\/?think\b[^>]*>/gi, '');
    s = s.replace(/```(?:thinking|thought|reasoning)[\s\S]*?```/gi, '');
    s = s.replace(/\[(?:thinking|thought|reasoning)\][\s\S]*?\[\/(?:thinking|thought|reasoning)\]/gi, '');
    return s.replace(/\s+/g, ' ').trim();
}

const SW_DEFAULT_TYPES = [
    { id: 'casual', label: 'Повседневное',   icon: 'fa-shirt' },
    { id: 'formal', label: 'Формальное',     icon: 'fa-gem' },
    { id: 'sport',  label: 'Спортивное',     icon: 'fa-person-running' },
    { id: 'sleep',  label: 'Спальное',       icon: 'fa-bed' },
    { id: 'beach',  label: 'Пляж/купальник', icon: 'fa-umbrella-beach' },
    { id: 'work',   label: 'Работа',         icon: 'fa-briefcase' },
    { id: 'outer',  label: 'Верхняя',        icon: 'fa-mitten' },
    { id: 'other',  label: 'Другое',         icon: 'fa-tag' },
];
const SW_FALLBACK_TYPE = 'other';
const SW_TYPE_ICONS = [
    'fa-shirt', 'fa-gem', 'fa-person-running', 'fa-bed', 'fa-umbrella-beach',
    'fa-briefcase', 'fa-mitten', 'fa-tag', 'fa-crown', 'fa-hat-cowboy',
    'fa-vest', 'fa-socks', 'fa-shoe-prints', 'fa-glasses', 'fa-ring',
    'fa-user-tie', 'fa-user-ninja', 'fa-mask', 'fa-snowflake', 'fa-sun',
    'fa-heart', 'fa-star', 'fa-wand-magic-sparkles', 'fa-dragon',
];

const swDefaults = Object.freeze({
    wardrobes: {}, activeOutfits: {},
    sharedUserWardrobe: [], sharedUserActive: null, sharedUserActiveByChat: {}, useSharedUserWardrobe: false,
    sharedBotWardrobe:  [], sharedBotActive:  null, sharedBotActiveByChat:  {}, useSharedBotWardrobe:  false,
    maxDimension: 512, showFloatingBtn: false,
});

// ── Settings ──

export function swGetSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[SW]) ctx.extensionSettings[SW] = structuredClone(swDefaults);
    const s = ctx.extensionSettings[SW];
    for (const k of Object.keys(swDefaults)) if (!Object.hasOwn(s, k)) s[k] = structuredClone(swDefaults[k]);
    if (!Array.isArray(s.sharedUserWardrobe)) s.sharedUserWardrobe = [];
    if (!Array.isArray(s.sharedBotWardrobe)) s.sharedBotWardrobe = [];
    if (!s.sharedUserActiveByChat || typeof s.sharedUserActiveByChat !== 'object') s.sharedUserActiveByChat = {};
    if (!s.sharedBotActiveByChat || typeof s.sharedBotActiveByChat !== 'object') s.sharedBotActiveByChat = {};
    if (!Array.isArray(s.outfitTypes) || !s.outfitTypes.length) {
        s.outfitTypes = structuredClone(SW_DEFAULT_TYPES);
        swMigrateTypeId(s, 'underwear', 'work');
    }
    if (s.outfitTypes.some(t => !t || typeof t.id !== 'string' || !t.id)) {
        s.outfitTypes = s.outfitTypes.filter(t => t && typeof t.id === 'string' && t.id);
    }
    if (!s.outfitTypes.some(t => t.id === SW_FALLBACK_TYPE)) s.outfitTypes.push({ id: SW_FALLBACK_TYPE, label: 'Другое', icon: 'fa-tag' });
    return s;
}

function swForEachOutfit(s, cb) {
    const arrays = [s.sharedBotWardrobe, s.sharedUserWardrobe];
    for (const w of Object.values(s.wardrobes || {})) if (w) arrays.push(w.bot, w.user);
    for (const arr of arrays) if (Array.isArray(arr)) for (const o of arr) if (o) cb(o);
}

function swMigrateTypeId(s, oldId, newId) { swForEachOutfit(s, (o) => { if (o.type === oldId) o.type = newId; }); }

function swTypes() { return swGetSettings().outfitTypes; }
function swTypeIds() { return swTypes().map(t => t.id); }
function swTypeOf(o) { return (o && swTypeIds().includes(o.type)) ? o.type : SW_FALLBACK_TYPE; }
function swTypeMeta(id) { const ts = swTypes(); return ts.find(t => t.id === id) || ts.find(t => t.id === SW_FALLBACK_TYPE) || ts[ts.length - 1]; }

function swPlural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
}

function swImgSrc(o) {
    if (!o) return '';
    if (o.imagePath) return o.imagePath;
    if (o.base64) return 'data:image/png;base64,' + o.base64;
    return '';
}

// ── Tag manager ──

function swRenderTagManager(listEl) {
    if (!listEl) return;
    const types = swTypes();
    listEl.innerHTML = types.map(t => {
        const locked = t.id === SW_FALLBACK_TYPE;
        const icons = SW_TYPE_ICONS.map(ic => `<button type="button" class="sw-tag-ico-opt ${ic === t.icon ? 'sw-tag-ico-sel' : ''}" data-ico="${ic}" title="${ic}"><i class="fa-solid ${ic}"></i></button>`).join('');
        return `<div class="sw-tag-block">
            <div class="sw-tag-row" data-id="${esc(t.id)}">
                <button type="button" class="sw-tag-icon" title="Сменить иконку"><i class="fa-solid ${esc(t.icon || 'fa-tag')}"></i></button>
                <input type="text" class="sw-tag-name text_pole" value="${esc(t.label || '')}" maxlength="24" placeholder="Название тега">
                ${locked
                    ? '<span class="sw-tag-lock" title="Запасной тег — удалить нельзя"><i class="fa-solid fa-lock"></i></span>'
                    : '<button type="button" class="sw-tag-del" title="Удалить тег"><i class="fa-solid fa-trash-can"></i></button>'}
            </div>
            <div class="sw-tag-icons" hidden>${icons}</div>
        </div>`;
    }).join('');

    const refreshMain = () => { if (swOpen) swRender(); };

    for (const block of listEl.querySelectorAll('.sw-tag-block')) {
        const row = block.querySelector('.sw-tag-row');
        const id = row.dataset.id;
        const iconsBox = block.querySelector('.sw-tag-icons');
        const tag = () => swTypes().find(x => x.id === id);

        row.querySelector('.sw-tag-icon').addEventListener('click', () => {
            const willShow = iconsBox.hidden;
            for (const b of listEl.querySelectorAll('.sw-tag-icons')) b.hidden = true;
            iconsBox.hidden = !willShow;
        });
        for (const opt of iconsBox.querySelectorAll('.sw-tag-ico-opt')) {
            opt.addEventListener('click', () => {
                const t = tag(); if (!t) return;
                t.icon = opt.dataset.ico; swSave();
                swRenderTagManager(listEl); refreshMain();
            });
        }

        const nameInp = row.querySelector('.sw-tag-name');
        nameInp.addEventListener('input', () => { const t = tag(); if (t) { t.label = nameInp.value; swSave(); } });
        nameInp.addEventListener('change', () => {
            const t = tag(); if (!t) return;
            t.label = nameInp.value.trim() || t.label || 'Тег';
            nameInp.value = t.label; swSave(); refreshMain();
        });

        row.querySelector('.sw-tag-del')?.addEventListener('click', () => {
            const s = swGetSettings();
            let moved = 0;
            swForEachOutfit(s, (o) => { if (o.type === id) { o.type = SW_FALLBACK_TYPE; moved++; } });
            s.outfitTypes = s.outfitTypes.filter(x => x.id !== id);
            if (swFilter === id) swFilter = 'all';
            swSave();
            swRenderTagManager(listEl); refreshMain();
            toastr.info(`Тег удалён${moved ? ` · ${moved} ${swPlural(moved, 'наряд', 'наряда', 'нарядов')} → «Другое»` : ''}`, 'Гардероб', { timeOut: 2500 });
        });
    }
}

// ── State ──

let swOpen = false, swTab = 'bot';
let swFilter = 'all';
let swSort = 'added';
const SW_PAGE_SIZE = 11;
let swPage = 0;

function swSortOutfits(arr, activeId) {
    const a = arr.slice();
    if (swSort === 'name') {
        a.sort((x, y) => (x.name || '').localeCompare(y.name || '', undefined, { sensitivity: 'base', numeric: true }));
    } else if (swSort === 'worn') {
        a.sort((x, y) => (y.lastWorn || 0) - (x.lastWorn || 0) || (y.addedAt || 0) - (x.addedAt || 0));
    } else {
        a.sort((x, y) => (y.addedAt || 0) - (x.addedAt || 0));
    }
    if (activeId) {
        const i = a.findIndex(o => o.id === activeId);
        if (i > 0) a.unshift(a.splice(i, 1)[0]);
    }
    return a;
}

const swSharedCache = { bot: { b64: null, id: null }, user: { b64: null, id: null } };
function swSave() { SillyTavern.getContext().saveSettingsDebounced(); }

function swCharName() {
    const ctx = SillyTavern.getContext();
    return (ctx.characterId !== undefined && ctx.characters?.[ctx.characterId]) ? (ctx.characters[ctx.characterId].name || '') : '';
}

function swGetWardrobe(cn) { const s = swGetSettings(); if (!s.wardrobes[cn]) s.wardrobes[cn] = { bot: [], user: [] }; return s.wardrobes[cn]; }
function swGetActive() { const cn = swCharName(); if (!cn) return { bot: null, user: null }; const s = swGetSettings(); if (!s.activeOutfits[cn]) s.activeOutfits[cn] = { bot: null, user: null }; return s.activeOutfits[cn]; }
function swSetActive(type, id) { const cn = swCharName(); if (!cn) { toastr.error('Персонаж не выбран', 'Гардероб'); return false; } const s = swGetSettings(); if (!s.activeOutfits[cn]) s.activeOutfits[cn] = { bot: null, user: null }; s.activeOutfits[cn][type] = id; swSave(); return true; }
function swFind(cn, type, id) { return swGetWardrobe(cn)[type].find(o => o.id === id) || null; }
function swAdd(cn, type, o) { swGetWardrobe(cn)[type].push(o); swSave(); }
function swRemove(cn, type, id) { const w = swGetWardrobe(cn); w[type] = w[type].filter(o => o.id !== id); swSave(); if (swGetActive()[type] === id) { swSetActive(type, null); swUpdatePromptInjection(); } }

// ── Shared wardrobe per side ──

function swSharedCfg(side) {
    const s = swGetSettings();
    const k = side === 'bot'
        ? { list: 'sharedBotWardrobe',  active: 'sharedBotActive',  byChat: 'sharedBotActiveByChat',  use: 'useSharedBotWardrobe' }
        : { list: 'sharedUserWardrobe', active: 'sharedUserActive', byChat: 'sharedUserActiveByChat', use: 'useSharedUserWardrobe' };
    return {
        use: () => !!s[k.use],
        setUse: (v) => { s[k.use] = !!v; },
        list: () => s[k.list],
        setList: (arr) => { s[k.list] = arr; },
        global: () => s[k.active] || null,
        setGlobal: (id) => { s[k.active] = id; },
        byChat: () => s[k.byChat],
        fileLabel: () => (side === 'bot' ? 'sw_bot_' : 'sw_user_'),
    };
}

function swCurrentChatId() {
    try {
        const ctx = SillyTavern.getContext();
        return (typeof ctx.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : null) || null;
    } catch (e) { return null; }
}
function swGetSharedActiveId(side) {
    const cfg = swSharedCfg(side);
    const cid = swCurrentChatId();
    if (cid) { const m = cfg.byChat(); return Object.hasOwn(m, cid) ? m[cid] : null; }
    return cfg.global();
}
function swSetSharedActiveId(side, id) {
    const cfg = swSharedCfg(side);
    const cid = swCurrentChatId();
    if (cid) { const m = cfg.byChat(); if (id == null) delete m[cid]; else m[cid] = id; }
    else cfg.setGlobal(id);
    swSave();
}

function swGetActiveSideOutfit(side) {
    const cfg = swSharedCfg(side);
    if (cfg.use()) {
        const id = swGetSharedActiveId(side);
        return id ? (cfg.list().find(o => o.id === id) || null) : null;
    }
    const cn = swCharName(); if (!cn) return null;
    const a = swGetActive(); return a[side] ? swFind(cn, side, a[side]) : null;
}
function swGetActiveBotOutfit()  { return swGetActiveSideOutfit('bot'); }
function swGetActiveUserOutfit() { return swGetActiveSideOutfit('user'); }

function swCurrentView() {
    const cfg = swSharedCfg(swTab);
    if (cfg.use()) {
        return {
            shared: true, side: swTab,
            list: () => cfg.list(),
            activeId: () => swGetSharedActiveId(swTab),
            setActive: (id) => { swSetSharedActiveId(swTab, id); return true; },
            find: (id) => cfg.list().find(o => o.id === id) || null,
            add: (o) => { cfg.list().push(o); swSave(); },
            remove: (id) => {
                cfg.setList(cfg.list().filter(o => o.id !== id));
                if (cfg.global() === id) cfg.setGlobal(null);
                const m = cfg.byChat(); for (const key of Object.keys(m)) if (m[key] === id) delete m[key];
                swSave();
            },
        };
    }
    const cn = swCharName();
    return {
        shared: false, side: swTab,
        list: () => swGetWardrobe(cn)[swTab],
        activeId: () => swGetActive()[swTab],
        setActive: (id) => swSetActive(swTab, id),
        find: (id) => swFind(cn, swTab, id),
        add: (o) => swAdd(cn, swTab, o),
        remove: (id) => swRemove(cn, swTab, id),
    };
}

// ── Shared wardrobe preload ──

async function swLoadRefImageAsBase64(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) return null;
        const blob = await response.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        iigLog('WARN', `swLoadRefImageAsBase64 failed: ${path}`, e.message);
        return null;
    }
}

async function swPreloadSharedActive(side) {
    try {
        const cfg = swSharedCfg(side);
        const c = swSharedCache[side];
        const id = cfg.use() ? swGetSharedActiveId(side) : null;
        if (!id) { c.b64 = null; c.id = null; return; }
        if (c.id === id && c.b64) return;
        const o = cfg.list().find(x => x.id === id);
        if (!o) { c.b64 = null; c.id = null; return; }
        let b64 = o.base64 || null;
        if (!b64 && o.imagePath) b64 = await swLoadRefImageAsBase64(o.imagePath);
        c.b64 = b64; c.id = b64 ? id : null;
    } catch (e) {
        iigLog('WARN', `preload shared active (${side}) failed:`, e.message);
        const c = swSharedCache[side]; c.b64 = null; c.id = null;
    }
}
function swPreloadAllShared() { swPreloadSharedActive('bot'); swPreloadSharedActive('user'); }

// ── Migration helpers ──

function swSharedHasSrc(side, srcId) {
    return swSharedCfg(side).list().some(x => x.srcId === srcId);
}
function swCollectPendingOutfits(side) {
    const s = swGetSettings();
    const out = [];
    for (const w of Object.values(s.wardrobes || {})) {
        if (!w || !Array.isArray(w[side])) continue;
        for (const o of w[side]) if ((o.base64 || o.imagePath) && !swSharedHasSrc(side, o.id)) out.push(o);
    }
    return out;
}

function swAutoWearSharedFromCurrent(side, { force = false } = {}) {
    const s = swGetSettings();
    const cn = swCharName(); if (!cn) return null;
    const wornId = s.activeOutfits?.[cn]?.[side];
    if (!wornId) return null;
    if (!force && swGetSharedActiveId(side)) return null;
    const copy = swSharedCfg(side).list().find(x => x.srcId === wornId);
    if (!copy) return null;
    swSetSharedActiveId(side, copy.id);
    swPreloadSharedActive(side);
    return copy.name || 'образ';
}

async function swSaveRefImageToFile(base64, label) {
    const ctx = SillyTavern.getContext();
    const safeName = label.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
    const filename = `sw_${safeName}_${Date.now()}`;
    const response = await fetch('/api/images/upload', {
        method: 'POST', headers: ctx.getRequestHeaders(),
        body: JSON.stringify({ image: base64, format: 'png', ch_name: 'iig_refs', filename }),
    });
    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
    const result = await response.json();
    iigLog('INFO', `Wardrobe image saved: ${result.path}`);
    return result.path;
}

function swCompressBase64Image(base64, maxDim, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let w = img.width, h = img.height;
            if (w > maxDim || h > maxDim) {
                const s = maxDim / Math.max(w, h);
                w = Math.round(w * s); h = Math.round(h * s);
            }
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL('image/jpeg', quality).split(',')[1]);
        };
        img.onerror = () => reject(new Error('Failed to compress image'));
        img.src = 'data:image/png;base64,' + base64;
    });
}

// ── Image utilities ──

function swResize(file, maxDim) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = (e) => { const img = new Image(); img.onload = () => { let { width: w, height: h } = img; if (w > maxDim || h > maxDim) { const s = Math.min(maxDim / w, maxDim / h); w = Math.round(w * s); h = Math.round(h * s); } const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); res({ base64: c.toDataURL('image/png').split(',')[1] }); }; img.onerror = () => rej(new Error('decode')); img.src = e.target.result; };
        r.onerror = () => rej(new Error('read')); r.readAsDataURL(file);
    });
}

// ── AI describe via rakk-joppie vision.js (callVisionApi) ──

async function swAnalyzeOutfit(base64) {
    toastr.info('Анализ образа…', 'Гардероб', { timeOut: 15000 });
    try {
        const raw = await callVisionApi(base64, DEFAULT_VISION_PROMPT);
        const desc = swSanitizeDesc(raw);
        if (desc && desc.length > 10) {
            iigLog('INFO', 'Auto-described outfit:', desc.substring(0, 100));
            return desc;
        }
        iigLog('WARN', `Vision response rejected (len=${desc.length})`);
        return null;
    } catch (e) {
        iigLog('WARN', 'Vision callVisionApi failed:', e.message);
        toastr.error('Vision API: ' + e.message, 'Гардероб', { timeOut: 5000 });
        return null;
    }
}

// ══════════════════════════════════════════════════════════════
//  TRY-ON: full-body generation using rakk-joppie's providers
// ══════════════════════════════════════════════════════════════

async function swGetPersonRefB64(side) {
    if (side === 'bot') return await getCharacterAvatarBase64();
    return await getUserAvatarBase64();
}

function swBuildTryOnPrompt(side, outfitDesc) {
    const ctx = SillyTavern.getContext();
    const name = side === 'bot' ? (swCharName() || 'the character') : (ctx.name1 || 'the user');
    const personRef = side === 'bot' ? 'CHARACTER REFERENCE' : 'USER REFERENCE';
    const outfitRef = side === 'bot' ? 'CHARACTER OUTFIT REFERENCE' : 'USER OUTFIT REFERENCE';
    let p = `Virtual outfit try-on. Generate a FULL-BODY, head-to-toe image of ${name} — the exact person from the ${personRef} image — wearing EXACTLY the outfit from the ${outfitRef} image.`;
    p += ' Keep the face, hairstyle, hair color, eye color, skin tone and body proportions identical to the person reference.';
    p += ' Replace ALL of their clothing with the referenced outfit: same garments, colors, fabrics, patterns, accessories and footwear.';
    p += ' Standing in a relaxed pose facing the viewer, entire figure visible from head to shoes, clean neutral studio background, soft even lighting, fashion lookbook style.';
    const d = swSanitizeDesc(outfitDesc);
    if (d) p += ` Outfit details: ${d}`;
    return p;
}

async function swTryOnGenerate(side, outfitB64, outfitDesc) {
    validateProviderSettings();
    const settings = getSettings();
    const provider = resolveActiveProvider(settings);
    if (!provider) throw new Error('Провайдер генерации не настроен');

    const personB64 = await swGetPersonRefB64(side);
    if (!personB64) {
        throw new Error(side === 'bot'
            ? 'Нет референса персонажа: откройте чат с персонажем или загрузите аватар'
            : 'Нет референса персоны: выберите аватар персоны в ST');
    }

    const references = [personB64, outfitB64];
    const prompt = swBuildTryOnPrompt(side, outfitDesc);

    const generated = await provider.generate({
        prompt,
        style: '',
        references,
        options: { aspectRatio: '2:3' },
    });

    if (typeof generated === 'string' && /^https?:\/\//i.test(generated)) {
        return await imageUrlToDataUrl(generated);
    }
    if (typeof generated !== 'string' || !generated.startsWith('data:image/')) {
        throw new Error('API вернул не картинку (примерка поддерживает только изображения)');
    }
    const png = await convertDataUrlToPng(generated);
    return parseImageDataUrl(png).base64Data;
}

async function swShrinkForStore(b64) {
    try { return await swCompressBase64Image(b64, swGetSettings().maxDimension, 0.85); }
    catch (e) { iigLog('WARN', 'try-on shrink failed, storing as is:', e.message); return b64; }
}

// ── Modal ──

export function swOpenModal() {
    swCloseModal();
    swOpen = true;
    const cn = swCharName();
    if (!cn) { toastr.warning('Выберите персонажа', 'Гардероб'); swOpen = false; return; }

    const ov = document.createElement('div'); ov.id = 'sw-modal-overlay';
    ov.addEventListener('click', (e) => { if (e.target === ov) swCloseModal(); });

    const m = document.createElement('div'); m.id = 'sw-modal';
    m.innerHTML = `
        <div class="sw-modal-header">
            <span class="sw-modal-title">Гардероб — <b>${esc(cn)}</b></span>
            <div class="sw-modal-header-btns">
                <div class="sw-header-btn sw-btn-maint" title="Обслуживание: дубликаты и чистка файлов"><i class="fa-solid fa-broom"></i></div>
                <div class="sw-header-btn sw-btn-quick" title="Быстрые настройки"><i class="fa-solid fa-sliders"></i></div>
                <div class="sw-modal-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div>
            </div>
        </div>
        <div class="sw-tabs">
            <div class="sw-tab ${swTab === 'bot' ? 'sw-tab-active' : ''}" data-tab="bot">Бот</div>
            <div class="sw-tab ${swTab === 'user' ? 'sw-tab-active' : ''}" data-tab="user">Юзер</div>
        </div>
        <div class="sw-active-info" id="sw-active-info"></div>
        <div class="sw-tab-content" id="sw-tab-content"></div>`;

    ov.appendChild(m);
    document.body.appendChild(ov);
    m.querySelector('.sw-modal-close').addEventListener('click', swCloseModal);
    m.querySelector('.sw-btn-quick').addEventListener('click', swOpenQuickSettings);
    m.querySelector('.sw-btn-maint').addEventListener('click', () => swOpenMaintenance('dedup'));
    for (const t of m.querySelectorAll('.sw-tab')) t.addEventListener('click', () => {
        swTab = t.dataset.tab; swFilter = 'all'; swPage = 0;
        m.querySelectorAll('.sw-tab').forEach(x => x.classList.toggle('sw-tab-active', x.dataset.tab === swTab)); swRender();
    });
    swFilter = 'all'; swPage = 0;
    swRender();
    document.addEventListener('keydown', swEsc);
}

function swEsc(e) { if (e.key === 'Escape') swCloseModal(); }
function swCloseModal() { swOpen = false; document.getElementById('sw-modal-overlay')?.remove(); document.removeEventListener('keydown', swEsc); }

// ── Render ──

function swRender() {
    const c = document.getElementById('sw-tab-content'), ib = document.getElementById('sw-active-info');
    if (!c) return;
    const v = swCurrentView();
    const outfits = v.list() || [], aid = v.activeId();

    if (ib) {
        const ao = aid ? v.find(aid) : null;
        const aoDesc = ao ? swSanitizeDesc(ao.description) : '';
        ib.innerHTML = ao ? `Активно: <b>${esc(ao.name)}</b>${aoDesc ? ` — <i>${esc(aoDesc.length > 60 ? aoDesc.slice(0, 60) + '...' : aoDesc)}</i>` : ''}` : 'Ничего не надето';
        ib.classList.toggle('sw-active-visible', !!ao);
    }

    let h = '';

    // Mode: Personal / Shared
    {
        const useShared = v.shared;
        const sortOpt = (val, label) => `<option value="${val}" ${swSort === val ? 'selected' : ''}>${label}</option>`;
        h += `<div class="sw-mode-row">
            <div class="sw-mode-btn ${!useShared ? 'sw-mode-active' : ''}" data-mode="perc"><i class="fa-solid fa-user"></i> Перс</div>
            <div class="sw-mode-btn ${useShared ? 'sw-mode-active' : ''}" data-mode="shared"><i class="fa-solid fa-earth-americas"></i> Общий</div>
            <div class="sw-sort-wrap" title="Сортировка">
                <i class="fa-solid fa-arrow-down-wide-short"></i>
                <select class="sw-sort-select">${sortOpt('added', 'Недавно добавленные')}${sortOpt('worn', 'Недавно надетые')}${sortOpt('name', 'По имени')}</select>
            </div>
        </div>`;
    }

    // Type filter
    const counts = {};
    for (const o of outfits) { const t = swTypeOf(o); counts[t] = (counts[t] || 0) + 1; }
    if (swFilter !== 'all' && !counts[swFilter]) swFilter = 'all';
    h += `<div class="sw-filter-row"><div class="sw-filter-chip ${swFilter === 'all' ? 'sw-filter-active' : ''}" data-type="all">Все <span class="sw-chip-count">${outfits.length}</span></div>`;
    for (const t of swTypes()) {
        if (!counts[t.id]) continue;
        h += `<div class="sw-filter-chip ${swFilter === t.id ? 'sw-filter-active' : ''}" data-type="${t.id}"><i class="fa-solid ${t.icon}"></i> ${esc(t.label)} <span class="sw-chip-count">${counts[t.id]}</span></div>`;
    }
    h += '</div>';

    const filtered = swFilter === 'all' ? outfits : outfits.filter(o => swTypeOf(o) === swFilter);
    const shown = swSortOutfits(filtered, aid);

    // Pagination
    const totalPages = Math.max(1, Math.ceil(shown.length / SW_PAGE_SIZE));
    if (swPage > totalPages - 1) swPage = totalPages - 1;
    if (swPage < 0) swPage = 0;
    const pageItems = shown.slice(swPage * SW_PAGE_SIZE, (swPage + 1) * SW_PAGE_SIZE);

    h += '<div class="sw-outfit-grid"><div class="sw-outfit-card sw-upload-card" id="sw-upload-trigger"><div class="sw-upload-icon"><i class="fa-solid fa-plus"></i></div><span>Загрузить</span></div>';
    for (const o of pageItems) {
        const a = o.id === aid;
        const oDesc = swSanitizeDesc(o.description);
        const tm = swTypeMeta(swTypeOf(o));
        const opts = swTypes().map(t => `<option value="${t.id}" ${swTypeOf(o) === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
        h += `<div class="sw-outfit-card ${a ? 'sw-outfit-active' : ''}" data-id="${o.id}">
            <div class="sw-outfit-img-wrap"><img src="${esc(swImgSrc(o))}" alt="${esc(o.name)}" class="sw-outfit-img" loading="lazy">${a ? '<div class="sw-active-badge"><i class="fa-solid fa-check"></i></div>' : ''}<div class="sw-type-badge" title="${esc(tm.label)}"><i class="fa-solid ${tm.icon}"></i></div></div>
            <div class="sw-outfit-footer"><span class="sw-outfit-name" title="${esc(oDesc || o.name)}">${esc(o.name)}</span>
                <div class="sw-outfit-btns">
                    <div class="sw-btn-activate" title="${a ? 'Снять' : 'Надеть'}"><i class="fa-solid ${a ? 'fa-toggle-on' : 'fa-toggle-off'}"></i></div>
                    <div class="sw-btn-edit" title="Редактировать"><i class="fa-solid fa-pen"></i></div>
                    <div class="sw-btn-delete" title="Удалить"><i class="fa-solid fa-trash-can"></i></div>
                </div></div>
            <select class="sw-type-select" title="Тип одежды">${opts}</select></div>`;
    }
    h += '</div>';

    // Paginator
    if (totalPages > 1) {
        h += `<div class="sw-pager">
            <div class="sw-pager-btn ${swPage === 0 ? 'sw-pager-dim' : ''}" data-pg="prev" title="Назад"><i class="fa-solid fa-chevron-left"></i></div>
            <span class="sw-pager-info">Стр. ${swPage + 1} / ${totalPages} <small>(${shown.length})</small></span>
            <div class="sw-pager-btn ${swPage >= totalPages - 1 ? 'sw-pager-dim' : ''}" data-pg="next" title="Вперёд"><i class="fa-solid fa-chevron-right"></i></div>
        </div>`;
    }

    c.innerHTML = h;

    // Paginator events
    for (const b of c.querySelectorAll('.sw-pager-btn')) {
        b.addEventListener('click', () => {
            if (b.dataset.pg === 'prev' && swPage > 0) { swPage--; swRender(); }
            else if (b.dataset.pg === 'next' && swPage < totalPages - 1) { swPage++; swRender(); }
        });
    }

    // Mode buttons
    for (const b of c.querySelectorAll('.sw-mode-btn')) {
        b.addEventListener('click', async () => {
            const wantShared = b.dataset.mode === 'shared';
            const cfg = swSharedCfg(swTab);
            if (cfg.use() === wantShared) return;
            cfg.setUse(wantShared); swSave();
            swFilter = 'all'; swPage = 0;
            swPreloadSharedActive(swTab);
            swRender(); swUpdatePromptInjection(); swInjectBarBtn();
            const sideName = swTab === 'bot' ? 'Бот' : 'Юзер';
            toastr.info(`${sideName}: ${wantShared ? 'общий гардероб (для всех персонажей)' : 'персональный гардероб'}`, 'Гардероб', { timeOut: 2000 });
            if (wantShared) {
                swAutoWearSharedFromCurrent(swTab, { force: false });
                swPage = 0; swRender(); swUpdatePromptInjection(); swInjectBarBtn();
            }
        });
    }

    // Filter chips
    for (const chip of c.querySelectorAll('.sw-filter-chip')) {
        chip.addEventListener('click', () => { swFilter = chip.dataset.type; swPage = 0; swRender(); });
    }

    // Sort
    c.querySelector('.sw-sort-select')?.addEventListener('change', (e) => {
        swSort = e.target.value; swPage = 0; swRender();
    });

    document.getElementById('sw-upload-trigger')?.addEventListener('click', swUpload);
    for (const card of c.querySelectorAll('.sw-outfit-card[data-id]')) {
        const id = card.dataset.id;
        card.querySelector('.sw-outfit-img')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swToggle(id); });
        card.querySelector('.sw-btn-activate')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swToggle(id); });
        card.querySelector('.sw-btn-edit')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); swEdit(id); });
        card.querySelector('.sw-btn-delete')?.addEventListener('click', (e) => {
            e.preventDefault(); e.stopImmediatePropagation();
            if (!confirm('Удалить?')) return;
            v.remove(id);
            if (v.shared) swPreloadSharedActive(v.side);
            swUpdatePromptInjection(); swInjectBarBtn(); swRender();
            toastr.info('Удалён', 'Гардероб');
        });
        card.querySelector('.sw-type-select')?.addEventListener('change', (e) => {
            e.stopImmediatePropagation();
            const o = v.find(id);
            if (o) { o.type = e.target.value; swSave(); swRender(); }
        });
    }
}

function swToggle(id) {
    const v = swCurrentView();
    const o = v.find(id), nm = o?.name || id;
    const off = v.activeId() === id;
    if (v.setActive(off ? null : id) === false) return;
    if (!off && o) { o.lastWorn = Date.now(); swSave(); }
    if (v.shared) swPreloadSharedActive(v.side);
    swRender();
    swUpdatePromptInjection();
    swInjectBarBtn();
    off ? toastr.info(`«${nm}» снят`, 'Гардероб', { timeOut: 2000 }) : toastr.success(`«${nm}» надет`, 'Гардероб', { timeOut: 2000 });
}

// ── Upload / Edit ──

async function swUpload() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.addEventListener('change', async () => {
        const f = inp.files?.[0]; if (!f) return;
        const v = swCurrentView();
        try {
            const { base64 } = await swResize(f, swGetSettings().maxDimension);
            swOpenOutfitForm({ mode: 'add', view: v, base64, defaultName: f.name.replace(/\.[^.]+$/, '') });
        } catch (e) { toastr.error('Ошибка: ' + e.message, 'Гардероб'); }
    });
    inp.click();
}

function swEdit(id) {
    const v = swCurrentView();
    const o = v.find(id); if (!o) return;
    swOpenOutfitForm({ mode: 'edit', view: v, item: o });
}

function swOpenOutfitForm({ mode, view, base64 = null, item = null, defaultName = '' }) {
    document.getElementById('sw-form-overlay')?.remove();
    const isEdit = mode === 'edit';
    const curType = isEdit ? swTypeOf(item) : (swTypeIds().includes(swFilter) ? swFilter : 'other');
    const previewSrc = isEdit ? swImgSrc(item) : ('data:image/png;base64,' + base64);
    const curName = isEdit ? (item.name || '') : (defaultName || '');
    const curDesc = isEdit ? swSanitizeDesc(item.description) : '';

    const stCtx = SillyTavern.getContext();
    const charNm = swCharName() || 'персонаж';
    const userNm = stCtx.name1 || 'персона';

    const ov = document.createElement('div'); ov.id = 'sw-form-overlay';
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    const panel = document.createElement('div'); panel.id = 'sw-form';
    panel.innerHTML = `
        <div class="sw-form-header"><span>${isEdit ? 'Редактировать образ' : 'Новый образ'}</span><div class="sw-form-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div></div>
        <div class="sw-form-body">
            <div class="sw-form-preview"><img src="${esc(previewSrc)}" alt="preview"></div>
            <div class="sw-tryon-row">
                <select class="text_pole sw-tryon-select" id="sw-tryon-target" title="На кого примерить наряд">
                    <option value="bot" ${view.side === 'bot' ? 'selected' : ''}>На персонажа — ${esc(charNm)}</option>
                    <option value="user" ${view.side === 'user' ? 'selected' : ''}>На персону — ${esc(userNm)}</option>
                </select>
                <div class="sw-tryon-btn" id="sw-tryon-btn" title="Сгенерировать фулбоди-картинку: персонаж в этом наряде (ИИ)"><i class="fa-solid fa-person-rays"></i> Примерить</div>
            </div>
            <div class="sw-tryon-status" id="sw-tryon-status" hidden></div>
            <div class="sw-tryon-pick" id="sw-tryon-pick" hidden>
                <div class="sw-tryon-opt" data-pick="orig" title="Сохранить исходную картинку наряда"><img alt="оригинал"><span>Оригинал</span></div>
                <div class="sw-tryon-opt" data-pick="gen" title="Сохранить сгенерированную примерку"><img alt="примерка"><span>Примерка</span></div>
            </div>
            <label class="sw-form-label">Название</label>
            <input type="text" class="text_pole sw-form-input" id="sw-form-name" value="${esc(curName)}" placeholder="Название образа">
            <label class="sw-form-label">Тип одежды</label>
            <select class="text_pole sw-form-input" id="sw-form-type">${swTypes().map(t => `<option value="${t.id}" ${curType === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
            <label class="sw-form-label">Описание <span class="sw-form-ai" id="sw-form-ai" title="Сгенерировать описание по картинке (ИИ)"><i class="fa-solid fa-wand-magic-sparkles"></i> ИИ</span></label>
            <textarea class="text_pole sw-form-textarea" id="sw-form-desc" rows="4" placeholder="Что на образе: одежда, цвета, ткани, аксессуары…">${esc(curDesc)}</textarea>
            <div class="sw-form-actions">
                <div class="sw-form-btn sw-form-cancel">Отмена</div>
                <div class="sw-form-btn sw-form-save">${isEdit ? 'Сохранить' : 'Добавить'}</div>
            </div>
        </div>`;
    ov.appendChild(panel); document.body.appendChild(ov);

    function formEsc(e) { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } }
    function close() { document.removeEventListener('keydown', formEsc, true); ov.remove(); }
    document.addEventListener('keydown', formEsc, true);
    panel.querySelector('.sw-form-close').addEventListener('click', close);
    panel.querySelector('.sw-form-cancel').addEventListener('click', close);

    let origB64 = base64;
    async function getFormImageB64() {
        if (origB64) return origB64;
        if (item) origB64 = item.base64 || (item.imagePath ? await swLoadRefImageAsBase64(item.imagePath) : null);
        return origB64;
    }

    // AI describe
    panel.querySelector('#sw-form-ai').addEventListener('click', async () => {
        const aiBtn = panel.querySelector('#sw-form-ai');
        if (aiBtn.classList.contains('sw-form-ai-loading')) return;
        aiBtn.classList.add('sw-form-ai-loading');
        try {
            const b64 = await getFormImageB64();
            if (!b64) { toastr.warning('Нет картинки для анализа', 'Гардероб'); return; }
            const desc = await swAnalyzeOutfit(b64);
            if (desc) panel.querySelector('#sw-form-desc').value = desc;
            else toastr.warning('Не удалось получить описание', 'Гардероб');
        } catch (e) { toastr.error('Ошибка ИИ: ' + e.message, 'Гардероб'); }
        finally { aiBtn.classList.remove('sw-form-ai-loading'); }
    });

    // Try-on
    let genB64 = null;
    let picked = 'orig';
    const previewImg = panel.querySelector('.sw-form-preview img');
    const tryBtn = panel.querySelector('#sw-tryon-btn');
    const tryStatus = panel.querySelector('#sw-tryon-status');
    const tryPick = panel.querySelector('#sw-tryon-pick');

    function refreshTryOnUI() {
        tryPick.hidden = !genB64;
        if (genB64) {
            tryPick.querySelector('[data-pick="orig"] img').src = previewSrc;
            tryPick.querySelector('[data-pick="gen"] img').src = 'data:image/png;base64,' + genB64;
            for (const o of tryPick.querySelectorAll('.sw-tryon-opt')) o.classList.toggle('sw-tryon-sel', o.dataset.pick === picked);
        }
        previewImg.src = (picked === 'gen' && genB64) ? ('data:image/png;base64,' + genB64) : previewSrc;
    }

    for (const o of tryPick.querySelectorAll('.sw-tryon-opt')) {
        o.addEventListener('click', () => { picked = o.dataset.pick === 'gen' ? 'gen' : 'orig'; refreshTryOnUI(); });
    }

    tryBtn.addEventListener('click', async () => {
        if (tryBtn.classList.contains('sw-tryon-busy')) return;
        const side = panel.querySelector('#sw-tryon-target').value === 'user' ? 'user' : 'bot';
        tryBtn.classList.add('sw-tryon-busy');
        tryBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Генерация…';
        tryStatus.hidden = false; tryStatus.textContent = 'Готовим референсы…';
        try {
            const srcB64 = await getFormImageB64();
            if (!srcB64) throw new Error('Не удалось получить картинку наряда');
            const descNow = panel.querySelector('#sw-form-desc').value.trim();
            tryStatus.textContent = 'Генерация примерки… (обычно 15–60 секунд)';
            const out = await swTryOnGenerate(side, srcB64, descNow);
            if (!document.body.contains(panel)) return;
            genB64 = out; picked = 'gen';
            refreshTryOnUI();
            tryStatus.hidden = true;
            toastr.success('Примерка готова. Ниже выберите, какую картинку сохранить в гардероб', 'Гардероб', { timeOut: 4000 });
        } catch (e) {
            iigLog('ERROR', 'try-on failed:', e);
            if (document.body.contains(panel)) { tryStatus.hidden = false; tryStatus.textContent = '⚠ ' + String(e.message || e); }
            toastr.error(String(e.message || e).slice(0, 300), 'Примерка не удалась', { timeOut: 6000 });
        } finally {
            if (document.body.contains(panel)) {
                tryBtn.classList.remove('sw-tryon-busy');
                tryBtn.innerHTML = '<i class="fa-solid fa-person-rays"></i> Примерить';
            }
        }
    });

    // Save
    panel.querySelector('.sw-form-save').addEventListener('click', async () => {
        const name = panel.querySelector('#sw-form-name').value.trim();
        if (!name) { toastr.warning('Введите название', 'Гардероб'); return; }
        const type = panel.querySelector('#sw-form-type').value;
        const desc = panel.querySelector('#sw-form-desc').value.trim();
        const saveBtn = panel.querySelector('.sw-form-save');
        saveBtn.classList.add('sw-form-btn-busy'); saveBtn.textContent = 'Сохранение…';
        try {
            const useGen = picked === 'gen' && !!genB64;
            if (isEdit) {
                item.name = name; item.type = type; item.description = desc;
                if (useGen) {
                    let stored = false;
                    if (view.shared) {
                        try {
                            const jpeg = await swCompressBase64Image(genB64, swGetSettings().maxDimension, 0.85);
                            const prefix = view.side === 'bot' ? 'sw_bot_' : 'sw_user_';
                            item.imagePath = await swSaveRefImageToFile(jpeg, prefix + name);
                            delete item.base64;
                            stored = true;
                        } catch (err) { iigLog('WARN', 'try-on file store failed, fallback to base64:', err.message); }
                    }
                    if (!stored) { item.base64 = await swShrinkForStore(genB64); delete item.imagePath; }
                    swSharedCache[view.side].b64 = null; swSharedCache[view.side].id = null;
                }
                swSave();
                if (view.shared) swPreloadSharedActive(view.side);
            } else {
                const newItem = { id: uid(), name, type, description: desc, addedAt: Date.now() };
                const imgB64 = useGen ? genB64 : base64;
                if (view.shared) {
                    let stored = false;
                    try {
                        const jpeg = await swCompressBase64Image(imgB64, swGetSettings().maxDimension, 0.82);
                        const prefix = view.side === 'bot' ? 'sw_bot_' : 'sw_user_';
                        newItem.imagePath = await swSaveRefImageToFile(jpeg, prefix + name);
                        stored = true;
                    } catch (err) { iigLog('WARN', 'shared file store failed, fallback to base64:', err.message); }
                    if (!stored) newItem.base64 = useGen ? await swShrinkForStore(imgB64) : imgB64;
                } else {
                    newItem.base64 = useGen ? await swShrinkForStore(imgB64) : imgB64;
                }
                view.add(newItem);
                if (view.shared) swPreloadSharedActive(view.side);
                swSort = 'added'; swPage = 0;
            }
            close();
            swRender(); swUpdatePromptInjection(); swInjectBarBtn();
            toastr.success(isEdit ? 'Обновлён' : `«${name}» добавлен`, 'Гардероб', { timeOut: 2000 });
        } catch (e) {
            toastr.error('Ошибка: ' + e.message, 'Гардероб');
            saveBtn.classList.remove('sw-form-btn-busy'); saveBtn.textContent = isEdit ? 'Сохранить' : 'Добавить';
        }
    });
}

// ── Quick settings ──

function swOpenQuickSettings() {
    document.getElementById('sw-quick-overlay')?.remove();
    const ctx = SillyTavern.getContext();
    const iig = ctx.extensionSettings[MODULE_NAME];
    if (!iig) { toastr.error('Настройки расширения не готовы', 'Быстрые настройки'); return; }

    const ov = document.createElement('div'); ov.id = 'sw-quick-overlay';
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });

    const panel = document.createElement('div'); panel.id = 'sw-quick-panel';
    panel.innerHTML = `
        <div class="sw-quick-header">
            <span><i class="fa-solid fa-sliders"></i> Быстрые настройки</span>
            <div class="sw-quick-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div>
        </div>
        <div class="sw-quick-body">
            <label class="sw-quick-check">
                <input type="checkbox" id="sw-q-enabled" ${iig.enabled ? 'checked' : ''}>
                <span>Генерация включена</span>
            </label>

            <div class="sw-quick-row">
                <label>Тип API</label>
                <select id="sw-q-api-type" class="text_pole">
                    <option value="openai" ${iig.apiType === 'openai' ? 'selected' : ''}>OpenAI</option>
                    <option value="gemini" ${iig.apiType === 'gemini' ? 'selected' : ''}>Gemini / nano-banana</option>
                    <option value="custom" ${iig.apiType === 'custom' ? 'selected' : ''}>Custom (свой URL + формат)</option>
                </select>
            </div>

            <div class="sw-quick-row">
                <label>Эндпоинт</label>
                <input type="text" id="sw-q-endpoint" class="text_pole" value="${esc(iig.endpoint || '')}" placeholder="https://api.example.com">
            </div>

            <div class="sw-quick-row">
                <label>API ключ</label>
                <div class="sw-quick-key-wrap">
                    <input type="password" id="sw-q-key" class="text_pole" value="${esc(iig.apiKey || '')}">
                    <div class="sw-quick-key-toggle" title="Показать/Скрыть"><i class="fa-solid fa-eye"></i></div>
                </div>
            </div>

            <div class="sw-quick-row" id="sw-q-model-row">
                <label>Модель</label>
                <div class="sw-quick-model-wrap">
                    <select id="sw-q-model" class="text_pole">
                        ${iig.model ? `<option value="${esc(iig.model)}" selected>${esc(iig.model)}</option>` : '<option value="">-- Не выбрана --</option>'}
                    </select>
                    <div class="sw-quick-refresh" title="Обновить модели"><i class="fa-solid fa-sync"></i></div>
                </div>
            </div>

            <div class="sw-quick-tags">
                <label class="sw-quick-tags-title"><i class="fa-solid fa-tags"></i> Теги одежды</label>
                <div class="sw-tags-list" id="sw-tags-list"></div>
                <div class="sw-tags-add" id="sw-tags-add"><i class="fa-solid fa-plus"></i> Добавить тег</div>
                <div class="sw-quick-hint">«Другое» удалить нельзя — это запасной тег. При удалении тега все его наряды переносятся в «Другое».</div>
            </div>

            <div class="sw-quick-hint">Настройки сохраняются автоматически и синхронизируются с панелью расширения.</div>
        </div>`;

    ov.appendChild(panel); document.body.appendChild(ov);
    panel.querySelector('.sw-quick-close').addEventListener('click', () => ov.remove());

    const tagsList = panel.querySelector('#sw-tags-list');
    swRenderTagManager(tagsList);
    panel.querySelector('#sw-tags-add')?.addEventListener('click', () => {
        const s = swGetSettings();
        const tag = { id: uid(), label: 'Новый тег', icon: 'fa-tag' };
        const fb = s.outfitTypes.findIndex(t => t.id === SW_FALLBACK_TYPE);
        if (fb >= 0) s.outfitTypes.splice(fb, 0, tag); else s.outfitTypes.push(tag);
        swSave();
        swRenderTagManager(tagsList);
        if (swOpen) swRender();
        tagsList.querySelector(`.sw-tag-row[data-id="${tag.id}"] .sw-tag-name`)?.focus();
    });

    const save = () => ctx.saveSettingsDebounced();
    const syncMain = (id, value, isCheck = false) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (isCheck) el.checked = !!value;
        else el.value = value;
        try { el.dispatchEvent(new Event(isCheck ? 'change' : 'input', { bubbles: true })); } catch(e) {}
    };

    panel.querySelector('#sw-q-enabled').addEventListener('change', (e) => {
        iig.enabled = e.target.checked; save();
        syncMain('iig_enabled', iig.enabled, true);
    });
    panel.querySelector('#sw-q-api-type').addEventListener('change', (e) => {
        iig.apiType = e.target.value; save();
        syncMain('iig_api_type', iig.apiType);
    });
    panel.querySelector('#sw-q-endpoint').addEventListener('input', (e) => {
        iig.endpoint = e.target.value; save();
        syncMain('iig_endpoint', iig.endpoint);
    });
    panel.querySelector('#sw-q-key').addEventListener('input', (e) => {
        iig.apiKey = e.target.value; save();
        syncMain('iig_api_key', iig.apiKey);
    });
    panel.querySelector('.sw-quick-key-toggle').addEventListener('click', () => {
        const inp = panel.querySelector('#sw-q-key');
        const icon = panel.querySelector('.sw-quick-key-toggle i');
        if (inp.type === 'password') { inp.type = 'text'; icon.classList.replace('fa-eye', 'fa-eye-slash'); }
        else { inp.type = 'password'; icon.classList.replace('fa-eye-slash', 'fa-eye'); }
    });
    panel.querySelector('#sw-q-model').addEventListener('change', (e) => {
        iig.model = e.target.value; save();
        syncMain('iig_model', iig.model);
    });

    // Refresh models
    panel.querySelector('.sw-quick-refresh').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('loading');
        try {
            const provider = resolveActiveProvider(getSettings());
            if (!provider) throw new Error('Провайдер не выбран');
            const models = await provider.fetchModels();
            const select = panel.querySelector('#sw-q-model');
            const cur = iig.model;
            select.innerHTML = '<option value="">-- Выберите модель --</option>';
            for (const m of models) {
                const opt = document.createElement('option');
                opt.value = m; opt.textContent = m; opt.selected = m === cur;
                select.appendChild(opt);
            }
            toastr.success(`Найдено моделей: ${models.length}`, 'Быстрые настройки');
        } catch (err) {
            toastr.error('Ошибка: ' + err.message, 'Быстрые настройки');
        } finally { btn.classList.remove('loading'); }
    });
}

// ── Maintenance ──

function swCollectReferencedFiles() {
    const ctx = SillyTavern.getContext();
    const referenced = new Set();
    let dir = '/user/images/iig_refs/';
    const addRef = (p) => {
        if (!p || typeof p !== 'string') return;
        const i = p.lastIndexOf('/');
        const base = i >= 0 ? p.slice(i + 1) : p;
        if (base) referenced.add(base);
        if (i > 0 && p.includes('iig_refs')) dir = p.slice(0, i + 1);
    };
    const sw = ctx.extensionSettings?.[SW];
    if (sw) {
        for (const o of (sw.sharedUserWardrobe || [])) addRef(o.imagePath);
        for (const o of (sw.sharedBotWardrobe || [])) addRef(o.imagePath);
        for (const w of Object.values(sw.wardrobes || {})) {
            if (!w) continue;
            for (const side of ['bot', 'user']) for (const o of (w[side] || [])) addRef(o.imagePath);
        }
    }
    const iig = ctx.extensionSettings?.[MODULE_NAME];
    if (iig) {
        addRef(iig.charRef?.imagePath);
        addRef(iig.userRef?.imagePath);
        for (const n of (iig.npcReferences || [])) addRef(n?.imagePath);
    }
    return { referenced, dir };
}

async function swScanOrphans() {
    const ctx = SillyTavern.getContext();
    const { referenced, dir } = swCollectReferencedFiles();
    const resp = await fetch('/api/images/list', {
        method: 'POST',
        headers: ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: 'iig_refs', sortField: 'date', sortOrder: 'desc' }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const files = await resp.json();
    const list = Array.isArray(files) ? files.filter(f => typeof f === 'string') : [];
    const orphans = list.filter(f => !referenced.has(f));
    return { orphans, totalFiles: list.length, referencedCount: referenced.size, dir };
}

async function swDeleteFiles(dir, filenames) {
    const ctx = SillyTavern.getContext();
    let ok = 0, fail = 0;
    for (const f of filenames) {
        try {
            const r = await fetch('/api/images/delete', {
                method: 'POST',
                headers: ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: dir + f }),
            });
            if (r.ok) ok++; else fail++;
        } catch (e) { fail++; iigLog('WARN', 'delete file failed:', f, e.message); }
    }
    return { ok, fail };
}

function swOpenMaintenance(tab) {
    document.getElementById('sw-maint-overlay')?.remove();
    const ov = document.createElement('div'); ov.id = 'sw-maint-overlay';
    const panel = document.createElement('div'); panel.id = 'sw-maint-panel';
    panel.innerHTML = `
        <div class="sw-cleanup-header"><span><i class="fa-solid fa-broom"></i> Обслуживание гардероба</span><div class="sw-cleanup-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div></div>
        <div class="sw-maint-tabs">
            <div class="sw-maint-tab" data-mt="dedup"><i class="fa-solid fa-clone"></i> Дубликаты</div>
            <div class="sw-maint-tab" data-mt="cleanup"><i class="fa-solid fa-broom"></i> Чистка файлов</div>
        </div>
        <div class="sw-cleanup-body" id="sw-maint-body"></div>`;
    ov.appendChild(panel); document.body.appendChild(ov);
    const body = panel.querySelector('#sw-maint-body');

    function close() { document.removeEventListener('keydown', maintEsc, true); ov.remove(); }
    function maintEsc(e) { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } }
    document.addEventListener('keydown', maintEsc, true);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    panel.querySelector('.sw-cleanup-close').addEventListener('click', close);

    let curTab = null;
    function show(which) {
        if (which === curTab) return;
        curTab = which;
        for (const t of panel.querySelectorAll('.sw-maint-tab')) t.classList.toggle('sw-maint-tab-active', t.dataset.mt === which);
        if (which === 'cleanup') swRenderCleanup(body); else swRenderDedup(body);
    }
    for (const t of panel.querySelectorAll('.sw-maint-tab')) t.addEventListener('click', () => show(t.dataset.mt));
    show(tab === 'cleanup' ? 'cleanup' : 'dedup');
}

function swRenderCleanup(body) {
    const selected = new Set();
    let state = null;

    async function scan() {
        body.innerHTML = `<div class="sw-cleanup-loading"><i class="fa-solid fa-spinner fa-spin"></i> Сканирование…</div>`;
        try { state = await swScanOrphans(); selected.clear(); for (const f of state.orphans) selected.add(f); render(); }
        catch (e) { body.innerHTML = `<div class="sw-cleanup-err">Ошибка: ${esc(e.message)}</div>`; }
    }

    function render() {
        const { orphans, totalFiles, referencedCount, dir } = state;
        let h = `<div class="sw-cleanup-info">Используется: <b>${referencedCount}</b> · Лишних: <b>${orphans.length}</b> · Всего в папке: ${totalFiles}</div>`;
        if (orphans.length === 0) { h += `<div class="sw-cleanup-empty"><i class="fa-solid fa-circle-check"></i> Лишних файлов нет — всё используется.</div>`; body.innerHTML = h; return; }
        h += `<div class="sw-cleanup-hint">На эти файлы не ссылается ни один наряд или референс. Удалятся только выбранные.</div>`;
        h += `<div class="sw-cleanup-tools"><span class="sw-cleanup-link" id="sw-cl-all">Выбрать все</span><span class="sw-cleanup-link" id="sw-cl-none">Снять все</span></div>`;
        h += '<div class="sw-cleanup-grid">';
        for (const f of orphans) {
            h += `<div class="sw-cleanup-item ${selected.has(f) ? 'sw-cl-sel' : ''}" data-f="${esc(f)}"><img src="${esc(dir + f)}" loading="lazy" onerror="this.style.opacity=0.15"><div class="sw-cl-check"><i class="fa-solid fa-check"></i></div></div>`;
        }
        h += '</div>';
        h += `<div class="sw-cleanup-actions"><div class="sw-cleanup-btn sw-cleanup-del">Удалить выбранные (<span id="sw-cl-count">${selected.size}</span>)</div></div>`;
        body.innerHTML = h;

        body.querySelector('#sw-cl-all').addEventListener('click', () => { for (const f of orphans) selected.add(f); render(); });
        body.querySelector('#sw-cl-none').addEventListener('click', () => { selected.clear(); render(); });
        for (const it of body.querySelectorAll('.sw-cleanup-item')) {
            it.addEventListener('click', () => { const f = it.dataset.f; if (selected.has(f)) selected.delete(f); else selected.add(f); it.classList.toggle('sw-cl-sel'); const cnt = body.querySelector('#sw-cl-count'); if (cnt) cnt.textContent = selected.size; });
        }
        body.querySelector('.sw-cleanup-del').addEventListener('click', async () => {
            if (selected.size === 0) { toastr.info('Ничего не выбрано', 'Чистка'); return; }
            if (!confirm(`Удалить ${selected.size} файлов с сервера? Это необратимо.`)) return;
            const delBtn = body.querySelector('.sw-cleanup-del');
            delBtn.style.pointerEvents = 'none'; delBtn.textContent = 'Удаление…';
            const res = await swDeleteFiles(state.dir, [...selected]);
            toastr.success(`Удалено: ${res.ok}${res.fail ? `, ошибок: ${res.fail}` : ''}`, 'Чистка', { timeOut: 4000 });
            scan();
        });
    }
    scan();
}

function swRenderDedup(body) {
    const view = swCurrentView();
    const sideName = swTab === 'bot' ? 'Бот' : 'Юзер';
    const modeName = view.shared ? 'общий' : 'персональный';

    const dupKey = (o) => {
        const nm = (o.name || '').trim().toLowerCase();
        if (nm && nm !== 'без имени') return 'n:' + nm + '|' + swTypeOf(o);
        if (o.srcId) return 's:' + o.srcId;
        if (o.imagePath) return 'p:' + o.imagePath;
        return 'u:' + o.id;
    };

    const selected = new Set();
    let dupItems = [];

    function compute() {
        const list = view.list() || [];
        const groups = new Map();
        for (const o of list) { const k = dupKey(o); if (k[0] === 'u') continue; let arr = groups.get(k); if (!arr) groups.set(k, arr = []); arr.push(o); }
        const activeId = view.activeId();
        dupItems = []; selected.clear();
        let groupCount = 0;
        for (const g of groups.values()) {
            if (g.length < 2) continue;
            groupCount++;
            const keep = g.find(o => o.id === activeId) || g.reduce((a, b) => ((a.addedAt || 0) <= (b.addedAt || 0) ? a : b));
            for (const o of g) if (o.id !== keep.id) { dupItems.push(o); selected.add(o.id); }
        }
        return groupCount;
    }

    function paint() {
        for (const it of body.querySelectorAll('.sw-cleanup-item')) it.classList.toggle('sw-cl-sel', selected.has(it.dataset.id));
        const cnt = body.querySelector('#sw-dd-count'); if (cnt) cnt.textContent = selected.size;
    }

    function render() {
        const groupCount = compute();
        const total = (view.list() || []).length;
        let h = `<div class="sw-cleanup-info">Гардероб: <b>${esc(sideName)}</b> (${esc(modeName)}) · дубликатов: <b>${dupItems.length}</b> в ${groupCount} группах · всего: ${total}</div>`;
        if (dupItems.length === 0) { h += `<div class="sw-cleanup-empty"><i class="fa-solid fa-circle-check"></i> Дубликатов не найдено.</div>`; body.innerHTML = h; return; }
        h += `<div class="sw-cleanup-hint">По одному образу из каждой группы остаётся, остальные ниже и помечены на удаление.</div>`;
        h += `<div class="sw-cleanup-tools"><span class="sw-cleanup-link" id="sw-dd-all">Выбрать все</span><span class="sw-cleanup-link" id="sw-dd-none">Снять все</span></div>`;
        h += '<div class="sw-cleanup-grid">';
        for (const o of dupItems) {
            h += `<div class="sw-cleanup-item ${selected.has(o.id) ? 'sw-cl-sel' : ''}" data-id="${esc(o.id)}" title="${esc(o.name || '')}"><img src="${esc(swImgSrc(o))}" loading="lazy" onerror="this.style.opacity=0.15"><div class="sw-cl-check"><i class="fa-solid fa-check"></i></div></div>`;
        }
        h += '</div>';
        h += `<div class="sw-cleanup-actions"><div class="sw-cleanup-btn sw-dd-del">Удалить дубли (<span id="sw-dd-count">${selected.size}</span>)</div></div>`;
        body.innerHTML = h;

        body.querySelector('#sw-dd-all').addEventListener('click', () => { for (const o of dupItems) selected.add(o.id); paint(); });
        body.querySelector('#sw-dd-none').addEventListener('click', () => { selected.clear(); paint(); });
        for (const it of body.querySelectorAll('.sw-cleanup-item')) {
            it.addEventListener('click', () => { const id = it.dataset.id; if (selected.has(id)) selected.delete(id); else selected.add(id); paint(); });
        }
        body.querySelector('.sw-dd-del').addEventListener('click', () => {
            if (selected.size === 0) { toastr.info('Ничего не выбрано', 'Дубликаты'); return; }
            if (!confirm(`Удалить ${selected.size} дубликатов?`)) return;
            const ids = [...selected];
            for (const id of ids) view.remove(id);
            swSave();
            toastr.success(`Удалено дубликатов: ${ids.length}`, 'Дубликаты', { timeOut: 4000 });
            swPage = 0; swRender(); swUpdatePromptInjection(); swInjectBarBtn();
            render();
        });
    }
    render();
}

// ── Prompt injection ──

const SW_PROMPT_KEY = 'sillywardrobe_outfit';
const SW_INJECT_POSITION = 1;
const SW_INJECT_DEPTH = 0;
const SW_INJECT_ROLE = 0;
const SW_INJECT_SCAN = false;

function swBuildInjectionText(cn) {
    const botData = swGetActiveBotOutfit();
    const userData = swGetActiveUserOutfit();
    if (!botData && !userData) return '';

    const parts = [];
    if (botData) {
        const desc = swSanitizeDesc(botData.description);
        const label = desc || botData.name || 'неизвестный наряд';
        parts.push(`${cn}: ${label}`);
    }
    if (userData) {
        const desc = swSanitizeDesc(userData.description);
        const label = desc || userData.name || 'неизвестный наряд';
        parts.push(`{{user}}: ${label}`);
    }

    if (parts.length === 0) return '';
    return `[Текущая одежда]\n${parts.join('\n')}`;
}

export function swUpdatePromptInjection() {
    try {
        const ctx = SillyTavern.getContext();
        if (typeof ctx.setExtensionPrompt !== 'function') {
            iigLog('WARN', 'setExtensionPrompt not available');
            return;
        }
        const cn = swCharName();
        if (!cn) { ctx.setExtensionPrompt(SW_PROMPT_KEY, '', SW_INJECT_POSITION, SW_INJECT_DEPTH, SW_INJECT_SCAN, SW_INJECT_ROLE); return; }
        const injectionText = swBuildInjectionText(cn);
        ctx.setExtensionPrompt(SW_PROMPT_KEY, injectionText, SW_INJECT_POSITION, SW_INJECT_DEPTH, SW_INJECT_SCAN, SW_INJECT_ROLE);
        if (injectionText) iigLog('INFO', `Prompt injection set: ${injectionText.replace(/\s+/g, ' ').slice(0, 160)}…`);
        else iigLog('INFO', 'Prompt injection cleared');
    } catch (e) { iigLog('ERROR', 'Failed to update prompt injection:', e.message); }
}

// ── Bar button ──

export function swInjectBarBtn() {
    const settings = swGetSettings();
    if (settings.showFloatingBtn) {
        $('#sw-bar-btn').remove();
        swInjectFloatBtn();
        return;
    }

    let $btn = $('#sw-bar-btn');
    if ($btn.length === 0) {
        $btn = $('<div id="sw-bar-btn" title="Гардероб"><i class="fa-solid fa-shirt"></i></div>');
        $btn.on('click touchend', function(e) { e.preventDefault(); e.stopPropagation(); swOpenModal(); });
        const $left = $('#leftSendForm');
        if ($left.length) $left.append($btn); else $('body').append($btn);
    }
    const hasBot = !!swGetActiveBotOutfit();
    const hasUser = !!swGetActiveUserOutfit();
    const hasActive = hasBot || hasUser;
    $btn.toggleClass('sw-bar-active', hasActive);
    if (hasActive) {
        const count = (hasBot ? 1 : 0) + (hasUser ? 1 : 0);
        $btn.html(`<i class="fa-solid fa-shirt"></i><span class="sw-bar-count">${count}</span>`);
    } else {
        $btn.html('<i class="fa-solid fa-shirt"></i>');
    }
    $btn.show();
    swInjectFloatBtn();
}

function swInjectFloatBtn() {
    const show = !!swGetSettings().showFloatingBtn;
    let $fb = $('#sw-float-btn');
    if (!show) { if ($fb.length) $fb.remove(); return; }
    if ($fb.length === 0) {
        $fb = $('<div id="sw-float-btn" title="Гардероб"><i class="fa-solid fa-shirt"></i></div>');
        $fb.on('click touchend', function (e) { e.preventDefault(); e.stopPropagation(); swOpenModal(); });
        $('body').append($fb);
    }
    const hasBot = !!swGetActiveBotOutfit();
    const hasUser = !!swGetActiveUserOutfit();
    const count = (hasBot ? 1 : 0) + (hasUser ? 1 : 0);
    $fb.toggleClass('sw-float-active', count > 0);
    $fb.html(`<i class="fa-solid fa-shirt"></i>${count > 0 ? `<span class="sw-bar-count">${count}</span>` : ''}`);
    $fb.show();
}

// ── Public API (for extras.js / pipeline) ──

export function swFindItem(id) {
    const s = swGetSettings();
    for (const arr of [s.sharedBotWardrobe, s.sharedUserWardrobe]) {
        const found = arr.find(o => o.id === id);
        if (found) return found;
    }
    for (const w of Object.values(s.wardrobes || {})) {
        if (!w) continue;
        for (const side of ['bot', 'user']) {
            const found = (w[side] || []).find(o => o.id === id);
            if (found) return found;
        }
    }
    return null;
}

export function swBuildDescription(type) {
    const outfit = swGetActiveSideOutfit(type);
    if (!outfit) return '';
    return swSanitizeDesc(outfit.description) || '';
}

export async function getActiveOutfitBase64(type) {
    const side = type === 'bot' ? 'bot' : 'user';
    if (swSharedCfg(side).use()) {
        await swPreloadSharedActive(side);
        return swSharedCache[side].b64;
    }
    const outfit = swGetActiveSideOutfit(side);
    return outfit?.base64 || null;
}

export function getActiveOutfitDescription(type) {
    return swBuildDescription(type);
}

export async function getCollageBase64(_type) {
    return null;
}

export function getActiveOutfitData(type) {
    const side = type === 'bot' ? 'bot' : 'user';
    return swGetActiveSideOutfit(side);
}

// ── Init ──

export function initWardrobe() {
    swGetSettings();
    const ctx = SillyTavern.getContext();

    ctx.eventSource.on(ctx.event_types.APP_READY, () => {
        setTimeout(() => { swPreloadAllShared(); swUpdatePromptInjection(); swInjectBarBtn(); }, 500);
    });

    ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
        setTimeout(() => { swPreloadAllShared(); swUpdatePromptInjection(); swInjectBarBtn(); }, 300);
    });

    const _genEvents = ['GENERATION_STARTED', 'GENERATE_BEFORE_COMBINE_PROMPTS', 'GENERATION_AFTER_COMMANDS', 'MESSAGE_SENT'];
    for (const evName of _genEvents) {
        const ev = ctx.event_types?.[evName];
        if (ev) {
            ctx.eventSource.on(ev, () => {
                try { swUpdatePromptInjection(); } catch (e) { iigLog('WARN', `re-inject on ${evName} failed:`, e.message); }
            });
        }
    }

    iigLog('INFO', 'SillyWardrobe initialized');
}
