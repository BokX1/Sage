import { ExpertPacket } from './expert-types';
import { LLMMessageContent, LLMChatMessage } from '../../llm/llm-types';
import { logger } from '../../../core/utils/logger';
import { getLLMClient } from '../../llm';
import { config } from '../../../config';

export interface ImageGenParams {
    userText: string;
    userContent?: LLMMessageContent;
    replyReferenceContent?: LLMMessageContent | null;
    conversationHistory?: LLMChatMessage[];
    apiKey?: string;
}

const IMAGE_REFINER_SYSTEM_PROMPT = `You are a Lead AI Art Director and Prompt Engineer.
Your task: Transform the user's request into a highly optimized image generation prompt.

Inputs:
1. User Request
2. Conversation Context (to resolve references like "it", "that", "her")
3. Reply Context (if user replied to a specific message)
4. Input Image (visual context - if present)

Instructions:
- **Dynamic Adaptation**: Match the user's goals. Do not force specific styles or quality keywords unless they fit the request.
- **Strict Intent**: Follow the user's intent 1:1. Do not censor or hallucinate constraints. If the user asks for specific content, ensure it is in the prompt.
- **Image Handling**: If an image is provided, use it as the base reference. If no image is provided, interpret the text request to the best of your ability.
- **Output**: Output ONLY the final English prompt text. No conversational filler.`;

const DEFAULT_IMAGE_GEN_TIMEOUT_MS = 180_000;
const IMAGE_ROUTE = '/image/{prompt}';

export function normalizeImageBaseUrl(baseUrl: string): string {
    let normalized = baseUrl.trim();
    if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    if (normalized.endsWith('/v1')) {
        normalized = normalized.slice(0, -3);
    }
    return normalized;
}

export function buildImageGenUrl(params: {
    baseUrl: string;
    prompt: string;
    model: string;
    seed: number;
    attachmentUrl?: string;
    apiKey?: string;
    includeApiKey?: boolean;
    width?: number;
    height?: number;
}): string {
    const {
        baseUrl,
        prompt,
        model,
        seed,
        attachmentUrl,
        apiKey,
        includeApiKey = true,
        width,
        height,
    } = params;
    const normalizedBaseUrl = normalizeImageBaseUrl(baseUrl);
    const encodedPrompt = encodeURIComponent(prompt);
    const url = new URL(`${normalizedBaseUrl}/image/${encodedPrompt}`);
    url.searchParams.set('model', model);
    url.searchParams.set('nologo', 'true');
    url.searchParams.set('seed', seed.toString());

    if (typeof width === 'number') {
        url.searchParams.set('width', width.toString());
    }

    if (typeof height === 'number') {
        url.searchParams.set('height', height.toString());
    }

    if (attachmentUrl) {
        url.searchParams.set('image', attachmentUrl);
    }

    if (includeApiKey && apiKey) {
        url.searchParams.set('key', apiKey);
    }

    return url.toString();
}

export function getImageExtensionFromContentType(contentType?: string | null): string | null {
    if (!contentType) return null;
    const normalized = contentType.split(';')[0]?.trim().toLowerCase();
    if (!normalized || !normalized.startsWith('image/')) return null;
    switch (normalized) {
        case 'image/jpeg':
        case 'image/jpg':
            return 'jpg';
        case 'image/png':
            return 'png';
        case 'image/webp':
            return 'webp';
        case 'image/gif':
            return 'gif';
        case 'image/bmp':
            return 'bmp';
        case 'image/svg+xml':
            return 'svg';
        default:
            return null;
    }
}

async function safeReadResponseText(response: Response): Promise<string | null> {
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const isTextual = contentType.includes('text') || contentType.includes('json');
    if (!isTextual) return null;
    try {
        const text = await response.text();
        const trimmed = text.trim();
        if (!trimmed) return null;
        const maxLength = 500;
        return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
    } catch {
        return null;
    }
}

