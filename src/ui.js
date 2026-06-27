/**
 * Рендеринг секций настроек и биндинг всех UI-обработчиков.
 *
 * Разделено на секции:
 *   - API (провайдер / endpoint / apiKey / model / параметры генерации)
 *   - Стили
 *   - Референсы (avatar-виджеты и additional references)
 *   - Отладка (retries / export logs)
 *
 * Фабрика `bindAvatarSectionEvents` заменяет дубликат обработчиков Gemini
 * и Naistera (раньше было два блока идентичного кода).
 */

import {
    getSettings,
    saveSettings,
    exportLogs,
    iigLog,
    ensureStyles,
    getActiveStyle,
    createStyle,
    updateStyle,
    removeStyle,
    toggleStyleFavorite,
    ensureStyleTags,
    addStyleTag,
    removeStyleTag,
    ensurePrefixes,
    createPrefix,
    getActivePrefix,
    updatePrefix,
    removePrefix,
    togglePrefixFavorite,
    ensureSuffixes,
    createSuffix,
    getActiveSuffix,
    updateSuffix,
    removeSuffix,
    toggleSuffixFavorite,
    ensureAdditionalReferencesArray,
    ensureLorebooks,
    getActiveLorebook,
    createLorebook,
    renameLorebook,
    removeLorebook,
    setLorebookEnabled,
    setActiveLorebook,
    DEFAULT_REF_INSTRUCTION,
    getLastRequestSnapshot,
    normalizeNaisteraModel,
    normalizeNaisteraVideoFrequency,
    normalizeImageContextCount,
    normalizeConfiguredEndpoint,
    shouldReplaceEndpointForApiType,
    getEndpointPlaceholder,
    NOVELAI_MODELS,
    NOVELAI_SAMPLERS,
    NOVELAI_SCHEDULERS,
    NOVELAI_SIZES,
    ensureNovelaiPresets,
    createNovelaiPreset,
    getActiveNovelaiPreset,
    updateNovelaiPreset,
    removeNovelaiPreset,
    toggleNovelaiPresetFavorite,
    MAX_CONTEXT_IMAGES,
    MAX_ADDITIONAL_REFERENCES,
    ensureConnectionProfiles,
    getActiveConnectionProfile,
    createConnectionProfile,
    saveCurrentIntoProfile,
    loadConnectionProfile,
    renameConnectionProfile,
    removeConnectionProfile,
} from './settings.js';
import {
    normalizeStoredImagePath,
    readFileAsDataUrl,
    saveImageToFile,
    sanitizeForHtml,
} from './utils.js';
import {
    buildAdditionalReferenceRowsHtml,
    renderAdditionalReferencesList,
    renderAdditionalReferencesStatus,
    buildUserAvatarDropdownControl,
    buildReferenceImportModalHtml,
    syncUserAvatarSelection,
    syncActivePersonaAvatarMode,
    refreshUserAvatarSelects,
    getUserAvatarDropdownConfigs,
    closeUserAvatarDropdowns,
    openReferenceImportModal,
    closeReferenceImportModal,
    importAdditionalReferencesFromUrls,
    downloadReferenceImageFromUrl,
    buildLorebookExportJson,
    lorebookFileNameFromTitle,
    triggerBrowserDownload,
    importLorebookFromUrl,
    importLorebookFromFile,
    renderIigBookMacro,
} from './references.js';
import { isGeminiModel, fetchModels, resolveActiveProvider, getActiveProviderMaxReferences } from './providers.js';
import {
    ensureNpcList,
    addNpc,
    removeNpc,
    updateNpc,
    toggleNpc,
    updateWardrobeInjection,
    ensureAvatarItems,
    addAvatarItem,
    removeAvatarItem,
    setActiveAvatar,
    getActiveAvatarItem,
    updateAvatarItemAppearance,
    updateAvatarAppearanceInjection,
    fileToResizedBase64,
} from './extras.js';
import {
    fetchVisionModels,
    generateAvatarAppearanceDescription,
    generateNpcAppearanceDescription,
    generateReferenceDescription,
    DEFAULT_VISION_PROMPT,
} from './vision.js';
import { swOpenModal, swInjectBarBtn } from './wardrobe.js';
import { t } from './i18n.js';
// Относительный путь: /scripts/extensions/third-party/sillyimages/src/ui.js → /scripts/popup.js
import { Popup } from '../../../../popup.js';

// ----- Section wrapper -----

function buildSettingsSectionHtml(sectionId, title, bodyHtml, expanded = true) {
    return `
        <div class="iig-section" data-section-id="${sectionId}">
            <div class="iig-section-toggle" data-section-toggle="${sectionId}">
                <span class="iig-section-title">${title}</span>
                <i class="fa-solid fa-chevron-down iig-section-chevron ${expanded ? '' : 'iig-section-chevron-collapsed'}"></i>
            </div>
            <div class="iig-section-body ${expanded ? '' : 'iig-hidden'}" id="${sectionId}">
                ${bodyHtml}
            </div>
        </div>
    `;
}

// ----- API section -----

