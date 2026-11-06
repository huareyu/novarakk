// A single native top-layer dialog avoids nested popup clipping on mobile browsers.
import { t } from './i18n.js';

let activeDialog;
let closeActive;
export function showRegenerationDialog({ entries, onGenerate, onError = console.error }) {
    closeActive?.();
    const dialog = document.createElement('dialog');
    dialog.className = 'iig-regen-dialog';
    dialog.setAttribute('aria-label', t`Image regeneration`);
    const controller = new AbortController();
    const { signal } = controller;
    const drafts = entries.map(entry => String(entry.prompt || ''));
    let selected = 0;
    let editor = false;
    let submitted = false;
    let dontAskAgain = false;
    const previousFocus = document.activeElement;
    const fit = () => {
        dialog.style.setProperty('--iig-regen-height', `${window.visualViewport?.height || window.innerHeight}px`);
        dialog.style.setProperty('--iig-regen-top', `${window.visualViewport?.offsetTop || 0}px`);
    };
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        controller.abort(); dialog.remove();
        if (activeDialog === dialog) { activeDialog = null; closeActive = null; }
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    const close = () => { dialog.close(); cleanup(); };
    const run = edited => {
        if (submitted) return;
        const textarea = dialog.querySelector('textarea');
        if (edited && !textarea.value.trim()) {
            textarea.setCustomValidity(t`Image prompt must not be empty`);
            textarea.reportValidity();
            return;
        }
        if (textarea) drafts[selected] = textarea.value;
        submitted = true;
        close();
        Promise.resolve().then(() => onGenerate({ edited, entry: entries[selected], prompt: drafts[selected], dontAskAgain })).catch(onError);
    };
    const render = () => {
        dialog.innerHTML = `<header class="iig-regen-header"><strong>${editor ? t`Edit image prompt` : t`Image regeneration`}</strong><button type="button" data-regen-close aria-label="${t`Close`}">×</button></header>
            <div class="iig-regen-body">${editor ? `
                <label class="iig-regen-picker">${t`Image`}<select class="text_pole" aria-label="${t`Image`}"></select></label>
                <label class="iig-regen-prompt-label">${t`Prompt`}<textarea class="text_pole" rows="8" spellcheck="false"></textarea></label>
                <p class="hint">${t`The edited prompt is saved with the new image only after a successful generation. Style, size and other settings remain unchanged.`}</p>
            ` : `<button type="button" class="iig-regen-choice" data-regen-edit><i class="fa-solid fa-pen"></i><span>${t`Rewrite prompt and generate`}</span></button>
                <button type="button" class="iig-regen-choice" data-regen-run><i class="fa-solid fa-rotate-right"></i><span>${entries.length > 1 ? t`Regenerate all images` : t`Regenerate image`}</span></button>
                <label class="iig-regen-remember"><input type="checkbox" data-regen-remember ${dontAskAgain ? 'checked' : ''}><span>${t`Do not ask again`}</span></label>
                <p class="hint">${t`Next time, regenerate immediately without editing. You can restore this choice in API settings → Generated image display.`}</p>`}</div>
            <footer class="iig-regen-footer"><button type="button" data-regen-back>${editor ? t`Back` : t`Cancel`}</button>${editor ? `<button type="button" class="iig-regen-submit" data-regen-submit>${t`Generate`}</button>` : ''}</footer>`;
        dialog.querySelector('[data-regen-close]').onclick = close;
        dialog.querySelector('[data-regen-back]').onclick = () => {
            if (!editor) return close();
            drafts[selected] = dialog.querySelector('textarea').value;
            editor = false; render();
        };
        if (!editor) {
            const remember = dialog.querySelector('[data-regen-remember]');
            remember.onchange = () => { dontAskAgain = remember.checked; };
            dialog.querySelector('[data-regen-edit]').onclick = () => { editor = true; render(); };
            dialog.querySelector('[data-regen-run]').onclick = () => run(false);
        } else {
            const select = dialog.querySelector('select');
            entries.forEach((entry, i) => {
                const option = document.createElement('option');
                option.value = String(i);
                option.textContent = `${t`Image`} ${entry.index + 1} — ${drafts[i].replace(/\s+/g, ' ').slice(0, 65)}`;
                select.appendChild(option);
            });
            select.value = String(selected);
            dialog.querySelector('.iig-regen-picker').hidden = entries.length === 1;
            const textarea = dialog.querySelector('textarea');
            textarea.value = drafts[selected];
            textarea.oninput = () => textarea.setCustomValidity('');
            select.onchange = () => { drafts[selected] = textarea.value; selected = Number(select.value); render(); };
            dialog.querySelector('[data-regen-submit]').onclick = () => run(true);
        }
        fit();
    };
    dialog.addEventListener('close', cleanup, { once: true });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    // Require an actual outside pointer-down before a backdrop click can dismiss it.
    let outsidePointer = false;
    dialog.addEventListener('pointerdown', event => {
        const rect = dialog.getBoundingClientRect();
        outsidePointer = event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    });
    dialog.addEventListener('click', event => { if (event.target === dialog && outsidePointer) close(); outsidePointer = false; });
    window.addEventListener('resize', fit, { signal });
    window.visualViewport?.addEventListener('resize', fit, { signal });
    window.visualViewport?.addEventListener('scroll', fit, { signal });
    document.body.appendChild(dialog); activeDialog = dialog; closeActive = close;
    render(); dialog.showModal();
    return dialog;
}
