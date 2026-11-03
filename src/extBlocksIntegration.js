import {
    buildConnectionProfileSettings,
    ensureConnectionProfiles,
    iigLog,
} from './settings.js';

export const EXT_BLOCKS_PRESETS = Object.freeze(['big', 'medium', 'small']);
export const EXT_BLOCKS_NO_PRESET = '__none__';

// Request-local active IDs: concurrent block generations never change the global selection.
export function buildExtBlocksPromptSettings(preset, settings) {
    if (!settings.extBlocksPromptRoutingEnabled || !EXT_BLOCKS_PRESETS.includes(preset)) return settings;
    const bindings = settings.extBlocksPromptBindings?.[preset] || {};
    const overrides = {};
    for (const [key, collection, activeKey] of [
        ['styleId', 'styles', 'activeStyleId'],
        ['prefixId', 'prefixes', 'activePrefixId'],
        ['suffixId', 'suffixes', 'activeSuffixId'],
    ]) {
        const selected = String(bindings[key] || '').trim();
        if (!selected) continue;
        if (selected === EXT_BLOCKS_NO_PRESET) overrides[activeKey] = '';
        else if (Array.isArray(settings[collection]) && settings[collection].some(item => item?.id === selected)) {
            overrides[activeKey] = selected;
        } else {
            iigLog('WARN', `ExtBlocks prompt route uses active preset: preset=${preset}, missing ${key}=${selected}`);
        }
    }
    return Object.keys(overrides).length ? { ...settings, ...overrides } : settings;
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getBlockTagNames(blockName) {
    const name = String(blockName || '').trim();
    if (!name.includes('=')) return { opening: name, closing: name };
    const beforeEquals = name.slice(0, name.indexOf('=')).trim();
    const closing = beforeEquals.split(/\s+/).slice(0, -1).join(' ');
    return { opening: name, closing: closing || beforeEquals };
}

function getBlockRegex(blockName) {
    const { opening, closing } = getBlockTagNames(blockName);
    return new RegExp(
        `<${escapeRegExp(opening)}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escapeRegExp(closing)}\\s*>`,
        'gi',
    );
}

function getExtBlocksSettings(context) {
    return context?.extensionSettings?.ExtBlocks || null;
}

function getKnownBlocks(context) {
    const extSettings = getExtBlocksSettings(context);
    if (!extSettings) return [];

    const character = context.characters?.[context.characterId];
    const scoped = Array.isArray(character?.data?.extensions?.ExtBlocks)
        ? character.data.extensions.ExtBlocks
        : [];
    const activeSet = Array.isArray(extSettings.sets)
        ? extSettings.sets[Number.isInteger(extSettings.active_set_idx) ? extSettings.active_set_idx : 0]
        : null;
    const global = Array.isArray(activeSet?.global_blocks) ? activeSet.global_blocks : [];

    // Match ExtBlocks' own priority rule: character-scoped blocks override
    // global blocks with the same name.
    const byName = new Map();
    for (const block of scoped) {
        if (block?.name) byName.set(String(block.name), block);
    }
    for (const block of global) {
        if (block?.name && !byName.has(String(block.name))) {
            byName.set(String(block.name), block);
        }
    }
    return [...byName.values()];
}

function tagBelongsToBlock(blockText, tag) {
    const fullMatch = String(tag?.fullMatch || '');
    if (fullMatch && blockText.includes(fullMatch)) return true;

    // This fallback covers harmless HTML quote/entity normalization between
    // extblocks storage and display_text. Prompt matching is intentionally
    // scoped to a single block and only used when the exact tag is absent.
    const prompt = String(tag?.prompt || '').trim();
    return prompt.length >= 16 && blockText.includes(prompt);
}

/** Returns the ExtBlocks API preset that owns this image tag, or null. */
export function getExtBlocksPresetForTag(message, tag, context = SillyTavern.getContext()) {
    const extblocksText = String(message?.extra?.extblocks || '');
    if (!extblocksText || !tag) return null;
    if (tag.sourceKey === 'mes') return null;

    // display_text contains message.mes too. Requiring a match in extblocks
    // prevents normal chat images from accidentally entering preset routing.
    const fullMatch = String(tag.fullMatch || '');
    const existsInExtBlocks = (fullMatch && extblocksText.includes(fullMatch))
        || (tag.sourceKey === 'extblocks');
    if (!existsInExtBlocks) return null;

    const blocks = getKnownBlocks(context);
    const indexedSource = tag.sourceKey === 'display_text'
        ? String(message?.extra?.display_text || '')
        : extblocksText;
    const tagIndex = Number(tag.index);
    if (tag.sourceKey === 'display_text' && Number.isFinite(tagIndex) && tagIndex >= 0) {
        const externalStart = indexedSource.lastIndexOf(extblocksText);
        if (externalStart >= 0 && (tagIndex < externalStart || tagIndex >= externalStart + extblocksText.length)) return null;
    }

    // Prefer the parser's exact character offset. This disambiguates two
    // blocks that happen to contain byte-identical image tags.
    if (Number.isFinite(tagIndex) && tagIndex >= 0 && indexedSource) {
        for (const block of blocks) {
            const name = String(block?.name || '').trim();
            if (!name) continue;
            for (const match of indexedSource.matchAll(getBlockRegex(name))) {
                const start = Number(match.index || 0);
                const end = start + match[0].length;
                if (tagIndex >= start && tagIndex < end && tagBelongsToBlock(match[0], tag)) {
                    const preset = String(block.api_preset || 'big').toLowerCase();
                    return EXT_BLOCKS_PRESETS.includes(preset) ? preset : 'big';
                }
            }
        }
    }

    for (const block of blocks) {
        const name = String(block?.name || '').trim();
        if (!name) continue;
        for (const match of extblocksText.matchAll(getBlockRegex(name))) {
            if (tagBelongsToBlock(match[0], tag)) {
                const preset = String(block.api_preset || 'big').toLowerCase();
                return EXT_BLOCKS_PRESETS.includes(preset) ? preset : 'big';
            }
        }
    }

    // Older/removed block definitions can still have content in chat history.
    // ExtBlocks treats a missing per-block preset as "big", so preserve that
    // behaviour instead of routing through an unrelated currently active one.
    return 'big';
}

/**
 * Resolve independent connection and prompt overrides for an external image.
 * Normal chat images and disabled routes retain the existing global behavior.
 */
export function resolveExtBlocksImageRoute(message, tag, settings, context = SillyTavern.getContext()) {
    if (!settings?.externalBlocks || !(settings.extBlocksProfileRoutingEnabled || settings.extBlocksPromptRoutingEnabled)) return null;
    const preset = getExtBlocksPresetForTag(message, tag, context);
    if (!preset) return null;

    const profileId = settings.extBlocksProfileRoutingEnabled
        ? String(settings.extBlocksProfileBindings?.[preset] || '').trim() : '';
    const withPrompts = providerSettings => buildExtBlocksPromptSettings(preset, providerSettings);
    if (!profileId) return { preset, profile: null, providerSettings: withPrompts(settings) };

    const profile = ensureConnectionProfiles(settings).find(item => item.id === profileId);
    if (!profile) {
        iigLog('WARN', `ExtBlocks image route ignored: preset=${preset}, missing profile=${profileId}`);
        return { preset, profile: null, providerSettings: withPrompts(settings) };
    }

    const providerSettings = withPrompts(buildConnectionProfileSettings(profile.id, settings));
    iigLog(
        'INFO',
        `ExtBlocks image route: preset=${preset}, profile=${profile.name}, provider=${profile.apiType}, model=${profile.model || profile.naisteraModel || profile.novelaiModel || '(default)'}`,
    );
    return { preset, profile, providerSettings };
}