function buildConnectionProfilesBlockHtml(settings = getSettings()) {
    const profiles = ensureConnectionProfiles(settings);
    const activeId = settings.activeConnectionProfileId;
    const optionsHtml = profiles.map((p) =>
        `<option value="${sanitizeForHtml(p.id)}" ${p.id === activeId ? 'selected' : ''}>${sanitizeForHtml(p.name)}</option>`,
    ).join('');
    return `
        <div class="iig-settings-card-nested iig-profile-bar">
            <div class="flex-row">
                <label for="iig_profile_select">${t`Profile`}</label>
                <select id="iig_profile_select" class="flex1">
                    ${optionsHtml || `<option value="">${t`(no profiles)`}</option>`}
                </select>
                <div class="iig-profile-buttons">
                    <div id="iig_profile_save" class="menu_button" title="${t`Save current settings into active profile`}">
                        <i class="fa-solid fa-floppy-disk"></i>
                    </div>
                    <div id="iig_profile_save_as" class="menu_button" title="${t`Save as new profile`}">
                        <i class="fa-solid fa-plus"></i>
                    </div>
                    <div id="iig_profile_rename" class="menu_button" title="${t`Rename active profile`}">
                        <i class="fa-solid fa-pen"></i>
                    </div>
                    <div id="iig_profile_remove" class="menu_button" title="${t`Delete active profile`}">
                        <i class="fa-solid fa-trash"></i>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function buildApiSettingsSectionHtml(settings = getSettings()) {
    const profilesHtml = buildConnectionProfilesBlockHtml(settings);
    const bodyHtml = `
        <div class="iig-settings-card">
            ${profilesHtml}
            <label class="checkbox_label">
                <input type="checkbox" id="iig_enabled" ${settings.enabled ? 'checked' : ''}>
                <span>${t`Enable image generation`}</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="iig_external_blocks" ${settings.externalBlocks ? 'checked' : ''}>
                <span>${t`Process external blocks`}</span>
            </label>

            <div class="flex-row">
                <label for="iig_api_type">${t`API type`}</label>
                <select id="iig_api_type" class="flex1">
                    <option value="openai" ${settings.apiType === 'openai' ? 'selected' : ''}>${t`OpenAI-compatible (/v1/images/generations)`}</option>
                    <option value="gemini" ${settings.apiType === 'gemini' ? 'selected' : ''}>${t`Gemini-compatible (nano-banana)`}</option>
                    <option value="openrouter" ${settings.apiType === 'openrouter' ? 'selected' : ''}>${t`OpenRouter (chat/completions)`}</option>
                    <option value="electronhub" ${settings.apiType === 'electronhub' ? 'selected' : ''}>${t`Electron Hub (/v1/images/*)`}</option>
                    <option value="naistera" ${settings.apiType === 'naistera' ? 'selected' : ''}>${t`Naistera (naistera.org)`}</option>
                    <option value="void" ${settings.apiType === 'void' ? 'selected' : ''}>${t`VoidAI / RouteMyAI (chat-completions)`}</option>
                    <option value="aigate" ${settings.apiType === 'aigate' ? 'selected' : ''}>${t`AIGate (GPT Image + Gemini)`}</option>
                    <option value="novelai" ${settings.apiType === 'novelai' ? 'selected' : ''}>${t`NovelAI (via ST proxy)`}</option>
                </select>
                <div></div>
            </div>

            <div class="flex-row">
                <label for="iig_endpoint">${t`Endpoint URL`}</label>
                <input type="text" id="iig_endpoint" class="text_pole flex1" value="${settings.endpoint}" placeholder="https://api.example.com">
                <div></div>
            </div>

            <label class="checkbox_label" title="${t`Use endpoint URL as-is: do not append /v1/images/generations, /chat/completions, etc. Model list refresh is disabled — enter model name manually.`}">
                <input type="checkbox" id="iig_raw_endpoint" ${settings.rawEndpoint ? 'checked' : ''}>
                <span>${t`Raw endpoint (do not append paths)`}</span>
            </label>

            <div class="flex-row">
                <label for="iig_api_key">${t`API key`}</label>
                <input type="password" id="iig_api_key" class="text_pole flex1" value="${settings.apiKey}">
                <div id="iig_key_toggle" class="menu_button iig-key-toggle" title="${t`Show / hide`}">
                    <i class="fa-solid fa-eye"></i>
                </div>
            </div>

            <p id="iig_naistera_hint" class="hint ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}">${t`For Naistera: paste the token from the Telegram bot and pick a model (grok / grok-pro / nano banana 2 / novelai).`}</p>

            <div class="flex-row ${settings.apiType === 'naistera' || settings.apiType === 'novelai' ? 'iig-hidden' : ''}" id="iig_model_row">
                <label for="iig_model_select">${t`Model`}</label>
                <input type="text" id="iig_model" class="text_pole flex1" value="${sanitizeForHtml(settings.model || '')}" placeholder="${t`Enter model name`}">
                <select id="iig_model_select" class="flex1 ${settings.rawEndpoint ? 'iig-hidden' : ''}">
                    ${settings.model ? `<option value="${sanitizeForHtml(settings.model)}" selected>${sanitizeForHtml(settings.model)}</option>` : `<option value="" selected disabled>${t`-- Select a model --`}</option>`}
                </select>
                <div id="iig_refresh_models" class="menu_button iig-refresh-btn" title="${t`Refresh list`}">
                    <i class="fa-solid fa-sync"></i>
                </div>
            </div>

            <div class="flex-row ${settings.apiType !== 'openai' && settings.apiType !== 'electronhub' ? 'iig-hidden' : ''}" id="iig_size_row">
                <label for="iig_size">${t`Size`}</label>
                <select id="iig_size" class="flex1">
                    <option value="auto" ${settings.size === 'auto' ? 'selected' : ''}>${t`Auto / from prompt`}</option>
                    <option value="1024x1024" ${settings.size === '1024x1024' ? 'selected' : ''}>${t`1024x1024 (Square)`}</option>
                    <option value="1792x1024" ${settings.size === '1792x1024' ? 'selected' : ''}>${t`1792x1024 (Landscape)`}</option>
                    <option value="1024x1792" ${settings.size === '1024x1792' ? 'selected' : ''}>${t`1024x1792 (Portrait)`}</option>
                    <option value="512x512" ${settings.size === '512x512' ? 'selected' : ''}>${t`512x512 (Small)`}</option>
                </select>
                <div></div>
            </div>

            <div class="flex-row ${settings.apiType !== 'openai' && settings.apiType !== 'electronhub' ? 'iig-hidden' : ''}" id="iig_quality_row">
                <label for="iig_quality">${t`Quality`}</label>
                <select id="iig_quality" class="flex1">
                    <option value="standard" ${settings.quality === 'standard' ? 'selected' : ''}>${t`Standard`}</option>
                    <option value="hd" ${settings.quality === 'hd' ? 'selected' : ''}>${t`HD`}</option>
                </select>
                <div></div>
            </div>

            <div class="flex-row ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}" id="iig_naistera_model_row">
                <label for="iig_naistera_model">${t`Model`}</label>
                <select id="iig_naistera_model" class="flex1">
                    <option value="grok" ${normalizeNaisteraModel(settings.naisteraModel) === 'grok' ? 'selected' : ''}>grok</option>
                    <option value="grok-pro" ${normalizeNaisteraModel(settings.naisteraModel) === 'grok-pro' ? 'selected' : ''}>grok-pro</option>
                    <option value="nano banana 2" ${normalizeNaisteraModel(settings.naisteraModel) === 'nano banana 2' ? 'selected' : ''}>nano banana 2</option>
                    <option value="novelai" ${normalizeNaisteraModel(settings.naisteraModel) === 'novelai' ? 'selected' : ''}>novelai</option>
                </select>
                <div></div>
            </div>

            <div class="flex-row ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}" id="iig_naistera_aspect_row">
                <label for="iig_naistera_aspect_ratio">${t`Aspect ratio`}</label>
                <select id="iig_naistera_aspect_ratio" class="flex1">
                    <option value="auto" ${settings.naisteraAspectRatio === 'auto' ? 'selected' : ''}>${t`Auto / from prompt`}</option>
                    <option value="1:1" ${settings.naisteraAspectRatio === '1:1' ? 'selected' : ''}>1:1</option>
                    <option value="16:9" ${settings.naisteraAspectRatio === '16:9' ? 'selected' : ''}>16:9</option>
                    <option value="9:16" ${settings.naisteraAspectRatio === '9:16' ? 'selected' : ''}>9:16</option>
                    <option value="3:2" ${settings.naisteraAspectRatio === '3:2' ? 'selected' : ''}>3:2</option>
                    <option value="2:3" ${settings.naisteraAspectRatio === '2:3' ? 'selected' : ''}>2:3</option>
                </select>
                <div></div>
            </div>

            <div id="iig_avatar_section" class="iig-settings-card-nested ${settings.apiType !== 'gemini' && settings.apiType !== 'openrouter' && settings.apiType !== 'void' ? 'iig-hidden' : ''}">
                <div class="flex-row">
                    <label for="iig_aspect_ratio">${t`Aspect ratio`}</label>
                    <select id="iig_aspect_ratio" class="flex1">
                        <option value="auto" ${settings.aspectRatio === 'auto' ? 'selected' : ''}>${t`Auto / from prompt`}</option>
                        <option value="1:1" ${settings.aspectRatio === '1:1' ? 'selected' : ''}>${t`1:1 (Square)`}</option>
                        <option value="2:3" ${settings.aspectRatio === '2:3' ? 'selected' : ''}>${t`2:3 (Portrait)`}</option>
                        <option value="3:2" ${settings.aspectRatio === '3:2' ? 'selected' : ''}>${t`3:2 (Landscape)`}</option>
                        <option value="3:4" ${settings.aspectRatio === '3:4' ? 'selected' : ''}>${t`3:4 (Portrait)`}</option>
                        <option value="4:3" ${settings.aspectRatio === '4:3' ? 'selected' : ''}>${t`4:3 (Landscape)`}</option>
                        <option value="4:5" ${settings.aspectRatio === '4:5' ? 'selected' : ''}>${t`4:5 (Portrait)`}</option>
                        <option value="5:4" ${settings.aspectRatio === '5:4' ? 'selected' : ''}>${t`5:4 (Landscape)`}</option>
                        <option value="9:16" ${settings.aspectRatio === '9:16' ? 'selected' : ''}>${t`9:16 (Vertical)`}</option>
                        <option value="16:9" ${settings.aspectRatio === '16:9' ? 'selected' : ''}>${t`16:9 (Wide)`}</option>
                        <option value="21:9" ${settings.aspectRatio === '21:9' ? 'selected' : ''}>${t`21:9 (Ultra-wide)`}</option>
                    </select>
                    <div id="iig_override_aspect_ratio_btn" class="menu_button iig-override-btn ${settings.overrideAspectRatio ? 'iig-override-active' : ''}" title="${t`Force override: always use this value, ignore AI prompt`}">
                        <i class="fa-solid fa-lock${settings.overrideAspectRatio ? '' : '-open'}"></i>
                    </div>
                </div>
                <div class="flex-row">
                    <label for="iig_image_size">${t`Resolution`}</label>
                    <select id="iig_image_size" class="flex1">
                        <option value="auto" ${settings.imageSize === 'auto' ? 'selected' : ''}>${t`Auto / from prompt`}</option>
                        <option value="1K" ${settings.imageSize === '1K' ? 'selected' : ''}>${t`1K (default)`}</option>
                        <option value="2K" ${settings.imageSize === '2K' ? 'selected' : ''}>2K</option>
                        <option value="4K" ${settings.imageSize === '4K' ? 'selected' : ''}>4K</option>
                    </select>
                    <div id="iig_override_image_size_btn" class="menu_button iig-override-btn ${settings.overrideImageSize ? 'iig-override-active' : ''}" title="${t`Force override: always use this value, ignore AI prompt`}">
                        <i class="fa-solid fa-lock${settings.overrideImageSize ? '' : '-open'}"></i>
                    </div>
                </div>
            </div>

            <div class="iig-settings-card-nested ${settings.apiType === 'naistera' ? '' : 'iig-hidden'}" id="iig_naistera_video_section">
                <h4>${t`Video`}</h4>
                <label class="checkbox_label">
                    <input type="checkbox" id="iig_naistera_video_test" ${settings.naisteraVideoTest ? 'checked' : ''}>
                    <span>${t`Enable video generation`}</span>
                </label>
                <div class="iig-video-frequency-row ${settings.naisteraVideoTest ? '' : 'iig-hidden'}" id="iig_naistera_video_frequency_row">
                    <div class="iig-video-frequency-input">
                        <span>${t`Every`}</span>
                        <input type="number" id="iig_naistera_video_every_n" class="text_pole" min="1" max="999" step="1" value="${normalizeNaisteraVideoFrequency(settings.naisteraVideoEveryN)}">
                        <span>${t`messages.`}</span>
                    </div>
                </div>
            </div>

            <div class="iig-settings-card-nested ${settings.apiType === 'electronhub' ? '' : 'iig-hidden'}" id="iig_electronhub_section">
                <h4>${t`ElectronHub Advanced`}</h4>
                <p class="hint">${t`Optional parameters for ElectronHub API. Leave empty to use model defaults.`}</p>
                
                <div class="flex-row">
                    <label for="iig_electronhub_style">${t`Style`}</label>
                    <select id="iig_electronhub_style" class="flex1">
                        <option value="" ${!settings.electronhubStyle ? 'selected' : ''}>${t`Auto / model default`}</option>
                        <option value="vivid" $

{settings.electronhubStyle === 'vivid' ? 'selected' : ''}>${t`Vivid`}</option>
                        <option value="natural" ${settings.electronhubStyle === 'natural' ? 'selected' : ''}>${t`Natural`}</option>
                    </select>
                    <div></div>
                </div>

                <div class="flex-col" style="margin-top: 8px;">
                    <label for="iig_electronhub_negative_prompt">${t`Negative prompt`}</label>
                    <textarea id="iig_electronhub_negative_prompt" class="text_pole iig-settings-textarea" rows="2" placeholder="${t`Things to avoid in the image`}">${sanitizeForHtml(settings.electronhubNegativePrompt || '')}</textarea>
                </div>

                <div class="flex-row" style="margin-top: 8px;">
                    <label for="iig_electronhub_guidance_scale">${t`Guidance scale`}</label>
                    <input type="number" id="iig_electronhub_guidance_scale" class="text_pole flex1" min="1" max="20" step="0.5" value="${settings.electronhubGuidanceScale || 7.5}" placeholder="7.5">
                    <div></div>
                </div>

                <div class="flex-row">
                    <label for="iig_electronhub_steps">${t`Steps`}</label>
                    <input type="number" id="iig_electronhub_steps" class="text_pole flex1" min="1" max="150" step="1" value="${settings.electronhubSteps || 50}" placeholder="50">
                    <div></div>
                </div>

                <div style="margin-top: 12px;">
                    <label class="checkbox_label" title="${t`Experimental: try sending reference images to models that support them`}">
                        <input type="checkbox" id="iig_electronhub_enable_references" ${settings.electronhubEnableReferences ? 'checked' : ''}>
                        <span>${t`Enable reference images (experimental)`}</span>
                    </label>
                    <p class="hint" style="margin-top: 4px;">${t`Most ElectronHub models don't support references. Enable this only if your model supports /v1/images/edits endpoint.`}</p>
                </div>
            </div>

            <div class="iig-settings-card-nested ${settings.apiType === 'novelai' ? '' : 'iig-hidden'}" id="iig_novelai_section">
                <h4>NovelAI</h4>
                <p class="hint">${t`Uses NovelAI API key from SillyTavern's API settings (NovelAI section).`}</p>

                <div class="flex-row">
                    <label for="iig_novelai_model">${t`Model`}</label>
                    <select id="iig_novelai_model" class="flex1">
                        ${NOVELAI_MODELS.map(m => `<option value="${m.value}" ${settings.novelaiModel === m.value ? 'selected' : ''}>${m.text}</option>`).join('')}
                    </select>
                    <div></div>
                </div>

                <div class="flex-row">
                    <label for="iig_novelai_sampler">${t`Sampler`}</label>
                    <select id="iig_novelai_sampler" class="flex1">
                        ${NOVELAI_SAMPLERS.map(s => `<option value="${s}" ${settings.novelaiSampler === s ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                    <div></div>
                </div>

                <div class="flex-row">
                    <label for="iig_novelai_scheduler">${t`Scheduler`}</label>
                    <select id="iig_novelai_scheduler" class="flex1">
                        ${NOVELAI_SCHEDULERS.map(s => `<option value="${s}" ${settings.novelaiScheduler === s ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                    <div></div>
                </div>

                <div class="flex-row">
                    <label for="iig_novelai_steps">${t`Steps`}</label>
                    <input type="number" id="iig_novelai_steps" class="text_pole flex1" min="1" max="50" step="1" value="${settings.novelaiSteps || 28}">
                    <div></div>
                </div>

                <div class="flex-row">
                    <label for="iig_novelai_scale">${t`CFG Scale`}</label>
                    <input type="number" id="iig_novelai_scale" class="text_pole flex1" min="1" max="30" step="0.5" value="${settings.novelaiScale || 5}">
                    <div></div>
                </div>

                <div class="flex-row">
                    <label for="iig_novelai_size">${t`Size`}</label>
                    <select id="iig_novelai_size" class="flex1">
                        ${NOVELAI_SIZES.map(s => `<option value="${s.value}" ${settings.novelaiSize === s.value ? 'selected' : ''}>${s.text}</option>`).join('')}
                    </select>
                    <div></div>
                </div>

                <div class="flex-col" style="margin-top: 8px;">
                    <label for="iig_novelai_negative_prompt">${t`Negative prompt`}</label>
                    <textarea id="iig_novelai_negative_prompt" class="text_pole iig-settings-textarea" rows="2" placeholder="${t`Things to avoid in the image`}">${sanitizeForHtml(settings.novelaiNegativePrompt || '')}</textarea>
                </div>

                <label class="checkbox_label" style="margin-top: 8px;" title="${t`Automatically adjust parameters to ensure free image generation (Opus tier). Max 1024x1024 px, max 28 steps.`}">
                    <input type="checkbox" id="iig_novelai_anlas_guard" ${settings.novelaiAnlasGuard ? 'checked' : ''}>
                    <span>${t`Anlas Guard (free generation)`}</span>
                </label>

                <label class="checkbox_label">
                    <input type="checkbox" id="iig_novelai_decrisper" ${settings.novelaiDecrisper ? 'checked' : ''}>
                    <span>${t`Decrisper (dynamic thresholding)`}</span>
                </label>

                <label class="checkbox_label">
                    <input type="checkbox" id="iig_novelai_variety_boost" ${settings.novelaiVarietyBoost ? 'checked' : ''}>
                    <span>${t`Variety+ (skip CFG above sigma)`}</span>
                </label>

                <label class="checkbox_label">
                    <input type="checkbox" id="iig_novelai_sm" ${settings.novelaiSm ? 'checked' : ''}>
                    <span>SMEA</span>
                </label>

                <label class="checkbox_label">
                    <input type="checkbox" id="iig_novelai_sm_dyn" ${settings.novelaiSmDyn ? 'checked' : ''}>
                    <span>${t`SMEA Dynamic`}</span>
                </label>

                <div class="iig-debug-actions" style="margin-top: 8px;">
                    <div id="iig_novelai_view_anlas" class="menu_button iig-button-inline">
                        <i class="fa-solid fa-coins"></i> ${t`View Anlas`}
                    </div>
                </div>
            </div>

            <div class="iig-settings-card-nested" id="iig_vision_section">
                <div class="iig-vision-head" data-iig-vision-toggle>
                    <h4>${t`Vision (outfit descriptions)`}</h4>
                    <i class="fa-solid fa-chevron-down iig-section-chevron iig-section-chevron-collapsed" id="iig_vision_chev"></i>
                </div>
                <div class="iig-vision-body iig-hidden" id="iig_vision_body">
                    <p class="hint">${t`Vision-capable model used to auto-generate outfit descriptions in the Wardrobe tab. If endpoint/key are empty, the main API settings are used.`}</p>

                    <div class="flex-row">
                        <label for="iig_vision_endpoint">${t`Vision endpoint`}</label>
                        <input type="text" id="iig_vision_endpoint" class="text_pole flex1" value="${sanitizeForHtml(settings.visionEndpoint || '')}" placeholder="${t`(empty = use main endpoint)`}">
                        <div></div>
                    </div>
                    <div class="flex-row">
                        <label for="iig_vision_api_key">${t`Vision API key`}</label>
                        <input type="password" id="iig_vision_api_key" class="text_pole flex1" value="${sanitizeForHtml(settings.visionApiKey || '')}" placeholder="${t`(empty = use main key)`}">
                        <div id="iig_vision_key_toggle" class="menu_button iig-key-toggle" title="${t`Show / hide`}">
                            <i class="fa-solid fa-eye"></i>
                        </div>
                    </div>
                    <div class="flex-row">
                        <label for="iig_vision_model_select">${t`Vision model`}</label>
                        <select id="iig_vision_model_select" class="flex1">
                            ${settings.visionModel
                                ? `<option value="${sanitizeForHtml(settings.visionModel)}" selected>${sanitizeForHtml(settings.visionModel)}</option>`
                                : `<option value="">${t`-- Select a model --`}</option>`}
                        </select>
                        <div id="iig_refresh_vision_models" class="menu_button iig-refresh-btn" title="${t`Refresh list`}">
                            <i class="fa-solid fa-sync"></i>
                        </div>
                    </div>
                    <div class="flex-col" style="margin-top: 8px;">
                        <label for="iig_vision_prompt">${t`Description prompt`}</label>
                        <textarea id="iig_vision_prompt" class="text_pole iig-settings-textarea" rows="3" placeholder="${sanitizeForHtml(DEFAULT_VISION_PROMPT)}">${sanitizeForHtml(settings.visionPrompt || '')}</textarea>
                    </div>
                </div>
            </div>
        </div>
    `;
    return buildSettingsSectionHtml('iig_api_section', t`API settings`, bodyHtml, true);
}

// ----- Generic preset section factory (styles / prefixes / suffixes) -----

const PRESETS_PER_PAGE = 8;

function truncatePresetValue(value, maxLen = 60) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return trimmed.length > maxLen ? trimmed.slice(0, maxLen) + '…' : trimmed;
}

function createPresetSectionUI(cfg) {
    const {
        p,
        sectionTitle,
        valuePlaceholder,
        showBrowse,
        multiActive,
        ensureFn, createFn, getActiveFn, updateFn, removeFn, toggleFavoriteFn,
        activeIdKey,
    } = cfg;

    const vs = { page: 0, sort: 'newest', filter: 'all', filterTag: '' };

    function id(suffix) { return `iig_${p}_${suffix}`; }

    function getSortedFiltered(settings) {
        let items = ensureFn(settings).slice();
        if (vs.filter === 'favorites') items = items.filter((s) => s.favorite);
        if (vs.filterTag) items = items.filter((s) => s.tags.includes(vs.filterTag));
        const favFirst = (a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
        switch (vs.sort) {
            case 'name-asc':  items.sort((a, b) => favFirst(a, b) || a.name.localeCompare(b.name)); break;
            case 'name-desc': items.sort((a, b) => favFirst(a, b) || b.name.localeCompare(a.name)); break;
            case 'oldest':    items.sort((a, b) => favFirst(a, b) || (a.createdAt || 0) - (b.createdAt || 0)); break;
            default:          items.sort((a, b) => favFirst(a, b) || (b.createdAt || 0) - (a.createdAt || 0)); break;
        }
        return items;
    }

    function buildSortBarHtml(totalCount, settings) {
        const sortOpts = [
            { value: 'newest', label: t`Newest` }, { value: 'oldest', label: t`Oldest` },
            { value: 'name-asc', label: 'A→Z' }, { value: 'name-desc', label: 'Z→A' },
        ];
        const sortHtml = sortOpts.map((o) =>
            `<option value="${o.value}" ${vs.sort === o.value ? 'selected' : ''}>${o.label}</option>`,
        ).join('');
        const allItems = ensureFn(settings);
        const favCount = allItems.filter((s) => s.favorite).length;
        const tags = ensureStyleTags(settings);
        const tagChipsHtml = tags.map((tag) => {
            const count = allItems.filter((s) => s.tags.includes(tag)).length;
            return `<div class="iig-styles-filter-chip iig-styles-tag-chip ${vs.filterTag === tag ? 'active' : ''}" data-ps-filter-tag="${sanitizeForHtml(tag)}">${sanitizeForHtml(tag)} <span class="iig-styles-filter-count">${count}</span></div>`;
        }).join('');
        return `<div class="iig-styles-sort-bar">
            <select class="text_pole iig-styles-sort-select" data-ps-sort title="${t`Sort`}">${sortHtml}</select>
            <div class="iig-styles-filter-chip ${vs.filter === 'all' && !vs.filterTag ? 'active' : ''}" data-ps-filter-all>${t`All`} <span class="iig-styles-filter-count">${totalCount}</span></div>
            <div class="iig-styles-filter-chip ${vs.filter === 'favorites' ? 'active' : ''}" data-ps-filter-fav><i class="fa-solid fa-star"></i> <span class="iig-styles-filter-count">${favCount}</span></div>
            ${tagChipsHtml}
        </div>`;
    }

    function buildPaginationHtml(totalPages) {
        if (totalPages <= 1) return '';
        const pages = [];
        for (let i = 0; i < totalPages; i++) {
            pages.push(`<div class="iig-styles-page-btn ${i === vs.page ? 'active' : ''}" data-ps-page="${i}">${i + 1}</div>`);
        }
        return `<div class="iig-styles-pagination">
            <div class="iig-styles-page-btn ${vs.page <= 0 ? 'disabled' : ''}" data-ps-page-prev><i class="fa-solid fa-chevron-left"></i></div>
            ${pages.join('')}
            <div class="iig-styles-page-btn ${vs.page >= totalPages - 1 ? 'disabled' : ''}" data-ps-page-next><i class="fa-solid fa-chevron-right"></i></div>
        </div>`;
    }

    function buildItemTagsHtml(item) {
        if (!item.tags || item.tags.length === 0) return '';
        return `<div class="iig-style-item-tags">${item.tags.map((tag) =>
            `<span class="iig-style-item-tag">${sanitizeForHtml(tag)}</span>`).join('')}</div>`;
    }

    function buildListHtml(settings) {
        const allSorted = getSortedFiltered(settings);
        const totalCount = ensureFn(settings).length;
        const totalPages = Math.max(1, Math.ceil(allSorted.length / PRESETS_PER_PAGE));
        if (vs.page >= totalPages) vs.page = Math.max(0, totalPages - 1);
        const pageItems = allSorted.slice(vs.page * PRESETS_PER_PAGE, (vs.page + 1) * PRESETS_PER_PAGE);
        const activeId = settings[activeIdKey];
        const sortBar = buildSortBarHtml(totalCount, settings);
        let emptyMsg;
        if (vs.filter === 'favorites' && vs.filterTag) emptyMsg = t`No favorites with this tag.`;
        else if (vs.filter === 'favorites') emptyMsg = t`No favorites yet.`;
        else if (vs.filterTag) emptyMsg = t`No items with this tag.`;
        else emptyMsg = t`No presets yet. Add one above.`;
        let listHtml;
        if (allSorted.length === 0) {
            listHtml = `<p class="hint">${emptyMsg}</p>`;
        } else {
            listHtml = pageItems.map((item) => {
                const isEditing = item.id === activeId;
                const isFav = item.favorite;
                const preview = truncatePresetValue(item.value);
                const isEnabled = multiActive ? item.enabled !== false : isEditing;
                const indicatorIcon = multiActive
                    ? `fa-${isEnabled ? 'solid fa-square-check' : 'regular fa-square'}`
                    : `fa-solid ${isEditing ? 'fa-circle-check' : 'fa-circle'}`;
                const indicatorAttr = multiActive ? `data-ps-toggle-enabled="${item.id}"` : '';
                return `<div class="iig-style-item ${isEditing ? 'iig-style-item-active' : ''}" data-ps-id="${item.id}">
                    <div class="iig-style-item-fav" data-ps-fav="${item.id}" title="${isFav ? t`Remove from favorites` : t`Add to favorites`}"><i class="fa-${isFav ? 'solid' : 'regular'} fa-star"></i></div>
                    <div class="iig-style-item-main" data-ps-activate="${item.id}">
                        <div class="iig-style-item-indicator" ${indicatorAttr}><i class="${indicatorIcon}"></i></div>
                        <div class="iig-style-item-info">
                            <span class="iig-style-item-name">${sanitizeForHtml(item.name)}</span>
                            ${preview ? `<span class="iig-style-item-preview">${sanitizeForHtml(preview)}</span>` : ''}
                            ${buildItemTagsHtml(item)}
                        </div>
                    </div>
                    <div class="iig-style-item-actions">
                        ${!multiActive && isEditing ? `<div class="menu_button iig-style-item-action" data-ps-deactivate><i class="fa-solid fa-power-off"></i></div>` : ''}
                        <div class="menu_button iig-style-item-action iig-style-item-delete" data-ps-remove="${item.id}"><i class="fa-solid fa-trash"></i></div>
                    </div>
                </div>`;
            }).join('');
        }
        return sortBar + listHtml + buildPaginationHtml(totalPages);
    }

    function buildEditorHtml(settings) {
        const active = getActiveFn(settings);
        if (!active) return '';
        const allTags = ensureStyleTags(settings);
        const editorTagsHtml = allTags.map((tag) => {
            const on = (active.tags || []).includes(tag);
            return `<div class="iig-style-editor-tag ${on ? 'active' : ''}" data-ps-editor-tag="${sanitizeForHtml(tag)}">${sanitizeForHtml(tag)}</div>`;
        }).join('');
        return `<div class="iig-style-editor">
            <div class="iig-style-editor-row">
                <input type="text" data-ps-name class="text_pole flex1" value="${sanitizeForHtml(active.name)}" placeholder="${t`Name`}">
            </div>
            <textarea data-ps-value class="text_pole iig-style-editor-textarea" rows="3" placeholder="${valuePlaceholder}">${sanitizeForHtml(active.value)}</textarea>
            ${editorTagsHtml ? `<div class="iig-style-editor-tags">${editorTagsHtml}</div>` : ''}
        </div>`;
    }

    function buildTagManagerHtml(settings) {
        const tags = ensureStyleTags(settings);
        const tagsHtml = tags.map((tag) =>
            `<div class="iig-styles-tag-manage-item"><span>${sanitizeForHtml(tag)}</span><div class="iig-styles-tag-manage-remove" data-ps-remove-tag="${sanitizeForHtml(tag)}"><i class="fa-solid fa-xmark"></i></div></div>`).join('');
        return `<div class="iig-styles-tag-manager">
            <div class="iig-styles-tag-manager-list">${tagsHtml}</div>
            <div class="iig-styles-tag-manager-add">
                <input type="text" data-ps-new-tag class="text_pole flex1" placeholder="${t`New tag…`}">
                <div class="menu_button" data-ps-add-tag><i class="fa-solid fa-plus"></i></div>
            </div>
        </div>`;
    }

    function render() {
        const settings = getSettings();
        const list = document.getElementById(id('presets'));
        const editor = document.getElementById(id('editor'));
        const tagMgr = document.getElementById(id('tag_manager'));
        if (list) list.innerHTML = buildListHtml(settings);
        if (editor) editor.innerHTML = buildEditorHtml(settings);
        if (tagMgr && !tagMgr.classList.contains('iig-hidden')) {
            tagMgr.innerHTML = buildTagManagerHtml(settings);
        }
    }

    function buildSectionHtml() {
        const browseBtn = showBrowse
            ? `<div id="${id('pick_site')}" class="menu_button iig-styles-toolbar-btn" title="${t`Browse styles from site`}"><i class="fa-solid fa-globe"></i> ${t`Browse`}</div>`
            : '';
        const bodyHtml = `<div class="iig-settings-card iig-styles-card">
            <div class="iig-styles-toolbar">
                ${browseBtn}
                <input type="text" id="${id('new_name')}" class="text_pole flex1" placeholder="${t`New preset name…`}">
                <div id="${id('add_btn')}" class="menu_button iig-styles-toolbar-btn"><i class="fa-solid fa-plus"></i></div>
                <div id="${id('tags_toggle')}" class="menu_button iig-styles-toolbar-btn" title="${t`Manage tags`}"><i class="fa-solid fa-tags"></i></div>
            </div>
            <div id="${id('tag_manager')}" class="iig-hidden"></div>
            <div id="${id('presets')}" class="iig-style-list"></div>
            <div id="${id('editor')}"></div>
        </div>`;
        return buildSettingsSectionHtml(id('section'), sectionTitle, bodyHtml, false);
    }

    function bindEvents(settings) {
        if (showBrowse) {
            document.getElementById(id('pick_site'))?.addEventListener('click', () => openStylePickerModal());
        }

        document.getElementById(id('add_btn'))?.addEventListener('click', () => {
            const input = document.getElementById(id('new_name'));
            createFn(input?.value || '');
            if (input) input.value = '';
            vs.page = 0; vs.sort = 'newest'; vs.filter = 'all'; vs.filterTag = '';
            saveSettings(); render();
        });

        document.getElementById(id('new_name'))?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); document.getElementById(id('add_btn'))?.click(); }
        });

        document.getElementById(id('tags_toggle'))?.addEventListener('click', () => {
            const mgr = document.getElementById(id('tag_manager'));
            if (!mgr) return;
            const wasHidden = mgr.classList.contains('iig-hidden');
            mgr.classList.toggle('iig-hidden', !wasHidden);
            if (wasHidden) mgr.innerHTML = buildTagManagerHtml(settings);
        });

        document.getElementById(id('tag_manager'))?.addEventListener('click', (e) => {
            const tgt = e.target instanceof Element ? e.target : null;
            if (!tgt) return;
            const rmBtn = tgt.closest('[data-ps-remove-tag]');
            if (rmBtn) {
                const tagName = rmBtn.getAttribute('data-ps-remove-tag') || '';
                removeStyleTag(tagName, settings);
                if (vs.filterTag === tagName) vs.filterTag = '';
                saveSettings(); render();
                const mgr = document.getElementById(id('tag_manager'));
                if (mgr) mgr.innerHTML = buildTagManagerHtml(settings);
                return;
            }
            if (tgt.closest('[data-ps-add-tag]')) {
                const input = document.getElementById(id('tag_manager'))?.querySelector('[data-ps-new-tag]');
                if (input instanceof HTMLInputElement && input.value.trim()) {
                    addStyleTag(input.value.trim(), settings);
                    input.value = '';
                    saveSettings(); render();
                    const mgr = document.getElementById(id('tag_manager'));
                    if (mgr) mgr.innerHTML = buildTagManagerHtml(settings);
                }
                return;
            }
        });

        document.getElementById(id('tag_manager'))?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.hasAttribute('data-ps-new-tag')) {
                e.preventDefault();
                document.getElementById(id('tag_manager'))?.querySelector('[data-ps-add-tag]')?.click();
            }
        });

        const listEl = document.getElementById(id('presets'));

        listEl?.addEventListener('click', (e) => {
            const tgt = e.target instanceof Element ? e.target : null;
            if (!tgt) return;

            const fav = tgt.closest('[data-ps-fav]');
            if (fav) { toggleFavoriteFn(fav.getAttribute('data-ps-fav')); saveSettings(); render(); return; }

            const tog = tgt.closest('[data-ps-toggle-enabled]');
            if (tog) {
                const tid = tog.getAttribute('data-ps-toggle-enabled') || '';
                const item = ensureFn(settings).find(x => x.id === tid);
                if (item) { updateFn(tid, { enabled: !item.enabled }); saveSettings(); render(); }
                return;
            }

            const act = tgt.closest('[data-ps-activate]');
            if (act) {
                const aid = act.getAttribute('data-ps-activate') || '';
                settings[activeIdKey] = aid === settings[activeIdKey] ? '' : aid;
                saveSettings(); render(); return;
            }

            if (tgt.closest('[data-ps-deactivate]')) { settings[activeIdKey] = ''; saveSettings(); render(); return; }

            const rm = tgt.closest('[data-ps-remove]');
            if (rm) { removeFn(rm.getAttribute('data-ps-remove')); saveSettings(); render(); return; }

            const pg = tgt.closest('[data-ps-page]');
            if (pg) { vs.page = parseInt(pg.getAttribute('data-ps-page'), 10) || 0; render(); return; }
            if (tgt.closest('[data-ps-page-prev]')) { if (vs.page > 0) { vs.page--; render(); } return; }
            if (tgt.closest('[data-ps-page-next]')) {
                const tp = Math.max(1, Math.ceil(getSortedFiltered(settings).length / PRESETS_PER_PAGE));
                if (vs.page < tp - 1) { vs.page++; render(); } return;
            }
            if (tgt.closest('[data-ps-filter-all]')) { vs.filter = 'all'; vs.filterTag = ''; vs.page = 0; render(); return; }
            if (tgt.closest('[data-ps-filter-fav]')) { vs.filter = vs.filter === 'favorites' ? 'all' : 'favorites'; vs.page = 0; render(); return; }
            const tagC = tgt.closest('[data-ps-filter-tag]');
            if (tagC) { const tn = tagC.getAttribute('data-ps-filter-tag') || ''; vs.filterTag = vs.filterTag === tn ? '' : tn; vs.page = 0; render(); return; }
        });

        listEl?.addEventListener('change', (e) => {
            if (e.target instanceof HTMLSelectElement && e.target.hasAttribute('data-ps-sort')) {
                vs.sort = e.target.value; vs.page = 0; render();
            }
        });

        document.getElementById(id('editor'))?.addEventListener('input', (e) => {
            const active = getActiveFn(settings);
            if (!active) return;
            const tgt = e.target;
            if (!(tgt instanceof HTMLInputElement || tgt instanceof HTMLTextAreaElement)) return;
            if (tgt.hasAttribute('data-ps-name')) {
                updateFn(active.id, { name: tgt.value }); saveSettings();
                const nameEl = document.querySelector(`[data-ps-id="${active.id}"] .iig-style-item-name`);
                if (nameEl) nameEl.textContent = getActiveFn(settings)?.name || tgt.value.trim() || active.name;
                return;
            }
            if (tgt.hasAttribute('data-ps-value')) {
                updateFn(active.id, { value: tgt.value }); saveSettings();
                const prev = document.querySelector(`[data-ps-id="${active.id}"] .iig-style-item-preview`);
                if (prev) prev.textContent = truncatePresetValue(tgt.value);
                return;
            }
        });

        document.getElementById(id('editor'))?.addEventListener('click', (e) => {
            const tgt = e.target instanceof Element ? e.target : null;
            if (!tgt) return;
            const edTag = tgt.closest('[data-ps-editor-tag]');
            if (edTag) {
                const active = getActiveFn(settings);
                if (!active) return;
                const tagName = edTag.getAttribute('data-ps-editor-tag') || '';
                const tags = (active.tags || []).slice();
                const idx = tags.indexOf(tagName);
                if (idx === -1) tags.push(tagName); else tags.splice(idx, 1);
                updateFn(active.id, { tags }); saveSettings(); render();
            }
        });
    }

    return { render, buildSectionHtml, bindEvents, viewState: vs };
}

// ----- Preset section instances -----

const styleSection = createPresetSectionUI({
    p: 'style', sectionTitle: t`Styles`,
    valuePlaceholder: 'masterpiece, cinematic lighting, painterly',
    showBrowse: true,
    ensureFn: ensureStyles, createFn: createStyle, getActiveFn: getActiveStyle,
    updateFn: updateStyle, removeFn: removeStyle, toggleFavoriteFn: toggleStyleFavorite,
    activeIdKey: 'activeStyleId',
});

const prefixSection = createPresetSectionUI({
    p: 'prefix', sectionTitle: t`Prefixes`,
    valuePlaceholder: 'photorealistic 8K RAW photo, ',
    showBrowse: false,
    ensureFn: ensurePrefixes, createFn: createPrefix, getActiveFn: getActivePrefix,
    updateFn: updatePrefix, removeFn: removePrefix, toggleFavoriteFn: togglePrefixFavorite,
    activeIdKey: 'activePrefixId',
});

const suffixSection = createPresetSectionUI({
    p: 'suffix', sectionTitle: t`Suffixes`,
    valuePlaceholder: ', sharp focus, ultra detailed, no artifacts',
    showBrowse: false,
    ensureFn: ensureSuffixes, createFn: createSuffix, getActiveFn: getActiveSuffix,
    updateFn: updateSuffix, removeFn: removeSuffix, toggleFavoriteFn: toggleSuffixFavorite,
    activeIdKey: 'activeSuffixId',
});

const novelaiPresetSection = createPresetSectionUI({
    p: 'nai_preset', sectionTitle: t`NovelAI Presets`,
    valuePlaceholder: '1girl, long white hair, purple eyes, school uniform',
    showBrowse: false, multiActive: true,
    ensureFn: ensureNovelaiPresets, createFn: createNovelaiPreset, getActiveFn: getActiveNovelaiPreset,
    updateFn: updateNovelaiPreset, removeFn: removeNovelaiPreset, toggleFavoriteFn: toggleNovelaiPresetFavorite,
    activeIdKey: 'activeNovelaiPresetId',
});

export function renderStyleSettings() {
    styleSection.render();
    prefixSection.render();
    suffixSection.render();
    novelaiPresetSection.render();
}

const IIG_STYLE_SOURCE_URL = 'https://wewwaistyping.github.io/slayimagespromts/';
const IIG_STYLE_CACHE_KEY = 'iig_site_styles_cache_v1';
const IIG_STYLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readSiteStyleCache() {
    try {
        const raw = localStorage.getItem(IIG_STYLE_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.styles)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeSiteStyleCache(styles, meta = {}) {
    try {
        localStorage.setItem(IIG_STYLE_CACHE_KEY, JSON.stringify({
            styles,
            etag: meta.etag || '',
            lastModified: meta.lastModified || '',
            ts: Date.now(),
        }));
    } catch {
        // localStorage may be full or unavailable in embedded WebViews.
    }
}

function parseSiteStyles(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const styles = [];
    for (const card of doc.querySelectorAll('article.style-card')) {
        const name = card.querySelector('h2.card-title')?.textContent?.trim() || '';
        const tags = String(card.getAttribute('data-tags') || '')
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean);
        const descEl = card.querySelector('p.card-desc');
        const description = (descEl?.getAttribute('data-ru') || descEl?.textContent || '').trim();
        const images = Array.from(card.querySelectorAll('.carousel-track img'))
            .map((img) => {
                const src = img.getAttribute('src') || '';
                if (!src) return '';
                try {
                    return new URL(src, IIG_STYLE_SOURCE_URL).href;
                } catch {
                    return '';
                }
            })
            .filter(Boolean);
        const stableBadge = card.querySelector('.badge-green');
        const experimentalBadge = card.querySelector('.badge-yellow');
        const badgeEl = stableBadge || experimentalBadge;
        const badge = (badgeEl?.getAttribute('data-ru') || badgeEl?.textContent || '').trim();
        const promptRaw = card.querySelector('.prompt-panel[data-panel="direct"] .prompt-code')?.textContent?.trim() || '';
        const prompt = promptRaw.replace(/^\[Describe your scene here\]\.\s*/i, '').trim();
        if (name && prompt) {
            styles.push({ name, tags, description, images, badge, prompt });
        }
    }
    return styles;
}

async function fetchSiteStyles(cached = null, force = false) {
    const headers = {};
    if (!force && cached?.etag) headers['If-None-Match'] = cached.etag;
    if (!force && cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

    const response = await fetch(IIG_STYLE_SOURCE_URL, { headers });
    if (response.status === 304 && cached) {
        return { styles: cached.styles, notModified: true };
    }
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const styles = parseSiteStyles(html);
    writeSiteStyleCache(styles, {
        etag: response.headers.get('ETag') || '',
        lastModified: response.headers.get('Last-Modified') || '',
    });
    return { styles, notModified: false };
}

function activateSiteStyle(styleName, stylePrompt) {
    const settings = getSettings();
    const prompt = String(stylePrompt || '').trim();
    if (!prompt) {
        settings.activeStyleId = '';
        saveSettings();
        renderStyleSettings();
        return;
    }

    const styles = ensureStyles(settings);
    const name = String(styleName || '').trim() || t`Imported style`;
    let style = styles.find((item) => item.value === prompt)
        || styles.find((item) => item.name === name);

    if (!style) {
        style = createStyle(name);
    }

    updateStyle(style.id, { name, value: prompt });
    settings.activeStyleId = style.id;
    saveSettings();
    renderStyleSettings();
}

async function openStylePickerModal() {
    const settings = getSettings();
    const activeStyle = getActiveStyle(settings);
    const overlay = document.createElement('div');
    overlay.className = 'iig-style-overlay';
    overlay.innerHTML = `
        <div class="iig-style-modal">
            <div class="iig-style-modal-head">
                <span class="iig-style-modal-title"><i class="fa-solid fa-palette"></i> ${t`Choose style`}</span>
                <a class="iig-style-source-link" href="${IIG_STYLE_SOURCE_URL}" target="_blank" rel="noopener" title="${t`Open source site`}">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> ${t`Site`}
                </a>
                <div class="iig-style-refresh menu_button" title="${t`Refresh styles`}"><i class="fa-solid fa-rotate"></i></div>
                <div class="iig-style-modal-close menu_button" title="${t`Close`}"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <div class="iig-style-filters"></div>
            <div class="iig-style-body"><div class="iig-style-loading">${t`Loading styles...`}</div></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const modal = overlay.querySelector('.iig-style-modal');
    const bodyEl = overlay.querySelector('.iig-style-body');
    const filtersEl = overlay.querySelector('.iig-style-filters');
    const closeOverlay = (event = null) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        overlay.remove();
    };

    overlay.querySelector('.iig-style-modal-close')?.addEventListener('click', closeOverlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeOverlay(event); });
    modal?.addEventListener('click', (event) => event.stopPropagation());
    modal?.addEventListener('mousedown', (event) => event.stopPropagation());
    modal?.addEventListener('touchstart', (event) => event.stopPropagation(), { passive: true });
    modal?.addEventListener('touchend', (event) => event.stopPropagation(), { passive: true });
    modal?.addEventListener('pointerdown', (event) => event.stopPropagation());
    modal?.addEventListener('pointerup', (event) => event.stopPropagation());

    let styles = [];
    let activeTag = '';

    const renderFilters = () => {
        const tags = Array.from(new Set(styles.flatMap((style) => style.tags))).sort();
        const labels = {
            painting: t`Painting`,
            illustration: t`Illustration`,
            film: t`Film/photo`,
            game: t`Games`,
            cartoon: t`Cartoons`,
            anime: t`Anime`,
            print: t`Print`,
            '3d': '3D',
        };
        filtersEl.innerHTML = ['', ...tags].map((tag) => `
            <button class="iig-style-chip ${activeTag === tag ? 'active' : ''}" data-tag="${sanitizeForHtml(tag)}">${tag ? sanitizeForHtml(labels[tag] || tag) : t`All`}</button>
        `).join('');
        filtersEl.querySelectorAll('.iig-style-chip').forEach((button) => {
            button.addEventListener('click', () => {
                activeTag = button.getAttribute('data-tag') || '';
                renderFilters();
                renderGrid();
            });
        });
    };

    const makeCard = (style, selected, noReplace = false) => {
        if (noReplace) {
            return `
                <article class="iig-site-style-card ${selected ? 'selected' : ''}">
                    <div class="iig-site-style-preview iig-site-style-empty"><i class="fa-solid fa-ban"></i></div>
                    <button class="iig-site-style-body" data-style-prompt="" data-style-name="" type="button">
                        <span class="iig-site-style-name">${t`Do not replace`}</span>
                        <span class="iig-site-style-desc">${t`Use style from the prompt or no style.`}</span>
                    </button>
                </article>
            `;
        }

        const image = style.images?.[0] || '';
        return `
            <article class="iig-site-style-card ${selected ? 'selected' : ''}">
                <div class="iig-site-style-preview">
                    ${image ? `<img src="${sanitizeForHtml(image)}" alt="" loading="lazy">` : `<i class="fa-solid fa-image"></i>`}
                </div>
                <button class="iig-site-style-body" data-style-prompt="${encodeURIComponent(style.prompt)}" data-style-name="${encodeURIComponent(style.name)}" type="button">
                    <span class="iig-site-style-head">
                        <span class="iig-site-style-name">${sanitizeForHtml(style.name)}</span>
                        ${style.badge ? `<span class="iig-site-style-badge">${sanitizeForHtml(style.badge)}</span>` : ''}
                    </span>
                    ${style.description ? `<span class="iig-site-style-desc">${sanitizeForHtml(style.description)}</span>` : ''}
                </button>
            </article>
        `;
    };

    const renderGrid = () => {
        const visible = activeTag ? styles.filter((style) => style.tags.includes(activeTag)) : styles;
        bodyEl.innerHTML = `
            <div class="iig-style-grid">
                ${makeCard(null, !activeStyle, true)}
                ${visible.map((style) => makeCard(style, activeStyle?.value === style.prompt)).join('')}
            </div>
        `;

        bodyEl.querySelectorAll('.iig-site-style-body').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const prompt = button.getAttribute('data-style-prompt')
                    ? decodeURIComponent(button.getAttribute('data-style-prompt'))
                    : '';
                const name = button.getAttribute('data-style-name')
                    ? decodeURIComponent(button.getAttribute('data-style-name'))
                    : '';
                activateSiteStyle(name, prompt);
                setTimeout(() => closeOverlay(), 0);
            });
        });
    };

    const showStyles = (nextStyles) => {
        styles = nextStyles;
        renderFilters();
        renderGrid();
    };

    const cached = readSiteStyleCache();
    const cacheAge = cached ? Date.now() - (cached.ts || 0) : Infinity;
    if (cached?.styles?.length) {
        showStyles(cached.styles);
        fetchSiteStyles(cached, cacheAge > IIG_STYLE_CACHE_TTL_MS)
            .then((result) => {
                if (overlay.isConnected && !result.notModified) showStyles(result.styles);
            })
            .catch((error) => iigLog('WARN', `Style background refresh failed: ${error.message || error}`));
    } else {
        try {
            const result = await fetchSiteStyles(null, true);
            showStyles(result.styles);
        } catch (error) {
            bodyEl.innerHTML = `<p class="hint" style="padding: 16px;">${t`Failed to load styles`}: ${sanitizeForHtml(error.message || error)}</p>`;
        }
    }

    overlay.querySelector('.iig-style-refresh')?.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const button = event.currentTarget;
        if (!(button instanceof HTMLElement) || button.classList.contains('is-loading')) return;
        button.classList.add('is-loading');
        const icon = button.querySelector('i');
        const originalClass = icon?.className || '';
        if (icon) icon.className = 'fa-solid fa-spinner iig-spin-anim';
        try {
            const result = await fetchSiteStyles(null, true);
            showStyles(result.styles);
            toastr.success(t`Styles refreshed`, t`Image Generation`, { timeOut: 2000 });
        } catch (error) {
            toastr.error(t`Failed to refresh styles: ${error.message || error}`, t`Image Generation`);
        } finally {
            if (icon) icon.className = originalClass;
            button.classList.remove('is-loading');
        }
    });
}

