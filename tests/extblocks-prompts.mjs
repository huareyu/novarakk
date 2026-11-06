// No network: exercise real routing, prompt assembly and all three pipeline entry points.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const tag = (parts, ...values) => parts.reduce((out, part, i) => out + part + (values[i] ?? ''), '');
const records = [], failures = [];
const replacements = [];
let forceFailure = false;
let tags = [], media = [];
class Node {
    dataset = {}; style = {}; attrs = {}; isConnected = true;
    classList = { add() {}, remove() {}, contains() { return false; } };
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name] || ''; }
    addEventListener() {}
    querySelector() { return new Node(); }
    querySelectorAll() { return media; }
    replaceWith(next) { const i = media.indexOf(this); if (i >= 0) media[i] = next; next.parentElement = mesText; }
    appendChild(next) { media.push(next); }
}
const mesText = new Node(), mes = new Node();
mes.querySelector = () => mesText;
const app = { extensionSettings: {}, characters: [], characterId: 0, chat: [],
    saveSettingsDebounced() {}, saveChat: async () => {}, messageFormatting() {} };
const context = vm.createContext({ structuredClone, AbortController, DOMException,
    console: { log() {}, warn() {}, error(...args) { failures.push(args); } },
    SillyTavern: { getContext: () => app },
    document: { createElement: () => new Node(), querySelector: selector => selector.includes('.mes_text') ? mesText : mes },
    window: { getComputedStyle: () => ({ display: 'block' }) },
    setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
    toastr: { info() {}, success() {}, warning() {}, error(...args) { failures.push(args); } },
});
const stubs = {
    ProviderError: class extends Error {},
    t: tag, buildExtraPromptBlocks: () => [], checkFileExists: async () => false,
    sanitizeForHtml: value => String(value ?? ''), sanitizeForSingleQuotedAttribute: value => String(value ?? '')
        .replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    normalizeStoredImagePath: value => value, decodeHtmlEntities: value => String(value ?? '')
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'), isErrorImageSrc: () => false,
    saveImageToFile: async () => '/user/images/test.png',
    parseImageDataUrl: () => ({ mimeType: 'image/png', subtype: 'png', base64Data: 'FAKE' }),
    buildActiveCharacterLibraryPromptBlock: async () => '', getReferenceImage: ref => ref,
    recordCharacterGeneration() {}, validateSettings() {},
    resolveActiveProvider: () => ({ id: 'test', supportsReferences: () => true,
        collectReferences: async () => [],
        async generate({ prompt, style, options }) {
            await Promise.resolve();
            if (forceFailure) throw new Error('TEST generation failure');
            const settings = options.providerSettings || settingsModule.namespace.getSettings();
            records.push({ prompt: parser.namespace.buildFinalGenerationPrompt(prompt, style, [], settings,
                { includeReferencePromptBlocks: false }), apiType: settings.apiType, model: settings.model,
                prefix: settings.activePrefixId, suffix: settings.activeSuffixId, style: settings.activeStyleId,
                extBlocksPreset: options.extBlocksPreset });
            return 'data:image/png;base64,RkFLRQ==';
        },
    }),
};
const modules = new Map();
const real = new Set(['src/settings.js', 'src/matching.js', 'src/parser.js', 'src/extBlocksIntegration.js']);
async function load(path, parserOverride = false) {
    const code = await fs.readFile(new URL(path, root), 'utf8');
    const module = new vm.SourceTextModule(code, { context, identifier: path });
    modules.set(path, module);
    await module.link(async specifier => {
        const resolved = new URL(specifier, new URL(path, root)).href.replace(root.href, '');
        const match = [...code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)]
            .find(item => item[2] === specifier);
        assert.ok(match, `${path}: ${specifier}`);
        const names = match[1].split(',').map(name => name.trim()).filter(Boolean);
        if (real.has(resolved) && !(parserOverride && resolved === 'src/parser.js')) return modules.get(resolved);
        return new vm.SyntheticModule(names, function () {
            for (const name of names) {
                const override = parserOverride && resolved === 'src/parser.js' ? pipelineParser[name] : undefined;
                this.setExport(name, override ?? stubs[name]);
            }
        }, { context });
    });
    await module.evaluate();
    return module;
}
const settingsModule = await load('src/settings.js');
await load('src/matching.js');
const parser = await load('src/parser.js');
const routing = await load('src/extBlocksIntegration.js');
const s = settingsModule.namespace.getSettings();
assert.equal(s.showRegenerationMenu, true, 'existing installations keep the menu by default');
assert.ok(!settingsModule.namespace.CONNECTION_FIELDS.includes('showRegenerationMenu'), 'display preference is shared across profiles');
const item = (id, value = id) => ({ id, name: id, value, tags: [] });
Object.assign(s, { externalBlocks: true, extBlocksPromptRoutingEnabled: true,
    styles: [item('global-style'), item('big-style'), item('small-style')], activeStyleId: 'global-style',
    prefixes: [item('global-prefix'), item('big-prefix'), item('small-prefix')], activePrefixId: 'global-prefix',
    suffixes: [item('global-suffix'), item('big-suffix')], activeSuffixId: 'global-suffix',
    extBlocksPromptBindings: {
        big: { styleId: 'big-style', prefixId: 'big-prefix', suffixId: 'big-suffix' },
        medium: { styleId: '__none__', prefixId: '__none__', suffixId: '__none__' },
        small: { styleId: 'small-style', prefixId: 'small-prefix', suffixId: '' },
    },
    connectionProfiles: [{ id: 'other', name: 'Other', apiType: 'gemini', model: 'nano-banana-2' }],
    extBlocksProfileBindings: { big: 'other', medium: 'other', small: '' }, model: 'gpt-image-2',
});
app.extensionSettings.ExtBlocks = { active_set_idx: 0, sets: [{ global_blocks: [
    { name: 'large', api_preset: 'big' }, { name: 'medium', api_preset: 'medium' }, { name: 'small', api_preset: 'small' },
] }] };
const markup = '<img data-iig-instruction=\'{}\' src="[IMG:GEN]">';
const external = ['large', 'medium', 'small'].map(name => `<${name}>${markup}</${name}>`).join('');
const message = { mes: `Ordinary ${markup}`, extra: { extblocks: external, display_text: `Ordinary ${markup}${external}` } };
function makeTags() {
    let from = 0;
    return ['large', 'medium', 'small'].map(name => {
        const index = external.indexOf(markup, from); from = index + markup.length;
        return { prompt: 'a red apple', style: 'tag-style', fullMatch: markup, index, sourceKey: 'extblocks', isNewFormat: true };
    });
}
const baseline = JSON.stringify(s);
const routes = makeTags().map(image => routing.namespace.resolveExtBlocksImageRoute(message, image, s, app));
assert.deepEqual(routes.map(route => route.preset), ['big', 'medium', 'small']);
assert.equal(routes[0].providerSettings.apiType, 'openai', 'prompt-only routing must ignore connection bindings');
assert.equal(routes[0].providerSettings.activeStyleId, 'big-style');
assert.equal(routes[1].providerSettings.activeStyleId, '');
assert.equal(routes[2].providerSettings.activeSuffixId, 'global-suffix');
assert.equal(JSON.stringify(s), baseline, 'routing does not change global IDs or profiles');
assert.equal(routing.namespace.resolveExtBlocksImageRoute(message, { ...makeTags()[0], sourceKey: 'mes' }, s, app), null);
assert.equal(routing.namespace.resolveExtBlocksImageRoute(message, { ...makeTags()[0], sourceKey: 'display_text', index: 9 }, s, app), null);
for (const [index, image] of makeTags().entries()) {
    const displayed = { ...image, sourceKey: 'display_text', index: image.index + message.extra.display_text.indexOf(external) };
    assert.equal(routing.namespace.getExtBlocksPresetForTag(message, displayed, app), ['big', 'medium', 'small'][index]);
}
assert.equal(routing.namespace.resolveExtBlocksImageRoute(message, makeTags()[0], { ...s, externalBlocks: false }, app), null);
assert.equal(routing.namespace.resolveExtBlocksImageRoute(message, makeTags()[0], { ...s, extBlocksPromptRoutingEnabled: false }, app), null);
const both = { ...s, extBlocksProfileRoutingEnabled: true };
const combined = routing.namespace.resolveExtBlocksImageRoute(message, makeTags()[0], both, app);
assert.equal(combined.profile.id, 'other'); assert.equal(combined.providerSettings.apiType, 'gemini');
assert.equal(combined.providerSettings.activePrefixId, 'big-prefix');
const missing = { ...both, extBlocksProfileBindings: { big: 'missing' },
    extBlocksPromptBindings: { big: { styleId: 'missing', prefixId: 'big-prefix' } } };
