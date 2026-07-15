/**
 * NovelAI — генерация через серверный прокси SillyTavern
 * (/api/novelai/generate-image), без референсов.
 */

import {
    getSettings,
    iigLog,
    NOVELAI_MODELS,
    resolveNovelaiSize,
    applyNovelaiPresets,
} from '../settings.js';
import {
    fetchWithTimeout,
    ProviderError,
    isRetryableHttpStatus,
} from '../utils.js';
import { buildFinalGenerationPrompt } from '../parser.js';
import { Provider, throwAsProviderError } from './base.js';

const NOVELAI_ANLAS_GUARD_MAX_PIXELS = 1024 * 1024;
const NOVELAI_ANLAS_GUARD_MAX_STEPS = 28;

export class NovelAIProvider extends Provider {
    get id() { return 'novelai'; }
    get displayName() { return 'NovelAI'; }

    get capabilities() {
        return {
            endpointPlaceholder: '',
            requiresApiKey: false,
            referencesMaxCount: 0,
            referencesFormat: 'none',
        };
    }

    validate(_settings) {
        return [];
    }

    supportsReferences() {
        return false;
    }

    async collectReferences() {
        return [];
    }

    async generate({ prompt, style, options = {} }) {
        const settings = getSettings();
        const { getRequestHeaders } = SillyTavern.getContext();

        let fullPrompt = buildFinalGenerationPrompt(prompt, style, options.matchedAdditionalRefs || [], settings);
        fullPrompt = applyNovelaiPresets(fullPrompt, settings);

        let { steps, width, height, sm, smDyn } = this._getParams(settings);

        iigLog(
            'INFO',
            `NovelAI generate: model=${settings.novelaiModel} ${width}x${height} steps=${steps} sampler=${settings.novelaiSampler} scheduler=${settings.novelaiScheduler} scale=${settings.novelaiScale} anlasGuard=${settings.novelaiAnlasGuard}`
        );

        const body = {
            prompt: fullPrompt,
            model: settings.novelaiModel,
            sampler: settings.novelaiSampler,
            scheduler: settings.novelaiScheduler,
            steps,
            scale: settings.novelaiScale,
            width,
            height,
            negative_prompt: settings.novelaiNegativePrompt || '',
            decrisper: settings.novelaiDecrisper,
            variety_boost: settings.novelaiVarietyBoost,
            sm,
            sm_dyn: smDyn,
            seed: -1,
        };

        let response;
        try {
            response = await fetchWithTimeout('/api/novelai/generate-image', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(body),
            }, 600_000, options.signal);
        } catch (error) {
            throwAsProviderError(error, 'NovelAI (ST proxy)', 'novelai');
        }

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new ProviderError({
                message: `NovelAI ${response.status}: ${String(text).slice(0, 800)}`,
                code: String(response.status),
                status: response.status,
                retryable: isRetryableHttpStatus(response.status),
                providerId: 'novelai',
            });
        }

        const base64 = await response.text();
        return `data:image/png;base64,${base64}`;
    }

    async fetchModels() {
        return NOVELAI_MODELS.map(m => m.value);
    }

    _getParams(settings) {
        let steps = Math.min(settings.novelaiSteps || 28, 50);
        const sizeEntry = resolveNovelaiSize(settings.novelaiSize);
        let width = sizeEntry.width;
        let height = sizeEntry.height;
        let sm = settings.novelaiSm || false;
        let smDyn = settings.novelaiSmDyn || false;

        if (settings.novelaiSampler === 'ddim'
            || ['nai-diffusion-4-curated-preview', 'nai-diffusion-4-full',
                'nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated'].includes(settings.novelaiModel)) {
            sm = false;
            smDyn = false;
        }

        if (!settings.novelaiAnlasGuard) {
            return { steps, width, height, sm, smDyn };
        }

        if (width * height > NOVELAI_ANLAS_GUARD_MAX_PIXELS) {
            const ratio = Math.sqrt(NOVELAI_ANLAS_GUARD_MAX_PIXELS / (width * height));
            let newWidth = Math.round(width * ratio);
            let newHeight = Math.round(height * ratio);
            newWidth -= newWidth % 64;
            newHeight -= newHeight % 64;
            while (newWidth * newHeight > NOVELAI_ANLAS_GUARD_MAX_PIXELS) {
                if (newWidth > newHeight) newWidth -= 64;
                else newHeight -= 64;
            }
            iigLog('INFO', `Anlas Guard: ${width}x${height} -> ${newWidth}x${newHeight}`);
            width = newWidth;
            height = newHeight;
        }

        if (steps > NOVELAI_ANLAS_GUARD_MAX_STEPS) {
            iigLog('INFO', `Anlas Guard: steps ${steps} -> ${NOVELAI_ANLAS_GUARD_MAX_STEPS}`);
            steps = NOVELAI_ANLAS_GUARD_MAX_STEPS;
        }

        return { steps, width, height, sm, smDyn };
    }
}