// ----- References section -----

/**
 * Общая разметка одной "avatar references" подсекции.
 * Раньше в buildReferencesSettingsSectionHtml был дубликат этого блока
 * для Gemini и для Naistera. Теперь — одна фабрика.
 */
function buildAvatarReferencesBlockHtml({
    sectionId,
    hiddenClass,
    hidden,
    title,
    sendCharCheckboxId,
    sendCharEnabled,
    sendUserCheckboxId,
    sendUserEnabled,
    useActivePersonaRowId,
    useActivePersonaCheckboxId,
    useActivePersonaRowHidden,
    useActivePersonaHiddenClass,
    useActivePersonaEnabled,
    userAvatarRowId,
    userAvatarRowHidden,
    userAvatarRowHiddenClass,
    userAvatarDropdownHtml,
    refreshButtonId,
}) {
    return `
        <div id="${sectionId}" class="iig-settings-card-nested ${hidden ? hiddenClass : ''}">
            <h4>${title}</h4>
            <label class="checkbox_label">
                <input type="checkbox" id="${sendCharCheckboxId}" ${sendCharEnabled ? 'checked' : ''}>
                <span>${t`Send {{char}} avatar`}</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="${sendUserCheckboxId}" ${sendUserEnabled ? 'checked' : ''}>
                <span>${t`Send {{user}} avatar`}</span>
            </label>
            <label id="${useActivePersonaRowId}" class="checkbox_label ${useActivePersonaRowHidden ? useActivePersonaHiddenClass : ''}">
                <input type="checkbox" id="${useActivePersonaCheckboxId}" ${useActivePersonaEnabled ? 'checked' : ''}>
                <span>${t`Use avatar from active {{user}} persona`}</span>
            </label>
            <div id="${userAvatarRowId}" class="flex-row ${userAvatarRowHidden ? userAvatarRowHiddenClass : ''}">
                <label>${t`{{user}} avatar`}</label>
                ${userAvatarDropdownHtml}
                <div id="${refreshButtonId}" class="menu_button iig-refresh-btn" title="${t`Refresh list`}">
                    <i class="fa-solid fa-sync"></i>
                </div>
            </div>
        </div>
    `;
}

