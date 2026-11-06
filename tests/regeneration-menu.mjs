// No network: controller must reject stale chats, swipes and images before generation.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let tags = [{ prompt: 'first', fullMatch: 'FIRST' }, { prompt: 'second', fullMatch: 'SECOND' }];
let chat = [{ swipe_id: 0 }], shown, warnings = 0;
const settings = { showRegenerationMenu: true };
let saves = 0, parses = 0;
const checkbox = { checked: true };
const calls = [];
const ctx = vm.createContext({ console, SillyTavern: { getContext: () => ({ chat }) },
    document: { getElementById: () => checkbox },
    toastr: { error() { warnings++; }, warning() { warnings++; } } });
const stubs = {
    getSettings: () => settings, saveSettings: () => { saves++; },
    t: (parts, ...values) => parts.reduce((out, part, i) => out + part + (values[i] ?? ''), ''),
    parseMessageImageTags: async () => { parses++; return tags; },
    getInstructionAttributeValue: tag => JSON.stringify({ prompt: tag.prompt }),
    findTagIndexByInstruction: (_tags, _instruction, index) => index,
    regenerateSingleTag: async (...args) => calls.push(['single', ...args]),
    regenerateMessageImages: async (...args) => calls.push(['all', ...args]),
    showRegenerationDialog: args => { shown = args; return args; },
};
const source = await fs.readFile(new URL('../src/regenerationMenu.js', import.meta.url), 'utf8');
const module = new vm.SourceTextModule(source, { context: ctx });
await module.link(specifier => {
    const match = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)].find(match => match[2] === specifier);
    const names = match[1].split(',').map(name => name.trim()).filter(Boolean);
    return new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, stubs[name]); }, { context: ctx });
});
await module.evaluate();
const open = module.namespace.openRegenerationMenu;
await open({ messageId: 0, tagIndex: 1 });
assert.equal(shown.entries.length, 1); assert.equal(shown.entries[0].prompt, 'second');
await shown.onGenerate({ edited: true, entry: shown.entries[0], prompt: 'new second' });
assert.equal(calls[0][0], 'single'); assert.equal(calls[0][2], 1); assert.equal(calls[0][4].prompt, 'new second');
await open({ messageId: 0 });
await shown.onGenerate({ edited: false, entry: shown.entries[0] }); assert.equal(calls.at(-1)[0], 'all');
for (const change of [() => { chat = [{ swipe_id: 0 }]; }, () => { chat[0].swipe_id++; },
    () => { tags = [{ ...tags[0], fullMatch: 'changed' }, tags[1]]; }, () => { tags = [...tags, { fullMatch: 'THIRD' }]; }]) {
    await open({ messageId: 0 }); const before = calls.length;
    change(); await shown.onGenerate({ edited: false, entry: shown.entries[0] });
    assert.equal(calls.length, before, 'stale UI must not start a paid generation');
}
assert.equal(warnings, 4);
assert.equal(settings.showRegenerationMenu, true, 'stale or cancelled choices must not change the preference');
await open({ messageId: 0 });
await shown.onGenerate({ edited: false, entry: shown.entries[0], dontAskAgain: true });
assert.equal(settings.showRegenerationMenu, false); assert.equal(saves, 1);
assert.equal(checkbox.checked, false, 'open API setting stays in sync');
const previousDialog = shown, previousParses = parses;
await open({ messageId: 0 }); assert.equal(calls.at(-1)[0], 'all');
await open({ messageId: 0, tagIndex: 1, instructionValue: 'original' });
assert.equal(calls.at(-1)[0], 'single'); assert.equal(calls.at(-1)[2], 1);
assert.equal(calls.at(-1)[3], 'original');
assert.equal(shown, previousDialog); assert.equal(parses, previousParses, 'one-click mode skips menu parsing');
settings.showRegenerationMenu = true;
await open({ messageId: 0 }); assert.notEqual(shown, previousDialog, 'menu can be restored from settings');
chat[0].swipe_id++;
await shown.onGenerate({ edited: false, entry: shown.entries[0], dontAskAgain: true });
assert.equal(settings.showRegenerationMenu, true); assert.equal(saves, 1, 'stale UI cannot save dont-ask preference');
console.log('PASS: single/all/edit actions, chosen image, stale chat/swipe/source/count rejection');
console.log('PASS: dont-ask preference, saved settings, visible checkbox sync, one-click single/all regeneration, restoring the menu and no preference change on stale UI');