const fallback = routing.namespace.resolveExtBlocksImageRoute(message, makeTags()[0], missing, app);
assert.equal(fallback.providerSettings.activeStyleId, 'global-style');
assert.equal(fallback.providerSettings.activePrefixId, 'big-prefix');
assert.equal(fallback.providerSettings.apiType, 'openai');
const connectionOnly = routing.namespace.resolveExtBlocksImageRoute(message, makeTags()[0],
    { ...both, extBlocksPromptRoutingEnabled: false }, app);
assert.equal(connectionOnly.providerSettings.apiType, 'gemini');
assert.equal(connectionOnly.providerSettings.activeStyleId, 'global-style');
app.characters = [{ data: { extensions: { ExtBlocks: [{ name: 'large', api_preset: 'small' }] } } }];
assert.equal(routing.namespace.getExtBlocksPresetForTag(message, makeTags()[0], app), 'small');
app.characters = [];
const normalized = settingsModule.namespace.normalizeExtBlocksPromptBindings({ big: { prefixId: 1, styleId: ' big-style ' } });
assert.equal(normalized.big.prefixId, ''); assert.equal(normalized.big.styleId, 'big-style');
assert.equal(normalized.small.suffixId, '');
assert.ok(!settingsModule.namespace.CONNECTION_FIELDS.includes('extBlocksPromptBindings'));