export async function fetchWithTimeout(
    url: string,
    timeoutMs: number,
    fetcher: typeof fetch = fetch
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetcher(url, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function buildSafeFilename(prompt: string, seed: number, extension: string): string {
    const safePrompt = prompt.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
    return `sage_${safePrompt}_${seed}.${extension}`;
}

/**
 * Helper to extract text from content
 */
function extractText(content?: LLMMessageContent | null): string | undefined {
    if (!content) return undefined;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .filter(p => p.type === 'text')
            .map(p => p.text)
            .join(' ');
    }
    return undefined;
}

/**
 * Refine the user's prompt using an LLM (Gemini).
 */
async function refinePrompt(
    userText: string,
    history: LLMChatMessage[],
    apiKey?: string,
    imageUrl?: string,
    replyContext?: string
): Promise<string> {
    try {
        const client = getLLMClient();

        // Construct messages for Refiner
        // History: Last 10 messages
        const contextMessages = history.slice(-10);

        const messages: LLMChatMessage[] = [
            { role: 'system', content: IMAGE_REFINER_SYSTEM_PROMPT },
            ...contextMessages,
        ];

        // Inject Reply Context if strictly relevant
        if (replyContext) {
            messages.push({
                role: 'system',
                content: `CONTEXT: The user is replying to this message: "${replyContext}"`
            });
        }

        // Current user message
        if (imageUrl) {
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: `Request: ${userText}` },
                    { type: 'image_url', image_url: { url: imageUrl } }
                ]
            });
        } else {
            messages.push({
                role: 'user',
                content: `Request: ${userText}`
            });
        }

        const response = await client.chat({
            messages,
            model: 'gemini-fast', // Explicitly use Gemini Fast for reasoning/vision
            temperature: 1.2, // High creativity
            maxTokens: 1000,
            apiKey,
        });

        const refined = response.content.trim();
        logger.debug(
            { replyContext: !!replyContext, originalLength: userText.length, refinedLength: refined.length },
            '[ImageGen] Prompt refined'
        );
        return refined;
    } catch (error) {
        logger.warn({ error }, '[ImageGen] Refiner failed, falling back to raw prompt');
        return userText;
    }
}

/**
 * Image Generation Expert
 * 
 * Responsibilities:
 * 1. Gather context (text + images)
 * 2. Refine prompt via LLM
 * 3. Fetch image bytes from Pollinations (flux/klein)
 */
