import { parseMessageImageTags, getInstructionAttributeValue } from './parser.js';
import { regenerateSingleTag, regenerateMessageImages, findTagIndexByInstruction } from './pipeline.js';
import { showRegenerationDialog } from './regenerationUi.js';
import { t } from './i18n.js';
import { getSettings, saveSettings } from './settings.js';

export async function openRegenerationMenu({ messageId, tagIndex = null, instructionValue = '' }) {
    const context = SillyTavern.getContext();
    const chat = context.chat;
    const message = chat?.[messageId];
    if (!message) { toastr.error(t`Message not found`, t`Image Generation`); return; }
    if (getSettings().showRegenerationMenu === false) {
        // The legacy one-click behavior is available for both image and message buttons.
        if (tagIndex !== null) return regenerateSingleTag(messageId, tagIndex, instructionValue);
        return regenerateMessageImages(messageId);
    }
    const swipe = message.swipe_id;
    const stillCurrent = () => {
        const current = SillyTavern.getContext();
        return current.chat === chat && current.chat?.[messageId] === message && message.swipe_id === swipe;
    };
    const tags = await parseMessageImageTags(message, { forceAll: true });
    if (!stillCurrent()) return;
    let indexes = tags.map((_tag, index) => index);
    if (tagIndex !== null) {
        const matched = findTagIndexByInstruction(tags, instructionValue, tagIndex);
        const index = matched >= 0 ? matched : tagIndex;
        indexes = tags[index] ? [index] : [];
    }
    if (!indexes.length) { toastr.warning(t`Tag not found`, t`Image Generation`); return; }
    const entries = indexes.map(index => ({ index, prompt: tags[index].prompt, fullMatch: tags[index].fullMatch,
        instruction: getInstructionAttributeValue(tags[index]) }));
    const changed = () => toastr.warning(t`The chat or image changed. Open regeneration again.`, t`Image Generation`);
    return showRegenerationDialog({ entries,
        onError: error => toastr.error(String(error?.message || error), t`Image Generation`),
        onGenerate: async ({ edited, entry, prompt, dontAskAgain = false }) => {
            if (!stillCurrent()) { changed(); return; }
            const currentTags = await parseMessageImageTags(message, { forceAll: true });
            if (!stillCurrent() || (edited || tagIndex !== null
                ? currentTags[entry.index]?.fullMatch !== entry.fullMatch
                : currentTags.length !== entries.length || entries.some(item => currentTags[item.index]?.fullMatch !== item.fullMatch))) { changed(); return; }
            // Commit the preference only after a valid action, never on cancel or stale UI.
            if (dontAskAgain) {
                getSettings().showRegenerationMenu = false;
                saveSettings();
                const input = document.getElementById('iig_show_regeneration_menu');
                if (input) input.checked = false;
            }
            if (edited || tagIndex !== null) {
                await regenerateSingleTag(messageId, entry.index, entry.instruction, edited ? { prompt } : {});
            } else await regenerateMessageImages(messageId);
        },
    });
}