const pipelineParser = { ...parser.namespace, parseMessageImageTags: async () => structuredClone(tags),
    convertLegacyTagsToInstructionFormat: () => 0, getMatchedAdditionalReferences: () => [],
    createGeneratedMediaElement: () => new Node(), getInstructionAttributeValue: parser.namespace.getInstructionAttributeValue,
    isGeneratedVideoResult: () => false, buildPersistedMediaTag: parser.namespace.buildPersistedMediaTag,
    replaceTagInMessageSource(message, original, replacement) { replacements.push({ original: original.fullMatch, replacement }); }, rerenderMessageHtml() {},
};
const pipeline = await load('src/pipeline.js', true);
app.chat = [message];
function reset() {
    tags = makeTags(); records.length = 0; failures.length = 0; replacements.length = 0;
    media = tags.map(() => { const node = new Node(); node.parentElement = mesText; return node; });
}
const expected = ['[STYLE: big-style]\n\nbig-prefix a red apple big-suffix',
    '[STYLE: tag-style]\n\na red apple', '[STYLE: small-style]\n\nsmall-prefix a red apple global-suffix'];
reset();
await pipeline.namespace.processMessageTags(0);
assert.equal(failures.length, 0, JSON.stringify(failures));
assert.deepEqual(records.map(row => row.prompt), expected);
assert.deepEqual(records.map(row => row.extBlocksPreset), ['big', 'medium', 'small']);
reset();
await pipeline.namespace.regenerateMessageImages(0);
assert.equal(failures.length, 0, JSON.stringify(failures));
assert.deepEqual(records.map(row => row.prompt), expected);
reset();
await pipeline.namespace.regenerateSingleTag(0, 1);
assert.equal(failures.length, 0, JSON.stringify(failures));
assert.equal(records[0].prompt, expected[1]);
assert.equal(s.activeStyleId, 'global-style'); assert.equal(s.activePrefixId, 'global-prefix');
assert.equal(s.activeSuffixId, 'global-suffix');
reset(); s.extBlocksProfileRoutingEnabled = true;
await pipeline.namespace.regenerateSingleTag(0, 0);
assert.equal(failures.length, 0, JSON.stringify(failures));
assert.equal(records[0].apiType, 'gemini'); assert.equal(records[0].model, 'nano-banana-2');
assert.equal(records[0].prompt, expected[0]);
s.extBlocksProfileRoutingEnabled = false;
reset();
tags = [{ ...makeTags()[0], sourceKey: 'mes' }];
await pipeline.namespace.processMessageTags(0);
assert.equal(failures.length, 0, JSON.stringify(failures));
assert.equal(records[0].prompt, '[STYLE: global-style]\n\nglobal-prefix a red apple global-suffix');
console.log('PASS: three preset routes, independent toggles, combined profiles, normal-chat isolation, missing/deleted choices, tag style, concurrent generation, single/all regeneration, unchanged global selections');

