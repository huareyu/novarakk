/**
 * Naistera (custom / grok / nano banana 2 / novelai proxy): собственный
 * /api/generate endpoint, умеет отдавать и картинки, и видео.
 */

import {
    getSettings,
    NAISTERA_MODELS,
    MAX_GENERATION_REFERENCE_IMAGES,
    normalizeNaisteraModel,
    naisteraModelSupportsReferences,
    normalizeImageContextCount,
    normalizeNaisteraVideoFrequency,
    getEffectiveEndpoint,
    getEffectiveRefInstruction,
} from '../settings.js';
import {
    normalizeStoredImagePath,
    imageUrlToDataUrl,
    ProviderError,
    isRetryableHttpStatus,
} from '../utils.js';
import { buildFinalGenerationPrompt } from '../parser.js';
import { t } from '../i18n.js';
import {
    getCharacterAvatarDataUrl,
    getUserAvatarDataUrl,
    collectPreviousContextReferences,
} from '../references.js';
import { collectAvatarReferences, collectExtraReferences, mergeAvatarReferenceGroups } from '../extras.js';
import { Provider, resolveLockedSetting } from './base.js';

export class NaisteraProvider extends Provider {
    get id() { return 'naistera'; }
    get displayName() { return 'Naistera'; }

    get capabilities() {
        return {
            ...super.capabilities,
            referencesFormat: 'dataUrl',
        };
    }

    validate(settings) {
        const errors = [];
        if (!settings.apiKey) {
            errors.push(t`API key is not configured`);
        }
        const m = normalizeNaisteraModel(settings.naisteraModel);
        if (!NAISTERA_MODELS.includes(m)) {
            errors.push(t`For Naistera, select a model: grok / grok-pro / nano banana`);
        }
        return errors;
    }

    supportsReferences(settings) {
        return naisteraModelSupportsReferences(settings.naisteraModel);
    }

    async collectReferences({ prompt = '', messageId, matchedAdditionalRefs = [], providerOptions = {} }) {
        const settings = getSettings();
        const normalizedModel = normalizeNaisteraModel(providerOptions.model || settings.naisteraModel);
        if (!naisteraModelSupportsReferences(normalizedModel)) {
            return [];
        }

        const refs = [];

        const avatarGroups = [];
        if (settings.naisteraSendCharAvatar) avatarGroups.push(await collectAvatarReferences('bot', 'dataUrl', prompt));
        if (settings.naisteraSendUserAvatar) avatarGroups.push(await collectAvatarReferences('user', 'dataUrl', prompt));
        refs.push(...mergeAvatarReferenceGroups(avatarGroups, MAX_GENERATION_REFERENCE_IMAGES));

        for (const extra of await collectExtraReferences(prompt, 'dataUrl')) {
            if (refs.length >= MAX_GENERATION_REFERENCE_IMAGES) break;
            refs.push(extra);
        }

        for (const ref of matchedAdditionalRefs) {
            if (refs.length >= MAX_GENERATION_REFERENCE_IMAGES) break;
            const imagePath = normalizeStoredImagePath(ref.imagePath);
            if (!imagePath) continue;
            const d = await imageUrlToDataUrl(imagePath);
            if (d) refs.push(d);
        }

        if (settings.imageContextEnabled) {
            const contextCount = normalizeImageContextCount(settings.imageContextCount);
            const contextRefs = await collectPreviousContextReferences(messageId, 'dataUrl', contextCount);
            refs.push(...contextRefs);
        }

        if (refs.length > MAX_GENERATION_REFERENCE_IMAGES) {
            refs.length = MAX_GENERATION_REFERENCE_IMAGES;
        }
        return refs;
    }

    async generate({ prompt, style, references = [], options = {} }) {
        const settings = getSettings();
        const endpoint = getEffectiveEndpoint(settings);
        const url = endpoint.endsWith('/api/generate') ? endpoint : `${endpoint}/api/generate`;

        const aspectRatio = resolveLockedSetting(options.aspectRatio)
            || resolveLockedSetting(settings.naisteraAspectRatio)
            || 'auto';
        const model = normalizeNaisteraModel(options.model || settings.naisteraModel || 'grok');
        const preset = options.preset || null;
        const wantsVideoTest = Boolean(options.videoTestMode);
        const videoEveryN = normalizeNaisteraVideoFrequency(options.videoEveryN ?? settings.naisteraVideoEveryN);
        let fullPrompt = buildFinalGenerationPrompt(prompt, style, options.matchedAdditionalRefs || [], settings);

        if (references.length > 0) {
            const refInstruction = getEffectiveRefInstruction(settings);
            if (refInstruction) {
                fullPrompt = `${refInstruction}\n\n${fullPrompt}`;
            }
        }

        const body = {
            prompt: fullPrompt,
            aspect_ratio: aspectRatio,
            model,
        };
        if (preset) body.preset = preset;
        if (references.length > 0) {
            body.reference_images = references.slice(0, MAX_GENERATION_REFERENCE_IMAGES);
        }
        if (wantsVideoTest) {
            body.video_test_mode = true;
            body.video_test_every_n_messages = videoEveryN;
        }

        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${settings.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: options.signal,
            });
        } catch (error) {
            const pageOrigin = window.location.origin;
            let endpointOrigin = endpoint;
            try {
                endpointOrigin = new URL(url, window.location.href).origin;
            } catch (parseErr) {
                console.warn('[IIG] Failed to parse Naistera endpoint origin:', parseErr);
            }
            const rawMessage = String(error?.message || '').trim() || 'Failed to fetch';
            throw new ProviderError({
                message: `Network/CORS error while requesting ${endpointOrigin} from ${pageOrigin}. `
                    + `The browser blocked access to the response before the API could return JSON. `
                    + `Original error: ${rawMessage}`,
                code: 'network',
                retryable: true,
                providerId: 'naistera',
                cause: error,
            });
        }

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new ProviderError({
                message: `API Error (${response.status}): ${String(text).slice(0, 800)}`,
                code: String(response.status),
                status: response.status,
                retryable: isRetryableHttpStatus(response.status),
                providerId: 'naistera',
            });
        }

        const result = await response.json();
        if (!result?.data_url) {
            throw new ProviderError({
                message: 'No data_url in response',
                code: 'empty_response',
                retryable: false,
                providerId: 'naistera',
            });
        }
        if (result.media_kind === 'video') {
            return {
                kind: 'video',
                dataUrl: result.data_url,
                posterDataUrl: result.poster_data_url || '',
                contentType: result.content_type || 'video/mp4',
            };
        }
        return result.data_url;
    }
}