export async function runImageGenExpert(params: ImageGenParams): Promise<ExpertPacket> {
    const { userText, userContent, replyReferenceContent, conversationHistory = [], apiKey } = params;

    try {
        // 1. Resolve Attachment (Priority: Direct > Reply)
        // NO Fallback to History.
        let attachmentUrl: string | undefined;

        // A. Direct Attachment (Current Message)
        if (Array.isArray(userContent)) {
            const img = userContent.find(p => p.type === 'image_url');
            if (img && img.type === 'image_url') attachmentUrl = img.image_url.url;
        }

        // B. Reply Attachment (Explicit Reference)
        if (!attachmentUrl && replyReferenceContent && Array.isArray(replyReferenceContent)) {
            const img = replyReferenceContent.find(p => p.type === 'image_url');
            if (img && img.type === 'image_url') attachmentUrl = img.image_url.url;
        }

        // Extract Reply Text Context (even if no image)
        const replyText = extractText(replyReferenceContent);

        // 2. Refine Prompt
        const prompt = await refinePrompt(userText, conversationHistory, apiKey, attachmentUrl, replyText);

        // 3. Construct URL
        const imageBaseUrl = normalizeImageBaseUrl(
            config.LLM_IMAGE_BASE_URL || config.LLM_BASE_URL
        );
        const model = 'klein-large';
        const seed = Math.floor(Math.random() * 1_000_000);
        const url = buildImageGenUrl({
            baseUrl: imageBaseUrl,
            prompt,
            model,
            seed,
            attachmentUrl,
            apiKey,
            includeApiKey: true
        });
        const logUrl = buildImageGenUrl({
            baseUrl: imageBaseUrl,
            prompt,
            model,
            seed,
            attachmentUrl,
            includeApiKey: false
        });

        logger.info(
            {
                route: IMAGE_ROUTE,
                model,
                seed,
                hasAttachment: !!attachmentUrl,
                imageBaseUrl,
                promptLength: prompt.length,
                timeoutMs: DEFAULT_IMAGE_GEN_TIMEOUT_MS
            },
            '[ImageGen] Fetching image...'
        );

        // 4. Fetch Image Bytes with retries for transient failures
        const MAX_RETRIES = 2;
        const RETRY_DELAY_MS = 1000;
        let response: Response | undefined;
        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                response = await fetchWithTimeout(url, DEFAULT_IMAGE_GEN_TIMEOUT_MS);

                // Check for transient server errors (5xx) - retry those
                if (response.status >= 500 && attempt < MAX_RETRIES) {
                    logger.warn(
                        { status: response.status, attempt },
                        '[ImageGen] Server error, retrying...'
                    );
                    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
                    continue;
                }

                break; // Success or non-retryable error
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                if (lastError.name === 'AbortError') {
                    throw new Error(
                        `Pollinations image request timed out after ${DEFAULT_IMAGE_GEN_TIMEOUT_MS}ms. Please try again.`
                    );
                }

                // Retry network errors
                if (attempt < MAX_RETRIES) {
                    logger.warn(
                        { error: lastError.message, attempt },
                        '[ImageGen] Network error, retrying...'
                    );
                    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
                    continue;
                }

                throw new Error(
                    `Pollinations image request failed after ${MAX_RETRIES + 1} attempts. (${lastError.message})`
                );
            }
        }

        if (!response) {
            throw new Error(
                `Pollinations image request failed. Check network connectivity and try again. (${lastError?.message ?? 'Unknown error'})`
            );
        }

        if (!response.ok) {
            const errText = await safeReadResponseText(response);
            const details = errText ? ` Response: ${errText}` : '';
            throw new Error(
                `Pollinations image request failed with status ${response.status} ${response.statusText}.${details}`
            );
        }

        let arrayBuffer: ArrayBuffer;
        try {
            arrayBuffer = await response.arrayBuffer();
        } catch (error) {
            throw new Error(
                `Pollinations image response could not be read. Please retry. (${String(
                    error instanceof Error ? error.message : error
                )})`
            );
        }
        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
            throw new Error('Pollinations image response was empty. Please retry.');
        }

        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type');
        const extension = getImageExtensionFromContentType(contentType) ?? 'bin';
        const filename = buildSafeFilename(prompt, seed, extension);
        const mimetype = contentType?.split(';')[0]?.trim() || 'application/octet-stream';

        return {
            name: 'ImageGenerator',
            content: `[ImageGen] IMAGE GENERATED SUCCESSFULLY.
SYSTEM INSTRUCTION: The image is ALREADY ATTACHED to this message.
CRITICAL: Do **NOT** output any JSON. Do **NOT** verify the action.
Your ONLY job is to assume the persona and narrate the image to the user.
Example: "Here is your cyberpunk masterpiece."
NOT: "{ action: ... }"`,
            binary: {
                data: buffer,
                filename,
                mimetype
            },
            // Do not put binary in json to avoid clogging traces
            json: {
                originalPrompt: userText,
                refinedPrompt: prompt,
                model,
                seed,
                hasAttachment: !!attachmentUrl,
                url: logUrl
            }
        };

    } catch (error) {
        logger.error({ error }, '[ImageGen] Failed to generate image');
        return {
            name: 'ImageGenerator',
            content: `[ImageGenerator] Failed to generate image: ${error instanceof Error ? error.message : String(error)}`,
            tokenEstimate: 20
        };
    }
}