reset();
const editedPrompt = `Zach's "new" outfit <b>green</b> & gold\nsecond line $&`;
const originalMarkup = tags[1].fullMatch;
await pipeline.namespace.regenerateSingleTag(0, 1, '', { prompt: editedPrompt });
assert.equal(failures.length, 0, JSON.stringify(failures));
assert.ok(records[0].prompt.includes(editedPrompt));
assert.equal(replacements.length, 1);
assert.equal(replacements[0].original, originalMarkup, 'replace the source tag, not the edited markup');
const persisted = parser.namespace.getInstructionAttributeValue({ isNewFormat: true, fullMatch: replacements[0].replacement });
assert.equal(parser.namespace.parseInstructionObject(persisted).prompt, editedPrompt);
assert.ok(replacements[0].replacement.includes('src="/user/images/test.png"'));
assert.equal(parser.namespace.parseInstructionObject(media[1].getAttribute('data-iig-instruction')).prompt, editedPrompt);
reset(); forceFailure = true;
await pipeline.namespace.regenerateSingleTag(0, 1, '', { prompt: 'failed draft' });
assert.equal(replacements.length, 0, 'failed generation must not persist the draft');
forceFailure = false; reset();
await pipeline.namespace.regenerateSingleTag(0, 1, '', { prompt: '   ' });
assert.equal(records.length, 0); assert.equal(replacements.length, 0);
reset();
await pipeline.namespace.regenerateSingleTag(0, 1, '', { prompt: 'works after failure' });
assert.equal(records.length, 1, 'failed attempts release the generation lock');
const details = { prompt: 'old', style: 'fixed', aspect_ratio: '2:3', image_size: '2K', quality: 'high', custom: { keep: true } };
const fullMatch = `<img data-iig-instruction='${JSON.stringify(details)}' src="/old.png">`;
const original = { ...makeTags()[0], fullMatch };
const changed = parser.namespace.buildEditedPromptTag(original, editedPrompt);
const savedDetails = parser.namespace.parseInstructionObject(parser.namespace.getInstructionAttributeValue(changed));
assert.equal(savedDetails.style, 'fixed'); assert.equal(savedDetails.aspect_ratio, '2:3');
assert.equal(savedDetails.image_size, '2K'); assert.equal(savedDetails.custom.keep, true);
assert.equal(original.fullMatch, fullMatch);
assert.equal(pipeline.namespace.findTagIndexByInstruction([{ prompt: 'same' }, { prompt: 'same' }], '{"prompt":"same"}', 1), 1);
for (const sourceKey of ['mes', 'extblocks', 'display_text']) {
    const swipeMessage = { mes: 'OLD', extra: { display_text: 'OLD', extblocks: 'OLD' }, swipe_id: 1,
        swipes: ['OLD', 'OLD'], swipe_info: [{ extra: { display_text: 'OLD', extblocks: 'OLD' } },
            { extra: { display_text: 'OLD', extblocks: 'OLD' } }] };
    parser.namespace.replaceTagInMessageSource(swipeMessage, { sourceKey, fullMatch: 'OLD' }, 'NEW');
    assert.equal(swipeMessage.swipes[0], 'OLD');
    assert.equal(swipeMessage.swipe_info[0].extra.display_text, 'OLD');
    assert.equal(swipeMessage.swipes[1], sourceKey === 'extblocks' ? 'OLD' : 'NEW');
    assert.equal(swipeMessage.swipe_info[1].extra.display_text, 'NEW');
    assert.equal(swipeMessage.swipe_info[1].extra.extblocks, sourceKey === 'mes' ? 'OLD' : 'NEW');
}
console.log('PASS: edited prompt request/persistence, original-source replacement, escaped quotes/HTML, unchanged parameters, no persistence on failure/empty input, released locks and duplicate-tag targeting');