function buildLorebookBarHtml(settings = getSettings()) {
    const lorebooks = ensureLorebooks(settings);
    const activeId = settings.activeLorebookId;
    const active = getActiveLorebook(settings);
    const optionsHtml = lorebooks.map((lb) =>
        `<option value="${sanitizeForHtml(lb.id)}" ${lb.id === activeId ? 'selected' : ''}>${sanitizeForHtml(lb.name)}${lb.enabled === false ? ' ' + t`(off)` : ''}</option>`,
    ).join('');
    return `
        <div class="iig-lorebook-bar">
            <div class="flex-row">
                <label for="iig_lorebook_select">${t`Lorebook`}</label>
                <select id="iig_lorebook_select" class="flex1">
                    ${optionsHtml}
                </select>
                <div class="iig-lorebook-buttons">
                    <label class="checkbox_label" title="${t`Include this lorebook in matching`}">
                        <input type="checkbox" id="iig_lorebook_enabled" ${active?.enabled !== false ? 'checked' : ''}>
                        <span>${t`On`}</span>
                    </label>
                    <div id="iig_lorebook_add" class="menu_button" title="${t`Create new lorebook`}">
                        <i class="fa-solid fa-plus"></i>
                    </div>
                    <div id="iig_lorebook_rename" class="menu_button" title="${t`Rename lorebook`}">
                        <i class="fa-solid fa-pen"></i>
                    </div>
                    <div id="iig_lorebook_import_url" class="menu_button" title="${t`Import lorebook from URL`}">
                        <i class="fa-solid fa-link"></i>
                    </div>
                    <label class="menu_button iig-lorebook-import-file" title="${t`Import lorebook from local file`}">
                        <i class="fa-solid fa-file-arrow-down"></i>
                        <input type="file" accept="application/json,.json" id="iig_lorebook_import_file_input" style="display:none">
                    </label>
                    <div id="iig_lorebook_export" class="menu_button" title="${t`Export current lorebook as JSON`}">
                        <i class="fa-solid fa-file-arrow-up"></i>
                    </div>
                    <div id="iig_lorebook_remove" class="menu_button" title="${t`Delete lorebook`}">
                        <i class="fa-solid fa-trash"></i>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function buildReferencesSettingsSectionHtml(settings = getSettings()) {
    const provider = resolveActiveProvider(settings);
    const refsSupported = provider ? provider.supportsReferences(settings) : false;
    const isGemini = settings.apiType === 'gemini';
    const isOpenAI = settings.apiType === 'openai';
    const isOpenRouter = settings.apiType === 'openrouter';
    const isElectronHub = settings.apiType === 'electronhub';
    const isVoid = settings.apiType === 'void';
    const commonAvatarRefsVisible = (isGemini || isOpenAI || isOpenRouter || isElectronHub || isVoid) && refsSupported;
    const naisteraRefsVisible = settings.apiType === 'naistera' && refsSupported;

    // Заголовок секции аватаров — по активному провайдеру. Provider-brand
    // имена не локализуются.
    let avatarRefsTitle;
    if (isOpenRouter) avatarRefsTitle = 'OpenRouter';
    else if (isElectronHub) avatarRefsTitle = 'Electron Hub';
    else if (isVoid) avatarRefsTitle = 'VoidAI / RouteMyAI';
    else if (isOpenAI) avatarRefsTitle = 'OpenAI / GPT Image';
    else avatarRefsTitle = 'Gemini / nano-banana';

    const geminiAvatarsBlock = buildAvatarReferencesBlockHtml({
        sectionId: 'iig_avatar_refs_section',
        hiddenClass: 'iig-hidden',
        hidden: !commonAvatarRefsVisible,
        title: avatarRefsTitle,
        sendCharCheckboxId: 'iig_send_char_avatar',
        sendCharEnabled: settings.sendCharAvatar,
        sendUserCheckboxId: 'iig_send_user_avatar',
        sendUserEnabled: settings.sendUserAvatar,
        useActivePersonaRowId: 'iig_use_active_persona_avatar_row',
        useActivePersonaCheckboxId: 'iig_use_active_persona_avatar',
        useActivePersonaRowHidden: !settings.sendUserAvatar,
        useActivePersonaHiddenClass: 'iig-hidden',
        useActivePersonaEnabled: settings.useActiveUserPersonaAvatar,
        userAvatarRowId: 'iig_user_avatar_row',
        userAvatarRowHidden: !settings.sendUserAvatar || settings.useActiveUserPersonaAvatar,
        userAvatarRowHiddenClass: 'iig-hidden',
        userAvatarDropdownHtml: buildUserAvatarDropdownControl('iig_user_avatar', settings.userAvatarFile),
        refreshButtonId: 'iig_refresh_avatars',
    });

    const naisteraAvatarsBlock = buildAvatarReferencesBlockHtml({
        sectionId: 'iig_naistera_refs_section',
        hiddenClass: 'iig-hidden',
        hidden: !naisteraRefsVisible,
        title: 'Naistera',
        sendCharCheckboxId: 'iig_naistera_send_char_avatar',
        sendCharEnabled: settings.naisteraSendCharAvatar,
        sendUserCheckboxId: 'iig_naistera_send_user_avatar',
        sendUserEnabled: settings.naisteraSendUserAvatar,
        useActivePersonaRowId: 'iig_naistera_use_active_persona_avatar_row',
        useActivePersonaCheckboxId: 'iig_naistera_use_active_persona_avatar',
        useActivePersonaRowHidden: !settings.naisteraSendUserAvatar,
        useActivePersonaHiddenClass: 'iig-hidden',
        useActivePersonaEnabled: settings.useActiveUserPersonaAvatar,
        userAvatarRowId: 'iig_naistera_user_avatar_row',
        userAvatarRowHidden: !settings.naisteraSendUserAvatar || settings.useActiveUserPersonaAvatar,
        userAvatarRowHiddenClass: 'iig-hidden',
        userAvatarDropdownHtml: buildUserAvatarDropdownControl('iig_naistera_user_avatar', settings.userAvatarFile),
        refreshButtonId: 'iig_naistera_refresh_avatars',
    });

    const refsSectionVisible = refsSupported;

    // ---- Tabs: Avatars / Wardrobe / NPC / Lorebook / Instruction ----
    // Avatars-таб включает: avatar refs (char/user) + кастомную Avatar Library
    // + Image Context. Wardrobe и NPC — отдельными вкладками. Lorebook —
    // существующие additional refs. Instruction — постоянный footer-блок.

    const avatarsTabHtml = `
        ${geminiAvatarsBlock}
        ${naisteraAvatarsBlock}

        <div class="iig-settings-card-nested" id="iig_avatar_library_block">
            <h4>${t`Custom avatar library`}</h4>
            <p class="hint">${t`Active item replaces the default avatar (from character card / user persona) wherever a reference is sent. Add an appearance description (manually or via Vision AI) to also inject it into prompts.`}</p>

            <div class="iig-wardrobe-inject-row">
                <label class="checkbox_label" title="${t`Appends "[Name looks like: ...]" blocks to every image generation prompt`}">
                    <input type="checkbox" id="iig_inject_avatar_appearance_gen" ${settings.injectAvatarAppearanceToGeneration ? 'checked' : ''}>
                    <span>${t`Inject appearance into image generation prompt`}</span>
                </label>
            </div>
            <div class="iig-wardrobe-inject-row">
                <label class="checkbox_label" title="${t`Injects "[Name looks like: ...]" into the LLM chat context via setExtensionPrompt`}">
                    <input type="checkbox" id="iig_inject_avatar_appearance_chat" ${settings.injectAvatarAppearanceToChatEnabled ? 'checked' : ''}>
                    <span>${t`Inject appearance into LLM chat context`}</span>
                </label>
                <div class="iig-wardrobe-inject-depth">
                    <label for="iig_avatar_appearance_depth">${t`Depth`}</label>
                    <input type="number" id="iig_avatar_appearance_depth" class="text_pole" value="${Number.isFinite(settings.avatarAppearanceInjectionDepth) ? settings.avatarAppearanceInjectionDepth : 1}" min="0" max="10">
                </div>
            </div>

            <div class="iig-extras-subhead">
                <span>${t`Character avatars`}</span>
            </div>
            <div id="iig_avatar_lib_char" class="iig-extras-grid"></div>
            <div id="iig_avatar_desc_char"></div>
            <div class="iig-extras-add-row">
                <input type="text" id="iig_avatar_lib_char_name" class="text_pole flex1" placeholder="${t`Avatar name (optional)`}">
                <input type="file" id="iig_avatar_lib_char_file" accept="image/*" style="display:none">
                <div id="iig_avatar_lib_char_add" class="menu_button" title="${t`Add avatar`}">
                    <i class="fa-solid fa-plus"></i> ${t`Add`}
                </div>
            </div>

            <div class="iig-extras-subhead">
                <span>${t`User avatars`}</span>
            </div>
            <div id="iig_avatar_lib_user" class="iig-extras-grid"></div>
            <div id="iig_avatar_desc_user"></div>
            <div class="iig-extras-add-row">
                <input type="text" id="iig_avatar_lib_user_name" class="text_pole flex1" placeholder="${t`Avatar name (optional)`}">
                <input type="file" id="iig_avatar_lib_user_file" accept="image/*" style="display:none">
                <div id="iig_avatar_lib_user_add" class="menu_button" title="${t`Add avatar`}">
                    <i class="fa-solid fa-plus"></i> ${t`Add`}
                </div>
            </div>
        </div>

        <div class="iig-settings-card-nested ${refsSectionVisible ? '' : 'iig-hidden'}" id="iig_image_context_section">
            <h4>${t`Image context`}</h4>
            <label class="checkbox_label">
                <input type="checkbox" id="iig_image_context_enabled" ${settings.imageContextEnabled ? 'checked' : ''}>
                <span>${t`Enable image context`}</span>
            </label>
            <div class="iig-video-frequency-row ${settings.imageContextEnabled ? '' : 'iig-hidden'}" id="iig_image_context_count_row">
                <div class="iig-video-frequency-input">
                    <span>${t`Use`}</span>
                    <input type="number" id="iig_image_context_count" class="text_pole" min="1" max="${MAX_CONTEXT_IMAGES}" step="1" value="${normalizeImageContextCount(settings.imageContextCount)}">
                    <span>${t`previous images.`}</span>
                </div>
            </div>
        </div>
    `;

    const wardrobeTabHtml = `
        <div class="iig-settings-card-nested">
            <h4>${t`Wardrobe (clothing)`}</h4>
            <p class="hint">${t`Manage outfits with categories, tags, and per-character slots. Click the button below to open the wardrobe modal.`}</p>

            <div id="iig_open_wardrobe_modal" class="menu_button iig-button-inline" style="width: 100%; margin-bottom: 12px;">
                <i class="fa-solid fa-shirt"></i> ${t`Open Wardrobe`}
            </div>

            <div class="iig-wardrobe-inject-row">
                <label class="checkbox_label">
                    <input type="checkbox" id="iig_inject_wardrobe" ${settings.injectWardrobeToChat !== false ? 'checked' : ''}>
                    <span>${t`Inject outfit description into LLM prompt`}</span>
                </label>
                <div class="iig-wardrobe-inject-depth">
                    <label for="iig_wardrobe_injection_depth">${t`Depth`}</label>
                    <input type="number" id="iig_wardrobe_injection_depth" class="text_pole" value="${Number.isFinite(settings.wardrobeInjectionDepth) ? settings.wardrobeInjectionDepth : 1}" min="0" max="10">
                </div>
            </div>

            <label class="checkbox_label" title="${t`Shows a wardrobe button in the input bar for quick access.`}">
                <input type="checkbox" id="iig_show_floating_wardrobe" ${settings.showFloatingWardrobeBtn ? 'checked' : ''}>
                <span>${t`Show wardrobe button in input bar`}</span>
            </label>
        </div>
    `;

    const npcTabHtml = `
        <div class="iig-settings-card-nested">
            <h4>${t`NPC / Extra characters`}</h4>
            <p class="hint">${t`When an NPC name (or alias) appears in the prompt, the avatar is added as a reference and the appearance text is added as a hint.`}</p>

            <label class="checkbox_label">
                <input type="checkbox" id="iig_auto_detect_names" ${settings.autoDetectNames !== false ? 'checked' : ''}>
                <span>${t`Auto-detect names in prompt`}</span>
            </label>

            <div id="iig_npc_list"></div>
            <div id="iig_add_npc" class="menu_button iig-button-inline" style="width: 100%; margin-top: 8px;">
                <i class="fa-solid fa-plus"></i> ${t`Add NPC`}
            </div>
        </div>
    `;

    const lorebookTabHtml = `
        <div class="iig-settings-card-nested ${refsSectionVisible ? '' : 'iig-hidden'}" id="iig_additional_refs_section">
            <h4>${t`Additional references (lorebook)`}</h4>

            ${buildLorebookBarHtml(settings)}

            <div class="iig-additional-ref-actions">
                <div id="iig_additional_refs_add" class="menu_button iig-button-inline">
                    <i class="fa-solid fa-plus"></i> ${t`Add reference`}
                </div>
                <div id="iig_additional_refs_import" class="menu_button iig-button-inline">
                    <i class="fa-solid fa-link"></i> ${t`Import reference`}
                </div>
            </div>
            <div id="iig_additional_refs_status" class="hint" style="margin-bottom: 8px;"></div>
            <div id="iig_additional_refs_list"></div>
        </div>
    `;

    const instructionFooterHtml = `
        <div class="iig-settings-card-nested ${refsSectionVisible ? '' : 'iig-hidden'}" id="iig_ref_instruction_section">
            <h4>${t`Reference instruction`}</h4>
            <p class="hint">${t`Prepended to the prompt whenever at least one reference image is sent to the provider. Helps the model copy appearance from refs.`}</p>
            <label class="checkbox_label">
                <input type="checkbox" id="iig_ref_instruction_enabled" ${settings.refInstructionEnabled !== false ? 'checked' : ''}>
                <span>${t`Send reference instruction`}</span>
            </label>
            <textarea
                id="iig_ref_instruction"
                class="text_pole flex1 iig-settings-textarea"
                rows="4"
                placeholder="${sanitizeForHtml(DEFAULT_REF_INSTRUCTION)}"
                ${settings.refInstructionEnabled === false ? 'disabled' : ''}
            >${sanitizeForHtml(settings.refInstruction ?? DEFAULT_REF_INSTRUCTION)}</textarea>
            <div class="iig-debug-actions">
                <div id="iig_ref_instruction_reset" class="menu_button iig-button-inline" title="${t`Restore default text`}">
                    <i class="fa-solid fa-rotate-left"></i> ${t`Reset to default`}
                </div>
            </div>
        </div>
    `;

    const tabsBarHtml = `
        <div class="iig-tabs" role="tablist">
            <div class="iig-tab iig-tab-active" data-iig-tab="avatars" role="tab">
                <i class="fa-solid fa-user"></i> ${t`Avatars`}
            </div>
            <div class="iig-tab" data-iig-tab="wardrobe" role="tab">
                <i class="fa-solid fa-shirt"></i> ${t`Wardrobe`}
            </div>
            <div class="iig-tab" data-iig-tab="npc" role="tab">
                <i class="fa-solid fa-people-group"></i> ${t`NPC`}
            </div>
            <div class="iig-tab" data-iig-tab="lorebook" role="tab">
                <i class="fa-solid fa-book"></i> ${t`Lorebook`}
            </div>
        </div>
    `;

    const bodyHtml = `
        <div class="iig-settings-card">
            ${tabsBarHtml}
            <div class="iig-tab-panels">
                <div class="iig-tab-panel iig-tab-panel-active" data-iig-tab-panel="avatars">${avatarsTabHtml}</div>
                <div class="iig-tab-panel" data-iig-tab-panel="wardrobe">${wardrobeTabHtml}</div>
                <div class="iig-tab-panel" data-iig-tab-panel="npc">${npcTabHtml}</div>
                <div class="iig-tab-panel" data-iig-tab-panel="lorebook">${lorebookTabHtml}</div>
            </div>
            ${instructionFooterHtml}
        </div>
    `;
    return buildSettingsSectionHtml('iig_references_section', t`References`, bodyHtml, true);
}

// Old NovelAI presets section removed — handled by createPresetSectionUI factory (novelaiPresetSection)

// ----- Debug section -----

function buildDebugSettingsSectionHtml(settings = getSettings()) {
    const bodyHtml = `
        <div class="iig-settings-card">
            <div class="iig-settings-card-nested">
                <div class="flex-row">
                    <label for="iig_max_retries">${t`Max retries`}</label>
                    <input type="number" id="iig_max_retries" class="text_pole flex1" value="${settings.maxRetries}" min="0" max="5">
                    <div></div>
                </div>
                <div class="flex-row">
                    <label for="iig_retry_delay">${t`Retry delay (ms)`}</label>
                    <input type="number" id="iig_retry_delay" class="text_pole flex1" value="${settings.retryDelay}" min="500" max="10000" step="500">
                    <div></div>
                </div>
            </div>
            <div class="iig-debug-actions">
                <div id="iig_export_logs" class="menu_button iig-button-inline">
                    <i class="fa-solid fa-download"></i> ${t`Export logs`}
                </div>
                <div id="iig_show_last_request" class="menu_button iig-button-inline" title="${t`View prompt and references sent in the most recent generation`}">
                    <i class="fa-solid fa-magnifying-glass"></i> ${t`Show last request`}
                </div>
                <div id="iig_show_book_macro" class="menu_button iig-button-inline" title="${t`Preview the rendered {{iig-book}} macro as the LLM will see it`}">
                    <i class="fa-solid fa-book"></i> ${t`Show {{iig-book}} preview`}
                </div>
            </div>
        </div>
    `;
    return buildSettingsSectionHtml('iig_debug_section', t`Debug`, bodyHtml, false);
}

// ----- Last request popup -----

function formatTimestampLocal(ts) {
    if (!Number.isFinite(ts)) return '';
    try {
        return new Date(ts).toLocaleString();
    } catch (_e) {
        return new Date(ts).toISOString();
    }
}

function formatMatchReason(reason) {
    if (!reason || typeof reason !== 'object') return '';
    switch (reason.kind) {
        case 'always':
            return t`always`;
        case 'primary':
            return t`alias: ${reason.detail || ''}`;
        case 'regex':
            return t`regex: ${reason.detail || ''}`;
        case 'regex-fallback':
            return t`invalid regex, fell back to literal: ${reason.detail || ''}`;
        default:
            return reason.kind || '';
    }
}

function buildMatchedRefsSectionHtml(matched) {
    if (!Array.isArray(matched) || matched.length === 0) {
        return `<p class="hint">${t`No additional references were matched in this request.`}</p>`;
    }
    const rows = matched.map((m) => {
        const primary = String(m.name || '').split(',')[0].trim();
        const metaBits = [];
        if (m.lorebookName) metaBits.push(sanitizeForHtml(m.lorebookName));
        if (m.group) metaBits.push(`[${sanitizeForHtml(m.group)}]`);
        if (Number.isFinite(m.priority) && m.priority !== 0) metaBits.push(`p=${m.priority}`);
        const reasonText = sanitizeForHtml(formatMatchReason(m.reason));
        return `
            <div class="iig-matched-ref-row">
                <span class="iig-matched-ref-name">${sanitizeForHtml(primary || m.name || '')}</span>
                ${metaBits.length > 0 ? `<span class="iig-matched-ref-meta">${metaBits.join(' · ')}</span>` : ''}
                ${reasonText ? `<span class="iig-matched-ref-reason">${reasonText}</span>` : ''}
            </div>
        `;
    });
    return `<div class="iig-matched-refs">${rows.join('')}</div>`;
}

function buildLastRequestPopupHtml(snapshot) {
    const meta = snapshot.metadata || {};
    const rows = [];
    const pushRow = (labelText, value) => {
        if (value === undefined || value === null || value === '') return;
        rows.push(`<div class="iig-last-req-meta-row"><span class="iig-last-req-meta-label">${sanitizeForHtml(labelText)}</span><span class="iig-last-req-meta-value">${sanitizeForHtml(String(value))}</span></div>`);
    };
    pushRow(t`Time`, formatTimestampLocal(snapshot.timestamp));
    pushRow(t`Provider`, meta.provider);
    pushRow(t`API type`, meta.apiType);
    pushRow(t`Model`, meta.model);
    pushRow(t`Aspect ratio`, meta.aspectRatio);
    pushRow(t`Resolution`, meta.imageSize);
    pushRow(t`Size`, meta.size);
    pushRow(t`Quality`, meta.quality);
    pushRow(t`Reference instruction applied`, meta.refInstructionApplied ? t`yes` : t`no`);

    const refsHtml = Array.isArray(snapshot.references) && snapshot.references.length > 0
        ? snapshot.references.map((ref) => `
            <div class="iig-last-req-ref">
                <img class="iig-last-req-ref-thumb" src="${sanitizeForHtml(ref.dataUrl)}" alt="${sanitizeForHtml(ref.label || '')}">
                <span class="iig-last-req-ref-label">${sanitizeForHtml(ref.label || '')}</span>
            </div>`).join('')
        : `<p class="hint">${t`No references were sent.`}</p>`;

    const matchedCount = Array.isArray(snapshot.matchedRefs) ? snapshot.matchedRefs.length : 0;

    return `
        <div class="iig-last-req">
            <div class="iig-last-req-meta">${rows.join('')}</div>
            <h4>${t`Matched references`} (${matchedCount})</h4>
            ${buildMatchedRefsSectionHtml(snapshot.matchedRefs || [])}
            <h4>${t`Final prompt sent to provider`}</h4>
            <pre class="iig-last-req-prompt">${sanitizeForHtml(snapshot.prompt || '')}</pre>
            <h4>${t`References`} (${Array.isArray(snapshot.references) ? snapshot.references.length : 0})</h4>
            <div class="iig-last-req-refs">${refsHtml}</div>
        </div>
    `;
}

async function showLastRequestPopup() {
    const snapshot = getLastRequestSnapshot();
    if (!snapshot) {
        toastr.info(t`No request recorded yet. Generate an image first.`, t`Image Generation`);
        return;
    }
    const html = buildLastRequestPopupHtml(snapshot);
    await Popup.show.text(t`Last generation request`, html, { allowVerticalScrolling: true, wide: true });
}

// ----- {{iig-book}} macro preview popup -----

async function showIigBookPreviewPopup() {
    const rendered = renderIigBookMacro();
    const hintHtml = `<p class="hint">${t`Paste {{iig-book}} into a character card or preset to inject this text into the LLM's context. Only enabled lorebooks with active references are included.`}</p>`;
    const bodyHtml = rendered
        ? `${hintHtml}<pre class="iig-last-req-prompt">${sanitizeForHtml(rendered)}</pre>`
        : `${hintHtml}<p class="hint">${t`The macro is currently empty: no enabled lorebook has any references with a name.`}</p>`;
    await Popup.show.text(t`{{iig-book}} preview`, bodyHtml, { allowVerticalScrolling: true, wide: true });
}

// ----- Section toggles -----

function bindSectionToggles() {
    document.querySelectorAll('[data-section-toggle]').forEach((toggle) => {
        toggle.addEventListener('click', () => {
            const sectionId = toggle.getAttribute('data-section-toggle');
            const body = sectionId ? document.getElementById(sectionId) : null;
            const chevron = toggle.querySelector('.iig-section-chevron');
            if (!body) {
                return;
            }

            body.classList.toggle('iig-hidden');
            chevron?.classList.toggle('iig-section-chevron-collapsed', body.classList.contains('iig-hidden'));
        });
    });
}

// ----- Connection profiles -----

/**
 * После `loadConnectionProfile` в settings подменены все connection-поля.
 * Эта функция синхронизирует значения в уже отрисованных DOM-элементах
 * (input / select / checkbox), чтобы юзер увидел актуальное состояние
 * без полного re-render'а секции.
 */
function applyProfileValuesToInputs(settings) {
    const setVal = (id, value) => {
        const el = document.getElementById(id);
        if (el && 'value' in el) el.value = value ?? '';
    };
    const setChk = (id, value) => {
        const el = document.getElementById(id);
        if (el && 'checked' in el) el.checked = Boolean(value);
    };

    setVal('iig_api_type', settings.apiType);
    setVal('iig_endpoint', settings.endpoint);
    setChk('iig_raw_endpoint', settings.rawEndpoint);
    setVal('iig_api_key', settings.apiKey);
    setVal('iig_model', settings.model);
    // Select holds model too — add option on-the-fly if profile's model isn't
    // in the currently loaded list.
    const modelSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('iig_model_select'));
    if (modelSelect) {
        const hasOption = Array.from(modelSelect.options).some((o) => o.value === settings.model);
        if (!hasOption && settings.model) {
            const opt = document.createElement('option');
            opt.value = settings.model;
            opt.textContent = settings.model;
            modelSelect.appendChild(opt);
        }
        modelSelect.value = settings.model || '';
    }
    setVal('iig_size', settings.size);
    setVal('iig_quality', settings.quality);
    setVal('iig_aspect_ratio', settings.aspectRatio);
    setVal('iig_image_size', settings.imageSize);
    // Override lock buttons
    const arBtn = document.getElementById('iig_override_aspect_ratio_btn');
    if (arBtn) {
        arBtn.classList.toggle('iig-override-active', settings.overrideAspectRatio);
        const arIcon = arBtn.querySelector('i');
        if (arIcon) arIcon.className = `fa-solid fa-lock${settings.overrideAspectRatio ? '' : '-open'}`;
    }
    const isBtn = document.getElementById('iig_override_image_size_btn');
    if (isBtn) {
        isBtn.classList.toggle('iig-override-active', settings.overrideImageSize);
        const isIcon = isBtn.querySelector('i');
        if (isIcon) isIcon.className = `fa-solid fa-lock${settings.overrideImageSize ? '' : '-open'}`;
    }
    setVal('iig_naistera_model', normalizeNaisteraModel(settings.naisteraModel));
    setVal('iig_naistera_aspect_ratio', settings.naisteraAspectRatio);
    setChk('iig_naistera_video_test', settings.naisteraVideoTest);
    setVal('iig_naistera_video_every_n', settings.naisteraVideoEveryN);
    // NovelAI fields
    setVal('iig_novelai_model', settings.novelaiModel);
    setVal('iig_novelai_sampler', settings.novelaiSampler);
    setVal('iig_novelai_scheduler', settings.novelaiScheduler);
    setVal('iig_novelai_steps', settings.novelaiSteps);
    setVal('iig_novelai_scale', settings.novelaiScale);
    setVal('iig_novelai_size', settings.novelaiSize);
    setVal('iig_novelai_negative_prompt', settings.novelaiNegativePrompt);
    setChk('iig_novelai_anlas_guard', settings.novelaiAnlasGuard);
    setChk('iig_novelai_decrisper', settings.novelaiDecrisper);
    setChk('iig_novelai_variety_boost', settings.novelaiVarietyBoost);
    setChk('iig_novelai_sm', settings.novelaiSm);
    setChk('iig_novelai_sm_dyn', settings.novelaiSmDyn);

    // Re-render presets list (it's data-driven, not simple value sync).
    novelaiPresetSection.render();

    setChk('iig_send_char_avatar', settings.sendCharAvatar);
    setChk('iig_send_user_avatar', settings.sendUserAvatar);
    setChk('iig_use_active_persona_avatar', settings.useActiveUserPersonaAvatar);
    setChk('iig_naistera_send_char_avatar', settings.naisteraSendCharAvatar);
    setChk('iig_naistera_send_user_avatar', settings.naisteraSendUserAvatar);
    setChk('iig_naistera_use_active_persona_avatar', settings.useActiveUserPersonaAvatar);

    // Пересинхронизация avatar-дропдаунов (custom-элемент, не <select>).
    syncUserAvatarSelection(settings.userAvatarFile);
    syncActivePersonaAvatarMode(settings.useActiveUserPersonaAvatar);
}

function refreshProfileSelectOptions(settings) {
    const select = document.getElementById('iig_profile_select');
    if (!(select instanceof HTMLSelectElement)) return;
    const profiles = ensureConnectionProfiles(settings);
    select.innerHTML = profiles.map((p) =>
        `<option value="${p.id}" ${p.id === settings.activeConnectionProfileId ? 'selected' : ''}>${sanitizeForHtml(p.name)}</option>`,
    ).join('') || `<option value="">${t`(no profiles)`}</option>`;
}

function bindConnectionProfilesEvents(settings, updateVisibility) {
    document.getElementById('iig_profile_select')?.addEventListener('change', (e) => {
        const id = e.target instanceof HTMLSelectElement ? e.target.value : '';
        if (!id) return;
        const profile = loadConnectionProfile(id, settings);
        if (!profile) return;
        saveSettings();
        applyProfileValuesToInputs(settings);
        updateVisibility();
        iigLog('INFO', `Loaded connection profile: ${profile.name} (${profile.apiType})`);
    });

    document.getElementById('iig_profile_save')?.addEventListener('click', () => {
        const profile = saveCurrentIntoProfile(null, settings);
        if (!profile) {
            toastr.warning(t`No active profile`, t`Image Generation`);
            return;
        }
        saveSettings();
        toastr.success(t`Profile "${profile.name}" saved`, t`Image Generation`, { timeOut: 1500 });
    });

    document.getElementById('iig_profile_save_as')?.addEventListener('click', async () => {
        const name = await Popup.show.input(t`New profile`, t`Enter a name for the new profile:`);
        if (!name) return;
        const profile = createConnectionProfile(name, settings);
        saveSettings();
        refreshProfileSelectOptions(settings);
        toastr.success(t`Created profile "${profile.name}"`, t`Image Generation`, { timeOut: 1500 });
    });

    document.getElementById('iig_profile_rename')?.addEventListener('click', async () => {
        const profile = getActiveConnectionProfile(settings);
        if (!profile) {
            toastr.warning(t`No active profile`, t`Image Generation`);
            return;
        }
        const newName = await Popup.show.input(t`Rename profile`, t`Enter a new name:`, profile.name);
        if (!newName) return;
        renameConnectionProfile(profile.id, newName, settings);
        saveSettings();
        refreshProfileSelectOptions(settings);
    });

    document.getElementById('iig_profile_remove')?.addEventListener('click', async () => {
        const profile = getActiveConnectionProfile(settings);
        if (!profile) return;
        const confirmed = await Popup.show.confirm(t`Delete profile`, t`Delete profile "${profile.name}"? This cannot be undone.`);
        if (!confirmed) return;
        const ok = removeConnectionProfile(profile.id, settings);
        if (!ok) {
            toastr.warning(t`Cannot delete the last profile`, t`Image Generation`);
            return;
        }
        // Загружаем новый активный в settings чтобы синхронизировать DOM.
        if (settings.activeConnectionProfileId) {
            loadConnectionProfile(settings.activeConnectionProfileId, settings);
        }
        saveSettings();
        refreshProfileSelectOptions(settings);
        applyProfileValuesToInputs(settings);
        updateVisibility();
    });
}

// ----- API section events -----

function bindApiSectionEvents(settings, updateVisibility) {
    document.getElementById('iig_enabled')?.addEventListener('change', (e) => {
        settings.enabled = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_external_blocks')?.addEventListener('change', (e) => {
        settings.externalBlocks = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_image_context_enabled')?.addEventListener('change', (e) => {
        settings.imageContextEnabled = e.target.checked;
        saveSettings();
        updateVisibility();
    });

    document.getElementById('iig_image_context_count')?.addEventListener('input', (e) => {
        const normalized = normalizeImageContextCount(e.target.value);
        settings.imageContextCount = normalized;
        e.target.value = String(normalized);
        saveSettings();
    });

    document.getElementById('iig_api_type')?.addEventListener('change', (e) => {
        const nextApiType = e.target.value;
        const endpointInput = document.getElementById('iig_endpoint');
        if (shouldReplaceEndpointForApiType(nextApiType, settings.endpoint)) {
            settings.endpoint = normalizeConfiguredEndpoint(nextApiType, '');
            if (endpointInput) {
                endpointInput.value = settings.endpoint;
            }
        } else if (nextApiType === 'naistera') {
            settings.endpoint = normalizeConfiguredEndpoint(nextApiType, settings.endpoint);
            if (endpointInput) {
                endpointInput.value = settings.endpoint;
            }
        }
        settings.apiType = nextApiType;
        saveSettings();
        updateVisibility();

        // Switching providers → модель из прошлого провайдера скорее всего
        // невалидна. Подтягиваем список нового провайдера, если это не raw
        // и не Naistera (там свой селектор).
        if (!settings.rawEndpoint && nextApiType !== 'naistera' && nextApiType !== 'novelai') {
            reloadModelList({ announce: false }).catch(() => { /* silent */ });
        }
    });

    document.getElementById('iig_endpoint')?.addEventListener('input', (e) => {
        settings.endpoint = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_api_key')?.addEventListener('input', (e) => {
        settings.apiKey = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_key_toggle')?.addEventListener('click', () => {
        const input = document.getElementById('iig_api_key');
        const icon = document.querySelector('#iig_key_toggle i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    });

    // Две формы ввода модели: <select> для обычного режима (с fetchModels)
    // и <input> для raw-режима (свободный ввод). Видимость переключается
    // по rawEndpoint. Оба держим синхронно, чтобы юзер не терял значение
    // при переключении.
    const syncModelInputs = (value) => {
        const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('iig_model_select'));
        const input = /** @type {HTMLInputElement|null} */ (document.getElementById('iig_model'));
        if (input && input.value !== value) input.value = value ?? '';
        if (select) {
            const hasOption = Array.from(select.options).some((o) => o.value === value);
            if (!hasOption && value) {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = `${value} ${t`(custom)`}`;
                select.appendChild(opt);
            }
            if (select.value !== value) select.value = value ?? '';
        }
    };

    const modelApplyChange = (value) => {
        settings.model = value;
        saveSettings();
        syncModelInputs(value);

        // Auto-switch API type на 'gemini' применим только если сейчас
        // выбран OpenAI (legacy — когда юзер через OpenAI endpoint выбрал
        // nano-banana). Для openrouter/gemini/naistera не трогаем.
        if (settings.apiType === 'openai' && isGeminiModel(value)) {
            document.getElementById('iig_api_type').value = 'gemini';
            settings.apiType = 'gemini';
        }

        // Модель влияет на поддержку референсов (gpt-image-* vs dall-e-*),
        // поэтому перестраиваем видимость секций при любой смене.
        updateVisibility();
    };
    document.getElementById('iig_model_select')?.addEventListener('change', (e) => {
        if (e.target instanceof HTMLSelectElement) modelApplyChange(e.target.value);
    });
    document.getElementById('iig_model')?.addEventListener('change', (e) => {
        if (e.target instanceof HTMLInputElement) modelApplyChange(e.target.value);
    });
    document.getElementById('iig_model')?.addEventListener('input', (e) => {
        if (e.target instanceof HTMLInputElement) modelApplyChange(e.target.value);
    });

    /**
     * Populates the model <select> from provider.fetchModels. Preserves the
     * currently selected value: if settings.model is not in the fetched list,
     * it is appended as a "(custom)" option so the user doesn't lose it.
     * announce=true shows a toastr with model count / error.
     */
    async function reloadModelList({ announce = false } = {}) {
        const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('iig_model_select'));
        const btn = document.getElementById('iig_refresh_models');
        btn?.classList.add('loading');
        try {
            const models = await fetchModels();
            if (select) {
                const current = settings.model || '';
                const inList = current && models.includes(current);
                const optionsHtml = [
                    ...models.map((m) => `<option value="${sanitizeForHtml(m)}" ${m === current ? 'selected' : ''}>${sanitizeForHtml(m)}</option>`),
                    ...(!inList && current ? [`<option value="${sanitizeForHtml(current)}" selected>${sanitizeForHtml(current)} ${t`(custom)`}</option>`] : []),
                    ...(models.length === 0 && !current ? [`<option value="" selected disabled>${t`-- Select a model --`}</option>`] : []),
                ];
                select.innerHTML = optionsHtml.join('');
            }
            if (announce && models.length > 0) {
                toastr.success(t`Models found: ${models.length}`, t`Image Generation`);
            } else if (announce && models.length === 0) {
                toastr.warning(t`No models returned by endpoint`, t`Image Generation`);
            }
            return models;
        } catch (error) {
            if (announce) {
                toastr.error(t`Failed to load models`, t`Image Generation`);
            }
            return [];
        } finally {
            btn?.classList.remove('loading');
        }
    }

    document.getElementById('iig_refresh_models')?.addEventListener('click', () => {
        reloadModelList({ announce: true });
    });

    document.getElementById('iig_raw_endpoint')?.addEventListener('change', (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        settings.rawEndpoint = e.target.checked;
        saveSettings();

        const select = document.getElementById('iig_model_select');
        if (settings.rawEndpoint) {
            select?.classList.add('iig-hidden');
        } else {
            select?.classList.remove('iig-hidden');
            reloadModelList({ announce: true });
        }
    });

    document.getElementById('iig_size')?.addEventListener('change', (e) => {
        settings.size = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_quality')?.addEventListener('change', (e) => {
        settings.quality = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_aspect_ratio')?.addEventListener('change', (e) => {
        settings.aspectRatio = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_override_aspect_ratio_btn')?.addEventListener('click', () => {
        settings.overrideAspectRatio = !settings.overrideAspectRatio;
        const btn = document.getElementById('iig_override_aspect_ratio_btn');
        btn?.classList.toggle('iig-override-active', settings.overrideAspectRatio);
        const icon = btn?.querySelector('i');
        if (icon) icon.className = `fa-solid fa-lock${settings.overrideAspectRatio ? '' : '-open'}`;
        saveSettings();
    });

    document.getElementById('iig_image_size')?.addEventListener('change', (e) => {
        settings.imageSize = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_override_image_size_btn')?.addEventListener('click', () => {
        settings.overrideImageSize = !settings.overrideImageSize;
        const btn = document.getElementById('iig_override_image_size_btn');
        btn?.classList.toggle('iig-override-active', settings.overrideImageSize);
        const icon = btn?.querySelector('i');
        if (icon) icon.className = `fa-solid fa-lock${settings.overrideImageSize ? '' : '-open'}`;
        saveSettings();
    });

    document.getElementById('iig_naistera_model')?.addEventListener('change', (e) => {
        settings.naisteraModel = normalizeNaisteraModel(e.target.value);
        saveSettings();
        updateVisibility();
    });

    document.getElementById('iig_naistera_aspect_ratio')?.addEventListener('change', (e) => {
        settings.naisteraAspectRatio = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_naistera_video_test')?.addEventListener('change', (e) => {
        settings.naisteraVideoTest = e.target.checked;
        saveSettings();
        updateVisibility();
    });

    document.getElementById('iig_naistera_video_every_n')?.addEventListener('input', (e) => {
        const normalized = normalizeNaisteraVideoFrequency(e.target.value);
        settings.naisteraVideoEveryN = normalized;
        e.target.value = String(normalized);
        saveSettings();
    });

    // ElectronHub specific parameters
    document.getElementById('iig_electronhub_style')?.addEventListener('change', (e) => {
        settings.electronhubStyle = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_electronhub_negative_prompt')?.addEventListener('input', (e) => {
        settings.electronhubNegativePrompt = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_electronhub_guidance_scale')?.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        settings.electronhubGuidanceScale = isNaN(value) ? 7.5 : value;
        saveSettings();
    });

    document.getElementById('iig_electronhub_steps')?.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        settings.electronhubSteps = isNaN(value) ? 50 : value;
        saveSettings();
    });

    document.getElementById('iig_electronhub_enable_references')?.addEventListener('change', (e) => {
        settings.electronhubEnableReferences = e.target.checked;
        saveSettings();
        updateVisibility();
    });

    // NovelAI specific parameters
    document.getElementById('iig_novelai_model')?.addEventListener('change', (e) => {
        settings.novelaiModel = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_novelai_sampler')?.addEventListener('change', (e) => {
        settings.novelaiSampler = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_novelai_scheduler')?.addEventListener('change', (e) => {
        settings.novelaiScheduler = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_novelai_steps')?.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        settings.novelaiSteps = isNaN(value) ? 28 : Math.min(Math.max(value, 1), 50);
        saveSettings();
    });

    document.getElementById('iig_novelai_scale')?.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        settings.novelaiScale = isNaN(value) ? 5 : value;
        saveSettings();
    });

    document.getElementById('iig_novelai_size')?.addEventListener('change', (e) => {
        settings.novelaiSize = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_novelai_negative_prompt')?.addEventListener('input', (e) => {
        settings.novelaiNegativePrompt = e.target.value;
        saveSettings();
    });

    document.getElementById('iig_novelai_anlas_guard')?.addEventListener('change', (e) => {
        settings.novelaiAnlasGuard = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_novelai_decrisper')?.addEventListener('change', (e) => {
        settings.novelaiDecrisper = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_novelai_variety_boost')?.addEventListener('change', (e) => {
        settings.novelaiVarietyBoost = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_novelai_sm')?.addEventListener('change', (e) => {
        settings.novelaiSm = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_novelai_sm_dyn')?.addEventListener('change', (e) => {
        settings.novelaiSmDyn = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_novelai_view_anlas')?.addEventListener('click', async () => {
        const { getRequestHeaders } = SillyTavern.getContext();
        try {
            const result = await fetch('/api/novelai/status', {
                method: 'POST',
                headers: getRequestHeaders(),
            });
            if (!result.ok) {
                toastr.warning(t`Could not load NovelAI subscription data. Is the API key set in SillyTavern settings?`, 'NovelAI');
                return;
            }
            const data = await result.json();
            if (data.error) {
                toastr.warning(t`Could not load NovelAI subscription data. Is the API key set in SillyTavern settings?`, 'NovelAI');
                return;
            }
            const anlas = data?.trainingStepsLeft?.fixedTrainingStepsLeft ?? 0;
            const unlimited = data?.perks?.unlimitedImageGeneration ?? false;
            toastr.info(`${t`Free image generation`}: ${unlimited ? t`Yes` : t`No`}`, `Anlas: ${anlas}`);
        } catch (error) {
            toastr.error(String(error?.message || error), 'NovelAI');
        }
    });

    // Auto-populate model list on init so the <select> isn't empty when the
    // user first opens settings. In raw mode the select is hidden anyway,
    // and for Naistera the whole row is hidden — fetchModels still tolerates
    // those cases and returns [].
    if (!settings.rawEndpoint && settings.apiType !== 'naistera' && settings.apiType !== 'novelai') {
        reloadModelList({ announce: false }).catch(() => { /* silent on init */ });
    }
}

// ----- Avatar section events (общая фабрика для Gemini и Naistera) -----

/**
 * Вешает обработчики на пару аватар-чекбоксов + на refresh.
 * Раньше этот код был продублирован для `iig_*` и `iig_naistera_*`.
 */
function bindAvatarSectionEvents(settings, updateVisibility, config) {
    const {
        sendCharCheckboxId,
        sendCharKey,
        sendUserCheckboxId,
        sendUserKey,
        useActivePersonaCheckboxId,
        userAvatarSelectId,
        refreshButtonId,
        userAvatarDropdownId,
    } = config;

    document.getElementById(sendCharCheckboxId)?.addEventListener('change', (e) => {
        settings[sendCharKey] = e.target.checked;
        saveSettings();
    });

    document.getElementById(sendUserCheckboxId)?.addEventListener('change', (e) => {
        settings[sendUserKey] = e.target.checked;
        saveSettings();
        updateVisibility();
    });

    document.getElementById(useActivePersonaCheckboxId)?.addEventListener('change', (e) => {
        settings.useActiveUserPersonaAvatar = e.target.checked;
        syncActivePersonaAvatarMode(settings.useActiveUserPersonaAvatar);
        saveSettings();
        updateVisibility();
    });

    document.getElementById(userAvatarSelectId)?.addEventListener('change', (e) => {
        settings.userAvatarFile = e.target.value;
        syncUserAvatarSelection(settings.userAvatarFile);
        saveSettings();
    });

    document.getElementById(refreshButtonId)?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.classList.add('loading');

        try {
            const avatars = await refreshUserAvatarSelects();

            toastr.success(t`Avatars found: ${avatars.length}`, t`Image Generation`);
            document.getElementById(userAvatarDropdownId)?.classList.add('open');
        } catch (error) {
            toastr.error(t`Failed to load avatars`, t`Image Generation`);
        } finally {
            btn.classList.remove('loading');
        }
    });
}

function bindAvatarDropdownToggles() {
    for (const { rootId, selectedId, listId } of getUserAvatarDropdownConfigs()) {
        document.getElementById(selectedId)?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById(rootId);
            if (!dropdown) {
                return;
            }

            const willOpen = !dropdown.classList.contains('open');
            closeUserAvatarDropdowns();
            dropdown.classList.toggle('open', willOpen);

            if (willOpen) {
                const list = document.getElementById(listId);
                if (list && list.children.length === 0) {
                    await refreshUserAvatarSelects();
                }
            }
        });
    }

    document.addEventListener('click', (e) => {
        const clickedInsideDropdown = getUserAvatarDropdownConfigs().some(({ rootId }) => {
            const root = document.getElementById(rootId);
            return root?.contains(e.target);
        });
        if (!clickedInsideDropdown) {
            closeUserAvatarDropdowns();
        }
    });
}

// ----- Styles section events -----

// bindStylesSectionEvents removed — handled by createPresetSectionUI factory

// ----- Lorebook bar events -----

function refreshLorebookBar(settings) {
    const bar = document.querySelector('.iig-lorebook-bar');
    if (!bar) return;
    bar.outerHTML = buildLorebookBarHtml(settings);
    // После replace — элемент в DOM заменился, перевешиваем обработчики.
    bindLorebookBarEvents(settings);
}

function bindLorebookBarEvents(settings) {
    document.getElementById('iig_lorebook_select')?.addEventListener('change', (e) => {
        const id = e.target instanceof HTMLSelectElement ? e.target.value : '';
        if (!id) return;
        const lb = setActiveLorebook(id, settings);
        if (!lb) return;
        saveSettings();
        refreshLorebookBar(settings);
        refreshAdditionalReferencesList();
    });

    document.getElementById('iig_lorebook_enabled')?.addEventListener('change', (e) => {
        const active = getActiveLorebook(settings);
        if (!active || !(e.target instanceof HTMLInputElement)) return;
        setLorebookEnabled(active.id, e.target.checked, settings);
        saveSettings();
        refreshLorebookBar(settings);
    });

    document.getElementById('iig_lorebook_add')?.addEventListener('click', async () => {
        const name = await Popup.show.input(t`New lorebook`, t`Enter a name for the new lorebook:`);
        if (!name) return;
        const lb = createLorebook(name, settings);
        saveSettings();
        refreshLorebookBar(settings);
        refreshAdditionalReferencesList();
        toastr.success(t`Lorebook "${lb.name}" created`, t`Image Generation`, { timeOut: 1500 });
    });

    document.getElementById('iig_lorebook_rename')?.addEventListener('click', async () => {
        const active = getActiveLorebook(settings);
        if (!active) return;
        const newName = await Popup.show.input(t`Rename lorebook`, t`Enter a new name:`, active.name);
        if (!newName) return;
        renameLorebook(active.id, newName, settings);
        saveSettings();
        refreshLorebookBar(settings);
    });

    async function afterLorebookImport(stats) {
        refreshLorebookBar(settings);
        refreshAdditionalReferencesList();
        const tail = stats.imagesFailed > 0
            ? ` (${t`${stats.imagesFailed} images failed to download`})`
            : '';
        toastr.success(
            t`Imported ${stats.refsCount} refs, ${stats.imagesDownloaded} images downloaded${tail}`,
            t`Image Generation`,
            { timeOut: 4000 },
        );
    }

    document.getElementById('iig_lorebook_import_url')?.addEventListener('click', async () => {
        const url = await Popup.show.input(
            t`Import lorebook from URL`,
            t`Paste a direct URL to a JSON lorebook file:`,
        );
        if (typeof url !== 'string') return;
        const trimmed = url.trim();
        if (!trimmed) return;
        try {
            const stats = await importLorebookFromUrl(trimmed);
            await afterLorebookImport(stats);
        } catch (error) {
            console.error('[IIG] Lorebook import failed:', error);
            toastr.error(t`Import error: ${error.message || error}`, t`Image Generation`);
        }
    });

    document.getElementById('iig_lorebook_import_file_input')?.addEventListener('change', async (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement)) return;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        try {
            const stats = await importLorebookFromFile(file);
            await afterLorebookImport(stats);
        } catch (error) {
            console.error('[IIG] Lorebook import failed:', error);
            toastr.error(t`Import error: ${error.message || error}`, t`Image Generation`);
        }
    });

    document.getElementById('iig_lorebook_export')?.addEventListener('click', async () => {
        const active = getActiveLorebook(settings);
        if (!active) return;

        // Перед скачиванием показываем предупреждение про картинки.
        const proceed = await Popup.show.confirm(
            t`Export lorebook`,
            t`Images are NOT included in the JSON. To share this lorebook, fill the empty "imageUrl" field of each reference with a direct link to its image. Continue?`,
        );
        if (!proceed) return;

        const payload = buildLorebookExportJson(active);
        const json = JSON.stringify(payload, null, 2);
        const fileName = lorebookFileNameFromTitle(active.name);
        triggerBrowserDownload(fileName, json);
        toastr.success(t`Lorebook "${active.name}" exported`, t`Image Generation`, { timeOut: 2000 });
    });

    document.getElementById('iig_lorebook_remove')?.addEventListener('click', async () => {
        const active = getActiveLorebook(settings);
        if (!active) return;
        const confirmed = await Popup.show.confirm(
            t`Delete lorebook`,
            t`Delete lorebook "${active.name}"? All its references will be lost. This cannot be undone.`,
        );
        if (!confirmed) return;
        const ok = removeLorebook(active.id, settings);
        if (!ok) {
            toastr.warning(t`Cannot delete the last lorebook`, t`Image Generation`);
            return;
        }
        saveSettings();
        refreshLorebookBar(settings);
        refreshAdditionalReferencesList();
    });
}

// ----- Additional references events -----

/**
 * Обёртка над `renderAdditionalReferencesList`, пробрасывающая текущий
 * provider-лимит референсов. Нужна чтобы references.js не зависел от
 * providers.js (иначе ESM-цикл).
 */
function refreshAdditionalReferencesList() {
    const maxRefs = getActiveProviderMaxReferences(getSettings());
    renderAdditionalReferencesList(maxRefs);
}

function bindAdditionalReferencesEvents(settings) {
    document.getElementById('iig_additional_refs_add')?.addEventListener('click', () => {
        const refs = ensureAdditionalReferencesArray(settings);
        if (refs.length >= MAX_ADDITIONAL_REFERENCES) {
            toastr.warning(t`Maximum additional references: ${MAX_ADDITIONAL_REFERENCES}`, t`Image Generation`);
            return;
        }

        refs.push({
            name: '',
            description: '',
            imagePath: '',
            matchMode: 'match',
            enabled: true,
            group: '',
            priority: 0,
            useRegex: false,
            secondaryKeys: '',
        });
        saveSettings();
        refreshAdditionalReferencesList();
    });

    document.getElementById('iig_additional_refs_import')?.addEventListener('click', () => {
        openReferenceImportModal();
    });

    document.getElementById('iig_ref_import_close')?.addEventListener('click', () => {
        closeReferenceImportModal();
    });

    document.querySelector('#iig_ref_import_modal [data-iig-modal-close="true"]')?.addEventListener('click', () => {
        closeReferenceImportModal();
    });

    document.getElementById('iig_ref_import_submit')?.addEventListener('click', async () => {
        const button = document.getElementById('iig_ref_import_submit');
        const input = document.getElementById('iig_ref_import_urls');
        if (!(button instanceof HTMLDivElement) || !(input instanceof HTMLTextAreaElement)) {
            return;
        }

        button.classList.add('loading');
        try {
            const result = await importAdditionalReferencesFromUrls(input.value);
            closeReferenceImportModal();
            const tail = result.skippedCount > 0 ? t`, skipped: ${result.skippedCount}` : '';
            toastr.success(t`Imported: ${result.importedCount}` + tail, t`Image Generation`);
        } catch (error) {
            toastr.error(t`Import error: ${error.message || error}`, t`Image Generation`);
        } finally {
            button.classList.remove('loading');
        }
    });

    document.getElementById('iig_ref_import_urls')?.addEventListener('keydown', async (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('iig_ref_import_submit')?.click();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closeReferenceImportModal();
        }
    });

    document.getElementById('iig_additional_refs_list')?.addEventListener('input', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
            return;
        }

        const isNameField = target.classList.contains('iig-additional-ref-name');
        const isDescriptionField = target.classList.contains('iig-additional-ref-description');
        const isGroupField = target.classList.contains('iig-additional-ref-group');
        const isSecondaryField = target.classList.contains('iig-additional-ref-secondary');
        const isPriorityField = target.classList.contains('iig-additional-ref-priority');
        if (!isNameField && !isDescriptionField && !isGroupField && !isSecondaryField && !isPriorityField) {
            return;
        }

        const row = target.closest('.iig-additional-ref-row');
        const index = Number.parseInt(String(row?.getAttribute('data-ref-index') || ''), 10);
        if (!Number.isInteger(index)) {
            return;
        }

        const refs = ensureAdditionalReferencesArray(settings);
        if (!refs[index]) {
            return;
        }

        if (isNameField) refs[index].name = target.value;
        if (isDescriptionField) refs[index].description = target.value;
        if (isGroupField) refs[index].group = target.value;
        if (isSecondaryField) refs[index].secondaryKeys = target.value;
        if (isPriorityField) {
            const parsed = Number.parseInt(target.value, 10);
            refs[index].priority = Number.isFinite(parsed) ? parsed : 0;
        }
        saveSettings();
        // Обновляем только статус (ссылок на provider-limit warning), не
        // ре-рендерим карточки — иначе слетает фокус.
        renderAdditionalReferencesStatus(getActiveProviderMaxReferences(settings));
    });

    document.getElementById('iig_additional_refs_list')?.addEventListener('change', async (e) => {
        const target = e.target;
        if (target instanceof HTMLInputElement && target.classList.contains('iig-additional-ref-enabled')) {
            const row = target.closest('.iig-additional-ref-row');
            const index = Number.parseInt(String(row?.getAttribute('data-ref-index') || ''), 10);
            if (!Number.isInteger(index)) {
                return;
            }

            const refs = ensureAdditionalReferencesArray(settings);
            if (!refs[index]) {
                return;
            }

            refs[index].enabled = target.checked;
            saveSettings();
            refreshAdditionalReferencesList();
            return;
        }

        if (!(target instanceof HTMLInputElement) || !target.classList.contains('iig-additional-ref-file')) {
            return;
        }

        const row = target.closest('.iig-additional-ref-row');
        const index = Number.parseInt(String(row?.getAttribute('data-ref-index') || ''), 10);
        if (!Number.isInteger(index)) {
            target.value = '';
            return;
        }

        const file = target.files?.[0];
        if (!file) {
            target.value = '';
            return;
        }

        const refs = ensureAdditionalReferencesArray(settings);
        if (!refs[index]) {
            target.value = '';
            return;
        }

        try {
            if (!refs[index].name) {
                refs[index].name = file.name.replace(/\.[^.]+$/, '');
            }

            const dataUrl = await readFileAsDataUrl(file);
            const savedPath = await saveImageToFile(dataUrl, {
                mode: 'additional-reference-upload',
                refIndex: index,
                refName: refs[index].name,
            });

            refs[index].imagePath = normalizeStoredImagePath(savedPath);
            saveSettings();
            refreshAdditionalReferencesList();
            toastr.success(t`Additional reference saved`, t`Image Generation`);
        } catch (error) {
            console.error('[IIG] Failed to upload additional reference:', error);
            toastr.error(t`Reference upload failed: ${error.message || error}`, t`Image Generation`);
        } finally {
            target.value = '';
        }
    });

    document.getElementById('iig_additional_refs_list')?.addEventListener('change', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLInputElement)) return;

        const isAlways = target.classList.contains('iig-additional-ref-always');
        const isRegex = target.classList.contains('iig-additional-ref-regex');
        if (!isAlways && !isRegex) return;

        const row = target.closest('.iig-additional-ref-row');
        const index = Number.parseInt(String(row?.getAttribute('data-ref-index') || ''), 10);
        if (!Number.isInteger(index)) return;

        const refs = ensureAdditionalReferencesArray(settings);
        if (!refs[index]) return;

        if (isAlways) refs[index].matchMode = target.checked ? 'always' : 'match';
        if (isRegex) refs[index].useRegex = target.checked;
        saveSettings();
        refreshAdditionalReferencesList();
    });

    document.getElementById('iig_additional_refs_list')?.addEventListener('click', async (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;

        const urlBtn = target.closest('.iig-additional-ref-upload-url');
        const removeBtn = !urlBtn ? target.closest('.iig-additional-ref-remove') : null;
        const upBtn = !urlBtn && !removeBtn ? target.closest('.iig-additional-ref-move-up') : null;
        const downBtn = !urlBtn && !removeBtn && !upBtn ? target.closest('.iig-additional-ref-move-down') : null;
        const visionBtn = !urlBtn && !removeBtn && !upBtn && !downBtn ? target.closest('.iig-additional-ref-vision') : null;
        const button = urlBtn || removeBtn || upBtn || downBtn || visionBtn;
        if (!button) return;

        const row = button.closest('.iig-additional-ref-row');
        const index = Number.parseInt(String(row?.getAttribute('data-ref-index') || ''), 10);
        if (!Number.isInteger(index)) return;

        const refs = ensureAdditionalReferencesArray(settings);

        if (visionBtn && visionBtn instanceof HTMLElement) {
            const refId = refs[index]?.id;
            if (!refId) return;
            const originalHtml = visionBtn.innerHTML;
            visionBtn.classList.add('disabled');
            visionBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                const description = await generateReferenceDescription(refId);
                const descInput = row?.querySelector('.iig-additional-ref-description');
                if (descInput instanceof HTMLTextAreaElement) descInput.value = description;
                toastr.success(t`Description generated`, t`Image Generation`);
            } catch (error) {
                toastr.error(t`Vision generation error: ${error.message || error}`, t`Image Generation`);
            } finally {
                visionBtn.classList.remove('disabled');
                visionBtn.innerHTML = originalHtml;
            }
            return;
        }

        if (urlBtn) {
            if (!refs[index]) return;
            const url = await Popup.show.input(t`Upload image by URL`, t`Paste a direct link to the image:`);
            const trimmed = String(url || '').trim();
            if (!trimmed) return;
            try {
                const savedPath = await downloadReferenceImageFromUrl(trimmed, {
                    mode: 'additional-reference-upload-url',
                    refIndex: index,
                    refName: refs[index].name,
                });
                refs[index].imagePath = savedPath;
                saveSettings();
                refreshAdditionalReferencesList();
                toastr.success(t`Additional reference saved`, t`Image Generation`);
            } catch (error) {
                console.error('[IIG] Failed to upload reference by URL:', error);
                toastr.error(t`Reference upload failed: ${error.message || error}`, t`Image Generation`);
            }
            return;
        }

        if (removeBtn) {
            const name = String(refs[index]?.name || '').trim() || t`Reference ${index + 1}`;
            const confirmed = await Popup.show.confirm(
                t`Delete reference`,
                t`Delete reference "${name}"? This cannot be undone.`,
            );
            if (!confirmed) return;
            refs.splice(index, 1);
        } else if (upBtn && index > 0) {
            [refs[index - 1], refs[index]] = [refs[index], refs[index - 1]];
        } else if (downBtn && index < refs.length - 1) {
            [refs[index], refs[index + 1]] = [refs[index + 1], refs[index]];
        } else {
            return; // no-op (edge)
        }
        saveSettings();
        refreshAdditionalReferencesList();
    });
}

// ----- Reference instruction events -----

function bindRefInstructionEvents(settings) {
    const checkbox = document.getElementById('iig_ref_instruction_enabled');
    const textarea = document.getElementById('iig_ref_instruction');
    const resetBtn = document.getElementById('iig_ref_instruction_reset');

    checkbox?.addEventListener('change', (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        settings.refInstructionEnabled = e.target.checked;
        if (textarea instanceof HTMLTextAreaElement) {
            textarea.disabled = !e.target.checked;
        }
        saveSettings();
    });

    textarea?.addEventListener('input', (e) => {
        if (!(e.target instanceof HTMLTextAreaElement)) return;
        settings.refInstruction = e.target.value;
        saveSettings();
    });

    resetBtn?.addEventListener('click', () => {
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        textarea.value = DEFAULT_REF_INSTRUCTION;
        settings.refInstruction = DEFAULT_REF_INSTRUCTION;
        saveSettings();
        toastr.success(t`Reference instruction reset to default`, t`Image Generation`, { timeOut: 1500 });
    });
}

// ----- Debug section events -----

function bindDebugSectionEvents(settings) {
    document.getElementById('iig_max_retries')?.addEventListener('input', (e) => {
        settings.maxRetries = parseInt(e.target.value) || 3;
        saveSettings();
    });

    document.getElementById('iig_retry_delay')?.addEventListener('input', (e) => {
        settings.retryDelay = parseInt(e.target.value) || 1000;
        saveSettings();
    });

    document.getElementById('iig_export_logs')?.addEventListener('click', () => {
        exportLogs();
    });

    document.getElementById('iig_show_last_request')?.addEventListener('click', () => {
        showLastRequestPopup();
    });

    document.getElementById('iig_show_book_macro')?.addEventListener('click', () => {
        showIigBookPreviewPopup();
    });
}

// ----- Visibility recomputation -----

function buildUpdateVisibility(settings) {
    return () => {
        const apiType = settings.apiType;
        const isNaistera = apiType === 'naistera';
        const isGemini = apiType === 'gemini';
        const isOpenAI = apiType === 'openai';
        const isOpenRouter = apiType === 'openrouter';
        const isElectronHub = apiType === 'electronhub';
        const isVoid = apiType === 'void';
        const isAIGate = apiType === 'aigate';
        const isNovelAI = apiType === 'novelai';

        // Поддерживает ли активный провайдер референсы (учитывая модель).
        const provider = resolveActiveProvider(settings);
        const refsSupported = provider ? provider.supportsReferences(settings) : false;
        const naisteraRefsSupported = isNaistera && refsSupported;

        // «Общий» avatar refs блок (char/user аватар с чекбоксами) — теперь
        // показывается не только для Gemini, но и для любого OpenAI-семейства,
        // которое поддерживает /edits, и для OpenRouter/Electron Hub. Naistera
        // использует свой отдельный блок.
        const commonAvatarRefsVisible = (isGemini || isOpenAI || isOpenRouter || isElectronHub || isVoid || isAIGate) && refsSupported;

        // Model is used for OpenAI and Gemini; Naistera and NovelAI have their own selectors.
        document.getElementById('iig_model_row')?.classList.toggle('iig-hidden', isNaistera || isNovelAI);
        document.getElementById('iig_image_context_section')?.classList.toggle('iig-hidden', !refsSupported);
        document.getElementById('iig_image_context_count_row')?.classList.toggle('iig-hidden', !(refsSupported && settings.imageContextEnabled));
        document.getElementById('iig_additional_refs_section')?.classList.toggle('iig-hidden', !refsSupported);
        document.getElementById('iig_ref_instruction_section')?.classList.toggle('iig-hidden', !refsSupported);

        // Обновляем provider-limit warning в status-строке без ре-рендера
        // карточек (чтобы не терять фокус в inputs).
        renderAdditionalReferencesStatus(getActiveProviderMaxReferences(settings));

        // OpenAI + Electron Hub params (size / quality) — Electron Hub
        // принимает тот же формат JSON на /v1/images/{generations,edits}.
        document.getElementById('iig_size_row')?.classList.toggle('iig-hidden', !(isOpenAI || isElectronHub));
        document.getElementById('iig_quality_row')?.classList.toggle('iig-hidden', !(isOpenAI || isElectronHub));

        // ElectronHub-only section
        document.getElementById('iig_electronhub_section')?.classList.toggle('iig-hidden', !isElectronHub);

        // NovelAI-only section; also hide endpoint/key/raw — NovelAI uses ST proxy.
        document.getElementById('iig_novelai_section')?.classList.toggle('iig-hidden', !isNovelAI);
        document.getElementById('iig_endpoint')?.closest('.flex-row')?.classList.toggle('iig-hidden', isNovelAI);
        document.getElementById('iig_api_key')?.closest('.flex-row')?.classList.toggle('iig-hidden', isNovelAI);
        document.getElementById('iig_raw_endpoint')?.closest('.checkbox_label')?.classList.toggle('iig-hidden', isNovelAI);

        // NovelAI: hide entire References section, show Presets instead.
        document.querySelector('[data-section-toggle="iig_references_section"]')?.closest('.iig-section')?.classList.toggle('iig-hidden', isNovelAI);
        document.getElementById('iig_presets_section_wrapper')?.classList.toggle('iig-hidden', !isNovelAI);

        // Naistera-only params
        document.getElementById('iig_naistera_model_row')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_aspect_row')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_video_section')?.classList.toggle('iig-hidden', !isNaistera);
        document.getElementById('iig_naistera_video_frequency_row')?.classList.toggle('iig-hidden', !(isNaistera && settings.naisteraVideoTest));
        document.getElementById('iig_naistera_refs_section')?.classList.toggle('iig-hidden', !naisteraRefsSupported);
        document.getElementById('iig_naistera_use_active_persona_avatar_row')?.classList.toggle('iig-hidden', !(naisteraRefsSupported && settings.naisteraSendUserAvatar));
        document.getElementById('iig_naistera_user_avatar_row')?.classList.toggle(
            'iig-hidden',
            !(naisteraRefsSupported && settings.naisteraSendUserAvatar && !settings.useActiveUserPersonaAvatar)
        );

        document.getElementById('iig_naistera_hint')?.classList.toggle('iig-hidden', !isNaistera);

        const endpointInput = document.getElementById('iig_endpoint');
        if (endpointInput) {
            endpointInput.placeholder = getEndpointPlaceholder(apiType);
        }

        const avatarSection = document.getElementById('iig_avatar_section');
        if (avatarSection) {
            avatarSection.classList.toggle('iig-hidden', !(isGemini || isOpenRouter || isVoid || isAIGate));
        }

        // «Общий» avatar refs блок — для Gemini / OpenAI-c-refs / OpenRouter.
        const avatarRefsSection = document.getElementById('iig_avatar_refs_section');
        if (avatarRefsSection) {
            avatarRefsSection.classList.toggle('iig-hidden', !commonAvatarRefsVisible);

            // Обновляем заголовок при смене провайдера.
            const titleEl = avatarRefsSection.querySelector('h4');
            if (titleEl) {
                if (isOpenRouter) titleEl.textContent = 'OpenRouter';
                else if (isElectronHub) titleEl.textContent = 'Electron Hub';
                else if (isVoid) titleEl.textContent = 'VoidAI / RouteMyAI';
                else if (isAIGate) titleEl.textContent = 'AIGate';
                else if (isOpenAI) titleEl.textContent = 'OpenAI / GPT Image';
                else titleEl.textContent = 'Gemini / nano-banana';
            }
        }
        document.getElementById('iig_use_active_persona_avatar_row')?.classList.toggle(
            'iig-hidden',
            !(commonAvatarRefsVisible && settings.sendUserAvatar),
        );
        document.getElementById('iig_user_avatar_row')?.classList.toggle(
            'iig-hidden',
            !(commonAvatarRefsVisible && settings.sendUserAvatar && !settings.useActiveUserPersonaAvatar),
        );
    };
}

// ----- Main bind -----

function bindSettingsEvents() {
    const settings = getSettings();
    const updateVisibility = buildUpdateVisibility(settings);

    bindSectionToggles();
    bindConnectionProfilesEvents(settings, updateVisibility);
    bindApiSectionEvents(settings, updateVisibility);

    // Gemini avatar section
    bindAvatarSectionEvents(settings, updateVisibility, {
        sendCharCheckboxId: 'iig_send_char_avatar',
        sendCharKey: 'sendCharAvatar',
        sendUserCheckboxId: 'iig_send_user_avatar',
        sendUserKey: 'sendUserAvatar',
        useActivePersonaCheckboxId: 'iig_use_active_persona_avatar',
        userAvatarSelectId: 'iig_user_avatar_file',
        refreshButtonId: 'iig_refresh_avatars',
        userAvatarDropdownId: 'iig_user_avatar_dropdown',
    });

    // Naistera avatar section
    bindAvatarSectionEvents(settings, updateVisibility, {
        sendCharCheckboxId: 'iig_naistera_send_char_avatar',
        sendCharKey: 'naisteraSendCharAvatar',
        sendUserCheckboxId: 'iig_naistera_send_user_avatar',
        sendUserKey: 'naisteraSendUserAvatar',
        useActivePersonaCheckboxId: 'iig_naistera_use_active_persona_avatar',
        userAvatarSelectId: 'iig_naistera_user_avatar_file',
        refreshButtonId: 'iig_naistera_refresh_avatars',
        userAvatarDropdownId: 'iig_naistera_user_avatar_dropdown',
    });

    bindAvatarDropdownToggles();
    styleSection.bindEvents(settings);
    prefixSection.bindEvents(settings);
    suffixSection.bindEvents(settings);
    bindLorebookBarEvents(settings);
    bindAdditionalReferencesEvents(settings);
    bindRefInstructionEvents(settings);
    novelaiPresetSection.bindEvents(settings);
    bindDebugSectionEvents(settings);

    // Apply initial state
    syncUserAvatarSelection(settings.userAvatarFile);
    syncActivePersonaAvatarMode(settings.useActiveUserPersonaAvatar);
    refreshAdditionalReferencesList();
    updateVisibility();
}

// ============================================================
// Extras (порт из MG): рендер карточек + биндинг внутри tabs References
// ============================================================

// ----- Render: Avatar Library grids -----

function renderAvatarGrid(target) {
    const settings = getSettings();
    const containerId = target === 'user' ? 'iig_avatar_lib_user' : 'iig_avatar_lib_char';
    const container = document.getElementById(containerId);
    if (!container) return;

    const items = ensureAvatarItems(settings).filter((a) => a.target === target);
    const activeId = target === 'user' ? settings.activeAvatarUser : settings.activeAvatarChar;

    if (items.length === 0) {
        container.innerHTML = `<div class="iig-extras-empty">${t`No avatars yet. Add one to override the default.`}</div>`;
        return;
    }

    container.innerHTML = items.map((item) => `
        <div class="iig-extras-card ${item.id === activeId ? 'iig-extras-active' : ''}" data-ava-id="${sanitizeForHtml(item.id)}" data-ava-target="${target}">
            <img src="data:image/png;base64,${item.imageData}" class="iig-extras-img" alt="${sanitizeForHtml(item.name)}">
            <div class="iig-extras-overlay">
                <span class="iig-extras-name" title="${sanitizeForHtml(item.name)}">${sanitizeForHtml(item.name)}</span>
                <i class="fa-solid fa-trash iig-extras-delete" data-ava-del="${sanitizeForHtml(item.id)}" title="${t`Delete`}"></i>
            </div>
            ${item.id === activeId ? '<div class="iig-extras-check"><i class="fa-solid fa-check"></i></div>' : ''}
        </div>
    `).join('');

    container.querySelectorAll('.iig-extras-card').forEach((card) => {
        card.addEventListener('click', (e) => {
            if (e.target instanceof Element && e.target.closest('.iig-extras-delete')) return;
            const avaId = card.getAttribute('data-ava-id');
            const avaTarget = card.getAttribute('data-ava-target') || target;
            if (!avaId) return;
            setActiveAvatar(avaId, avaTarget);
            renderAvatarGrid(avaTarget);
        });
    });

    container.querySelectorAll('.iig-extras-delete').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const avaId = btn.getAttribute('data-ava-del');
            if (!avaId) return;
            removeAvatarItem(avaId);
            renderAvatarGrid(target);
            toastr.info(t`Avatar deleted`, t`Image Generation`);
        });
    });

    renderAvatarAppearancePanel(target);
}

// ----- Render: Avatar appearance panels -----

function renderAvatarAppearancePanel(target) {
    const panelId = target === 'user' ? 'iig_avatar_desc_user' : 'iig_avatar_desc_char';
    const panel = document.getElementById(panelId);
    if (!panel) return;

    const activeItem = getActiveAvatarItem(target);
    if (!activeItem) {
        panel.innerHTML = '';
        return;
    }

    panel.innerHTML = `
        <div class="iig-wardrobe-desc-panel">
            <div class="iig-wardrobe-desc-header">
                <i class="fa-solid fa-user"></i>
                <span>${t`Appearance`}: <b>${sanitizeForHtml(activeItem.name)}</b></span>
            </div>
            <textarea class="text_pole iig-avatar-desc-textarea" rows="3"
                placeholder="${t`Enter appearance description manually or generate via Vision AI...`}"
                data-ava-id="${sanitizeForHtml(activeItem.id)}">${sanitizeForHtml(activeItem.appearance || '')}</textarea>
            <div class="iig-wardrobe-desc-actions">
                <div class="menu_button iig-avatar-desc-generate" data-ava-id="${sanitizeForHtml(activeItem.id)}" title="${t`Generate via Vision AI`}">
                    <i class="fa-solid fa-robot"></i> ${t`Generate`}
                </div>
                <div class="menu_button iig-avatar-desc-save" data-ava-id="${sanitizeForHtml(activeItem.id)}" title="${t`Save description`}">
                    <i class="fa-solid fa-floppy-disk"></i> ${t`Save`}
                </div>
                <div class="menu_button iig-avatar-desc-clear" data-ava-id="${sanitizeForHtml(activeItem.id)}" title="${t`Clear description`}">
                    <i class="fa-solid fa-eraser"></i>
                </div>
            </div>
            <div class="iig-wardrobe-desc-status" style="display:none;"></div>
        </div>
    `;

    const textarea = panel.querySelector('.iig-avatar-desc-textarea');

    textarea?.addEventListener('blur', () => {
        const avaId = textarea.getAttribute('data-ava-id');
        if (avaId) updateAvatarItemAppearance(avaId, textarea.value);
    });

    panel.querySelector('.iig-avatar-desc-save')?.addEventListener('click', () => {
        const avaId = textarea?.getAttribute('data-ava-id');
        if (!avaId) return;
        updateAvatarItemAppearance(avaId, textarea.value);
        toastr.success(t`Appearance saved`, t`Image Generation`);
    });

    panel.querySelector('.iig-avatar-desc-clear')?.addEventListener('click', () => {
        if (!textarea) return;
        const avaId = textarea.getAttribute('data-ava-id');
        if (!avaId) return;
        textarea.value = '';
        updateAvatarItemAppearance(avaId, '');
        toastr.info(t`Appearance cleared`, t`Image Generation`);
    });

    panel.querySelector('.iig-avatar-desc-generate')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (!(btn instanceof HTMLElement)) return;
        const avaId = btn.getAttribute('data-ava-id');
        if (!avaId) return;
        const statusEl = panel.querySelector('.iig-wardrobe-desc-status');

        btn.classList.add('disabled');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + t`Generating...`;
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.textContent = t`Sending image to vision model...`;
            statusEl.classList.remove('iig-desc-error', 'iig-desc-success');
        }

        try {
            const description = await generateAvatarAppearanceDescription(avaId);
            if (textarea instanceof HTMLTextAreaElement) textarea.value = description;
            if (statusEl) {
                statusEl.textContent = t`Appearance description generated.`;
                statusEl.classList.add('iig-desc-success');
            }
            toastr.success(t`Appearance generated`, t`Image Generation`);
        } catch (error) {
            iigLog('ERROR', 'Avatar appearance generation failed:', error);
            if (statusEl) {
                statusEl.textContent = t`Error: ${error.message || error}`;
                statusEl.classList.add('iig-desc-error');
            }
            toastr.error(t`Vision generation error: ${error.message || error}`, t`Image Generation`);
        } finally {
            btn.classList.remove('disabled');
            btn.innerHTML = originalHtml;
            setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 5000);
        }
    });
}

// ----- Render: NPC list -----

function renderNpcList() {
    const settings = getSettings();
    const container = document.getElementById('iig_npc_list');
    if (!container) return;

    const list = ensureNpcList(settings);
    container.innerHTML = '';

    if (list.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = t`No NPCs yet. Click "Add NPC" to create one.`;
        container.appendChild(empty);
        return;
    }

    for (const npc of list) {
        const isEnabled = npc.enabled !== false;
        const npcEl = document.createElement('div');
        npcEl.className = `iig-npc-item ${isEnabled ? '' : 'iig-npc-disabled'}`;
        npcEl.dataset.npcId = npc.id;

        const avatarPreview = npc.avatarData
            ? `<img src="data:image/png;base64,${npc.avatarData}" class="iig-npc-avatar-preview" alt="">`
            : `<div class="iig-npc-avatar-preview iig-npc-no-avatar"><i class="fa-solid fa-user-plus"></i></div>`;

        npcEl.innerHTML = `
            <div class="iig-npc-header">
                <div class="iig-npc-avatar-container">
                    ${avatarPreview}
                    <input type="file" class="iig-npc-avatar-input" accept="image/*" style="display:none">
                    <div class="iig-npc-avatar-upload-btn menu_button" title="${t`Upload avatar`}">
                        <i class="fa-solid fa-upload"></i>
                    </div>
                </div>
                <div class="iig-npc-fields">
                    <input type="text" class="text_pole iig-npc-name" placeholder="${t`NPC name`}" value="${sanitizeForHtml(npc.name || '')}">
                    <input type="text" class="text_pole iig-npc-aliases" placeholder="${t`Aliases (comma-separated)`}" value="${sanitizeForHtml((npc.aliases || []).join(', '))}">
                </div>
                <div class="iig-npc-btn-group">
                    <div class="iig-npc-toggle menu_button ${isEnabled ? 'iig-npc-on' : 'iig-npc-off'}" title="${isEnabled ? t`Disable NPC` : t`Enable NPC`}">
                        <i class="fa-solid ${isEnabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                    </div>
                    <div class="iig-npc-remove menu_button" title="${t`Remove NPC`}">
                        <i class="fa-solid fa-trash"></i>
                    </div>
                </div>
            </div>
            <textarea class="text_pole iig-npc-appearance" rows="2" placeholder="${t`Appearance description (optional)`}">${sanitizeForHtml(npc.appearance || '')}</textarea>
            <div class="iig-npc-appearance-row">
                <div class="menu_button iig-npc-appearance-vision ${npc.avatarData ? '' : 'iig-hidden'}" title="${t`Generate appearance description via Vision AI`}">
                    <i class="fa-solid fa-robot"></i> ${t`Generate with Vision`}
                </div>
            </div>
        `;

        npcEl.querySelector('.iig-npc-name')?.addEventListener('input', (e) => {
            updateNpc(npc.id, { name: e.target.value });
        });
        npcEl.querySelector('.iig-npc-aliases')?.addEventListener('input', (e) => {
            updateNpc(npc.id, { aliases: e.target.value.split(',').map((a) => a.trim()).filter(Boolean) });
        });
        npcEl.querySelector('.iig-npc-appearance')?.addEventListener('input', (e) => {
            updateNpc(npc.id, { appearance: e.target.value });
        });

        npcEl.querySelector('.iig-npc-toggle')?.addEventListener('click', () => {
            toggleNpc(npc.id);
            renderNpcList();
        });

        const uploadBtn = npcEl.querySelector('.iig-npc-avatar-upload-btn');
        const fileInput = npcEl.querySelector('.iig-npc-avatar-input');
        uploadBtn?.addEventListener('click', () => fileInput?.click());
        npcEl.querySelector('.iig-npc-avatar-container')?.addEventListener('click', (e) => {
            if (e.target instanceof Element && !e.target.closest('.iig-npc-avatar-upload-btn')) {
                fileInput?.click();
            }
        });
        fileInput?.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const resized = await fileToResizedBase64(file, 512);
                updateNpc(npc.id, { avatarData: resized });
                renderNpcList();
                toastr.success(t`Avatar uploaded for ${npc.name || 'NPC'}`, t`Image Generation`);
            } catch (error) {
                toastr.error(t`Failed to upload avatar: ${error.message || error}`, t`Image Generation`);
            }
        });

        npcEl.querySelector('.iig-npc-remove')?.addEventListener('click', async () => {
            const confirmed = await Popup.show.confirm(
                t`Remove NPC`,
                t`Remove this NPC? This cannot be undone.`,
            );
            if (!confirmed) return;
            removeNpc(npc.id);
            renderNpcList();
        });

        const npcVisionBtn = npcEl.querySelector('.iig-npc-appearance-vision');
        npcVisionBtn?.addEventListener('click', async () => {
            if (!(npcVisionBtn instanceof HTMLElement)) return;
            const originalHtml = npcVisionBtn.innerHTML;
            npcVisionBtn.classList.add('disabled');
            npcVisionBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                const description = await generateNpcAppearanceDescription(npc.id);
                const appearanceTextarea = npcEl.querySelector('.iig-npc-appearance');
                if (appearanceTextarea instanceof HTMLTextAreaElement) {
                    appearanceTextarea.value = description;
                }
                toastr.success(t`Appearance generated`, t`Image Generation`);
            } catch (error) {
                iigLog('ERROR', 'NPC appearance generation failed:', error);
                toastr.error(t`Vision generation error: ${error.message || error}`, t`Image Generation`);
            } finally {
                npcVisionBtn.classList.remove('disabled');
                npcVisionBtn.innerHTML = originalHtml;
            }
        });

        container.appendChild(npcEl);
    }
}

// ----- Bind: extras section events -----

function bindExtrasEvents(settings) {
    // ---- Avatar Library ----
    const bindAvatarLibAdd = (target) => {
        const addBtn = document.getElementById(`iig_avatar_lib_${target}_add`);
        const fileInput = document.getElementById(`iig_avatar_lib_${target}_file`);
        const nameInput = document.getElementById(`iig_avatar_lib_${target}_name`);

        addBtn?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', async (e) => {
            const file = e.target?.files?.[0];
            if (!file) return;
            try {
                const resized = await fileToResizedBase64(file, 512);
                const name = (nameInput instanceof HTMLInputElement ? nameInput.value.trim() : '')
                    || file.name.replace(/\.[^.]+$/, '')
                    || 'Avatar';
                addAvatarItem(name, resized, target);
                if (nameInput instanceof HTMLInputElement) nameInput.value = '';
                if (fileInput instanceof HTMLInputElement) fileInput.value = '';
                renderAvatarGrid(target);
                toastr.success(t`Avatar "${name}" added`, t`Image Generation`);
            } catch (error) {
                toastr.error(t`Failed to add avatar: ${error.message || error}`, t`Image Generation`);
            }
        });
    };
    bindAvatarLibAdd('char');
    bindAvatarLibAdd('user');

    // ---- Wardrobe ----
    document.getElementById('iig_inject_avatar_appearance_gen')?.addEventListener('change', (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        settings.injectAvatarAppearanceToGeneration = e.target.checked;
        saveSettings();
    });

    document.getElementById('iig_inject_avatar_appearance_chat')?.addEventListener('change', (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        settings.injectAvatarAppearanceToChatEnabled = e.target.checked;
        saveSettings();
        updateAvatarAppearanceInjection();
    });

    document.getElementById('iig_avatar_appearance_depth')?.addEventListener('input', (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        const v = Number.parseInt(e.target.value, 10);
        settings.avatarAppearanceInjectionDepth = Number.isFinite(v) && v >= 0 ? v : 1;
        saveSettings();
        updateAvatarAppearanceInjection();
    });

    document.getElementById('iig_inject_wardrobe')?.addEventListener('change', (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        settings.injectWardrobeToChat = e.target.checked;
        saveSettings();
        updateWardrobeInjection();
    });

    document.getElementById('iig_wardrobe_injection_depth')?.addEventListener('input', (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        const v = Number.parseInt(e.target.value, 10);
        settings.wardrobeInjectionDepth = Number.isFinite(v) && v >= 0 ? v : 1;
        saveSettings();
        updateWardrobeInjection();
    });

    document.getElementById('iig_show_floating_wardrobe')?.addEventListener('change', (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        settings.showFloatingWardrobeBtn = e.target.checked;
        saveSettings();
        swInjectBarBtn();
    });

    document.getElementById('iig_open_wardrobe_modal')?.addEventListener('click', () => {
        swOpenModal();
    });

    // ---- Vision ----
    document.getElementById('iig_vision_endpoint')?.addEventListener('input', (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        settings.visionEndpoint = e.target.value;
        saveSettings();
    });
    document.getElementById('iig_vision_api_key')?.addEventListener('input', (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        settings.visionApiKey = e.target.value;
        saveSettings();
    });
    document.getElementById('iig_vision_key_toggle')?.addEventListener('click', () => {
        const input = document.getElementById('iig_vision_api_key');
        const icon = document.querySelector('#iig_vision_key_toggle i');
        if (!(input instanceof HTMLInputElement)) return;
        if (input.type === 'password') {
            input.type = 'text';
            icon?.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon?.classList.replace('fa-eye-slash', 'fa-eye');
        }
    });
    document.getElementById('iig_vision_model_select')?.addEventListener('change', (e) => {
        if (!(e.target instanceof HTMLSelectElement)) return;
        settings.visionModel = e.target.value;
        saveSettings();
    });
    document.getElementById('iig_refresh_vision_models')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn instanceof HTMLElement) btn.classList.add('loading');
        try {
            const models = await fetchVisionModels();
            const select = document.getElementById('iig_vision_model_select');
            if (select instanceof HTMLSelectElement) {
                const current = settings.visionModel || '';
                const inList = current && models.includes(current);
                const optionsHtml = [
                    `<option value="">${t`-- Select a model --`}</option>`,
                    ...models.map((m) => `<option value="${sanitizeForHtml(m)}" ${m === current ? 'selected' : ''}>${sanitizeForHtml(m)}</option>`),
                    ...(!inList && current ? [`<option value="${sanitizeForHtml(current)}" selected>${sanitizeForHtml(current)} ${t`(custom)`}</option>`] : []),
                ];
                select.innerHTML = optionsHtml.join('');
            }
            toastr.success(t`Vision models found: ${models.length}`, t`Image Generation`);
        } catch (_e) {
            // toastr уже выведен из fetchVisionModels
        } finally {
            if (btn instanceof HTMLElement) btn.classList.remove('loading');
        }
    });
    document.getElementById('iig_vision_prompt')?.addEventListener('input', (e) => {
        if (!(e.target instanceof HTMLTextAreaElement)) return;
        settings.visionPrompt = e.target.value;
        saveSettings();
    });

    // ---- NPC ----
    document.getElementById('iig_auto_detect_names')?.addEventListener('change', (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        settings.autoDetectNames = e.target.checked;
        saveSettings();
    });
    document.getElementById('iig_add_npc')?.addEventListener('click', () => {
        addNpc();
        renderNpcList();
    });
}

// ----- Public entry -----

export function createSettingsUI() {
    const settings = getSettings();

    const container = document.getElementById('extensions_settings');
    if (!container) {
        console.error('[IIG] Settings container not found');
        return;
    }

    const html = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>${t`Image Generation`}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="iig-settings">
                    ${buildApiSettingsSectionHtml(settings)}
                    ${styleSection.buildSectionHtml()}
                    ${prefixSection.buildSectionHtml()}
                    ${suffixSection.buildSectionHtml()}
                    ${buildReferencesSettingsSectionHtml(settings)}
                    <div id="iig_presets_section_wrapper" class="${settings.apiType === 'novelai' ? '' : 'iig-hidden'}">
                        <p class="hint" style="margin: 8px 0 4px;">${t`Name = trigger word, Value = replacement tags. Case-insensitive whole-word match.`}</p>
                        ${novelaiPresetSection.buildSectionHtml()}
                    </div>
                    ${buildDebugSettingsSectionHtml(settings)}
                </div>
            </div>
        </div>
        ${buildReferenceImportModalHtml()}
    `;

    container.insertAdjacentHTML('beforeend', html);

    bindSettingsEvents();
    bindExtrasEvents(settings);
    bindReferencesTabs();
    bindVisionCollapse();
    renderStyleSettings();
    renderAvatarGrid('char');
    renderAvatarGrid('user');
    renderNpcList();
}

// ----- Tabs (References section) -----

function bindReferencesTabs() {
    const tabs = document.querySelectorAll('#iig_references_section .iig-tab');
    const panels = document.querySelectorAll('#iig_references_section .iig-tab-panel');
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-iig-tab');
            if (!target) return;
            tabs.forEach((t2) => t2.classList.toggle('iig-tab-active', t2 === tab));
            panels.forEach((p) => p.classList.toggle('iig-tab-panel-active', p.getAttribute('data-iig-tab-panel') === target));
        });
    });
}

// ----- Vision collapse toggle (inside API section) -----

function bindVisionCollapse() {
    const head = document.querySelector('[data-iig-vision-toggle]');
    const body = document.getElementById('iig_vision_body');
    const chev = document.getElementById('iig_vision_chev');
    if (!head || !body) return;
    head.addEventListener('click', () => {
        const willHide = !body.classList.contains('iig-hidden');
        body.classList.toggle('iig-hidden', willHide);
        chev?.classList.toggle('iig-section-chevron-collapsed', willHide);
    });
}
