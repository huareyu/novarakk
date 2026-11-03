// ExtBlocks prompt selections are global bindings, not part of connection profiles.
import { saveSettings, normalizeExtBlocksPromptBindings } from '../settings.js';
import { EXT_BLOCKS_PRESETS, EXT_BLOCKS_NO_PRESET } from '../extBlocksIntegration.js';
import { sanitizeForHtml } from '../utils.js';
import { t } from '../i18n.js';

const fields = {
    prefixId: { collection: 'prefixes', label: () => t`Prefix` },
    styleId: { collection: 'styles', label: () => t`Style` },
    suffixId: { collection: 'suffixes', label: () => t`Suffix` },
};
let bindingController;

function optionsFor(settings, preset, key) {
    const selected = settings.extBlocksPromptBindings?.[preset]?.[key] || '';
    const items = Array.isArray(settings[fields[key].collection]) ? settings[fields[key].collection] : [];
    const noneLabel = key === 'styleId' ? t`Style from image prompt` : t`Do not add`;
    const rows = [['', t`Use active preset`], [EXT_BLOCKS_NO_PRESET, noneLabel],
        ...items.filter(item => item?.id).map(item => [String(item.id), String(item.name || item.id)])];
    if (selected && !rows.some(([id]) => id === selected)) rows.push([selected, t`Deleted preset — using active`]);
    return rows.map(([id, label]) => `<option value="${sanitizeForHtml(id)}" ${id === selected ? 'selected' : ''}>${sanitizeForHtml(label)}</option>`).join('');
}

function summaryFor(settings, preset) {
    return Object.entries(fields).map(([key, field]) => {
        const selected = settings.extBlocksPromptBindings?.[preset]?.[key] || '';
        const items = Array.isArray(settings[field.collection]) ? settings[field.collection] : [];
        const label = !selected ? t`Active` : selected === EXT_BLOCKS_NO_PRESET
            ? (key === 'styleId' ? t`From prompt` : t`None`)
            : items.find(item => item?.id === selected)?.name || t`Active`;
        return `${field.label()}: ${label}`;
    }).join(' · ');
}

export function buildExtBlocksPromptRoutingHtml(settings) {
    const visible = settings.externalBlocks && settings.extBlocksPromptRoutingEnabled;
    const labels = { big: t`Large preset`, medium: t`Medium preset`, small: t`Small preset` };
    return `<div class="iig-settings-card-nested" id="iig_extblocks_prompt_routing">
        <label class="checkbox_label"><input type="checkbox" id="iig_extblocks_prompt_routing_enabled" ${settings.extBlocksPromptRoutingEnabled ? 'checked' : ''}><span>${t`Separate styles, prefixes and suffixes for ExtBlocks presets`}</span></label>
        <div id="iig_extblocks_prompt_routing_fields" class="${visible ? '' : 'iig-hidden'}">
            <p class="hint">${t`Applies only to images inside external blocks. Each component can use the active preset, a specific preset, or no extension preset. Connection profiles and normal chat images are unaffected.`}</p>
            <div class="iig-extblocks-prompt-cards">${EXT_BLOCKS_PRESETS.map(preset => `<details class="iig-extblocks-prompt-card" data-iig-extblocks-prompt-card="${preset}" ${preset === 'big' ? 'open' : ''}>
                <summary><strong>${labels[preset]}</strong><span data-iig-extblocks-prompt-summary="${preset}">${sanitizeForHtml(summaryFor(settings, preset))}</span></summary>
                <div class="iig-extblocks-prompt-inputs">${Object.entries(fields).map(([key, field]) => {
                    const id = `iig_extblocks_prompt_${preset}_${key}`;
                    return `<div class="iig-extblocks-prompt-row"><label for="${id}">${field.label()}</label><select id="${id}" class="text_pole" data-iig-extblocks-prompt-preset="${preset}" data-iig-extblocks-prompt-kind="${key}">${optionsFor(settings, preset, key)}</select></div>`;
                }).join('')}</div>
            </details>`).join('')}</div>
            <p class="hint">${t`Create and edit choices in Styles, Prefixes and Suffixes below. These bindings are shared across connection profiles. A deleted preset falls back to the active selection.`}</p>
        </div>
    </div>`;
}

export function syncExtBlocksPromptRoutingVisibility(settings) {
    document.getElementById('iig_extblocks_prompt_routing_fields')?.classList.toggle(
        'iig-hidden', !settings.externalBlocks || !settings.extBlocksPromptRoutingEnabled,
    );
}

export function refreshExtBlocksPromptRoutingOptions(settings) {
    const root = document.getElementById('iig_extblocks_prompt_routing');
    if (!root) return;
    root.querySelectorAll('[data-iig-extblocks-prompt-kind]').forEach(select => {
        const preset = select.dataset.iigExtblocksPromptPreset;
        const key = select.dataset.iigExtblocksPromptKind;
        if (EXT_BLOCKS_PRESETS.includes(preset) && Object.hasOwn(fields, key)) {
            select.innerHTML = optionsFor(settings, preset, key);
        }
    });
    for (const preset of EXT_BLOCKS_PRESETS) {
        const summary = root.querySelector(`[data-iig-extblocks-prompt-summary="${preset}"]`);
        if (summary) summary.textContent = summaryFor(settings, preset);
    }
}

export function bindExtBlocksPromptRoutingEvents(settings) {
    bindingController?.abort();
    bindingController = new AbortController();
    const { signal } = bindingController;
    const root = document.getElementById('iig_extblocks_prompt_routing');
    if (!root) return;
    root.addEventListener('change', event => {
        const select = event.target;
        if (select?.id === 'iig_extblocks_prompt_routing_enabled') {
            settings.extBlocksPromptRoutingEnabled = Boolean(select.checked);
            syncExtBlocksPromptRoutingVisibility(settings);
            saveSettings();
            return;
        }
        if (!(select instanceof HTMLSelectElement)) return;
        const preset = select.dataset.iigExtblocksPromptPreset;
        const key = select.dataset.iigExtblocksPromptKind;
        if (!EXT_BLOCKS_PRESETS.includes(preset) || !Object.hasOwn(fields, key)) return;
        settings.extBlocksPromptBindings = normalizeExtBlocksPromptBindings(settings.extBlocksPromptBindings);
        settings.extBlocksPromptBindings[preset][key] = select.value;
        saveSettings();
        refreshExtBlocksPromptRoutingOptions(settings);
    }, { signal });
    document.addEventListener('iig-prompt-presets-changed', () => refreshExtBlocksPromptRoutingOptions(settings), { signal });
    syncExtBlocksPromptRoutingVisibility(settings);
}
