import { logger } from '../../platform/logging/logger';

const DEFAULT_FLORENCE_DTYPE = 'q4';
const CAPTION_TASK = '<MORE_DETAILED_CAPTION>';
const OCR_TASK = '<OCR>';
const CAPTION_MAX_NEW_TOKENS = 256;
const OCR_MAX_NEW_TOKENS = 512;

type FlorenceProcessor = {
  (image: unknown, text?: string | null, kwargs?: Record<string, unknown>): Promise<Record<string, unknown>>;
  batch_decode: (tokens: unknown, options?: Record<string, unknown>) => string[];
  post_process_generation: (
    text: string,
    task: string,
    imageSize: [number, number],
  ) => Record<string, unknown>;
};

type FlorenceModel = {
  generate: (inputs: Record<string, unknown>) => Promise<unknown>;
};

type FlorenceRuntime = {
  RawImage: {
    fromBlob: (blob: Blob) => Promise<{ width: number; height: number }>;
  };
  AutoProcessor: {
    from_pretrained: (modelId: string) => Promise<FlorenceProcessor>;
  };
  AutoModelForVision2Seq: {
    from_pretrained: (
      modelId: string,
      options?: Record<string, unknown>,
    ) => Promise<FlorenceModel>;
  };
};

type LoadedFlorenceRuntime = {
  modelId: string;
  processor: FlorenceProcessor;
  model: FlorenceModel;
  RawImage: FlorenceRuntime['RawImage'];
};

export type ImageAttachmentRecallResult = {
  text: string | null;
  summaryText: string;
  visibleText: string;
};

let loadedRuntimePromise: Promise<LoadedFlorenceRuntime> | null = null;
let loadedRuntimeModelId: string | null = null;
let runtimeLoaderOverride: (() => Promise<FlorenceRuntime>) | null = null;

function truncateInline(value: string, maxChars: number): string {
  const cap = Math.max(1, Math.floor(maxChars));
  if (value.length <= cap) return value;
  if (cap <= 3) return value.slice(0, cap);
  return `${value.slice(0, cap - 3).trimEnd()}...`;
}

function normalizeInlineWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeMultilineWhitespace(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function normalizeCaption(value: unknown): string {
  return typeof value === 'string' ? normalizeInlineWhitespace(value) : '';
}

function normalizeOcr(value: unknown): string {
  if (typeof value === 'string') {
    return normalizeMultilineWhitespace(value);
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '';
  }

  const labels = (value as { labels?: unknown }).labels;
  if (!Array.isArray(labels)) {
    return '';
  }

  const lines: string[] = [];
  for (const label of labels) {
    if (typeof label !== 'string') continue;
    const normalized = normalizeInlineWhitespace(label);
    if (!normalized) continue;
    if (lines.at(-1) === normalized) continue;
    lines.push(normalized);
  }

  return lines.join('\n');
}

function buildRecallText(summaryText: string, visibleText: string, maxChars: number): string | null {
  const summary = summaryText || '(unavailable)';
  const visible = visibleText || '(none)';

  const summaryPrefix = 'Image summary: ';
  const visiblePrefix = '\n\nVisible text: ';
  const minimumVisibleBudget = 16;
  const totalBudget = Math.max(200, Math.floor(maxChars));

  let boundedSummary = summary;
  let boundedVisible = visible;

  const fixedOverhead = summaryPrefix.length + visiblePrefix.length + minimumVisibleBudget;
  const summaryBudget = Math.max(48, Math.floor((totalBudget - fixedOverhead) * 0.6));
  boundedSummary = truncateInline(boundedSummary, summaryBudget);

  const visibleBudget =
    totalBudget - summaryPrefix.length - boundedSummary.length - visiblePrefix.length;
  boundedVisible = truncateInline(boundedVisible, Math.max(minimumVisibleBudget, visibleBudget));

  const built = `${summaryPrefix}${boundedSummary}${visiblePrefix}${boundedVisible}`.trim();
  return built.length > 0 ? truncateInline(built, totalBudget) : null;
}

async function loadFlorenceRuntime(modelId: string): Promise<LoadedFlorenceRuntime> {
  if (loadedRuntimePromise && loadedRuntimeModelId === modelId) {
    return loadedRuntimePromise;
  }

  loadedRuntimeModelId = modelId;
  loadedRuntimePromise = (async () => {
    logger.info({ modelId }, 'Loading local Florence image recall model');
    const runtime = runtimeLoaderOverride
      ? await runtimeLoaderOverride()
      : ((await import('@huggingface/transformers')) as unknown as FlorenceRuntime);
    const [processor, model] = await Promise.all([
      runtime.AutoProcessor.from_pretrained(modelId),
      runtime.AutoModelForVision2Seq.from_pretrained(modelId, {
        dtype: DEFAULT_FLORENCE_DTYPE,
      }),
    ]);
    logger.info({ modelId, dtype: DEFAULT_FLORENCE_DTYPE }, 'Local Florence image recall model loaded');
    return {
      modelId,
      processor,
      model,
      RawImage: runtime.RawImage,
    };
  })().catch((error) => {
    loadedRuntimePromise = null;
    loadedRuntimeModelId = null;
    throw error;
  });

  return loadedRuntimePromise;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        timeoutId.unref?.();
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function runFlorenceTask(params: {
  processor: FlorenceProcessor;
  model: FlorenceModel;
  image: { width: number; height: number };
  task: string;
  maxNewTokens: number;
}): Promise<unknown> {
  const inputs = await params.processor(params.image, params.task);
  const output = await params.model.generate({
    ...inputs,
    max_new_tokens: params.maxNewTokens,
  });
  const decoded = params.processor.batch_decode(output, { skip_special_tokens: false })[0] ?? '';
  return params.processor.post_process_generation(
    decoded,
    params.task,
    [params.image.height, params.image.width],
  )[params.task];
}

export async function summarizeImageAttachmentForRecall(params: {
  buffer: Buffer;
  contentType?: string | null;
  modelId: string;
  timeoutMs: number;
  maxChars: number;
}): Promise<ImageAttachmentRecallResult> {
  const runtime = await withTimeout(loadFlorenceRuntime(params.modelId), params.timeoutMs, 'Florence model load');
  const blob = new Blob([new Uint8Array(params.buffer)], {
    type: params.contentType?.trim() || 'application/octet-stream',
  });
  const image = await withTimeout(runtime.RawImage.fromBlob(blob), params.timeoutMs, 'Florence image decode');

  const [captionOutput, ocrOutput] = await withTimeout(
    Promise.all([
      runFlorenceTask({
        processor: runtime.processor,
        model: runtime.model,
        image,
        task: CAPTION_TASK,
        maxNewTokens: CAPTION_MAX_NEW_TOKENS,
      }),
      runFlorenceTask({
        processor: runtime.processor,
        model: runtime.model,
        image,
        task: OCR_TASK,
        maxNewTokens: OCR_MAX_NEW_TOKENS,
      }),
    ]),
    params.timeoutMs,
    'Florence inference',
  );

  const summaryText = normalizeCaption(captionOutput);
  const visibleText = normalizeOcr(ocrOutput);
  return {
    text: buildRecallText(summaryText, visibleText, params.maxChars),
    summaryText,
    visibleText,
  };
}

export function __resetImageAttachmentRecallModelForTests(): void {
  loadedRuntimePromise = null;
  loadedRuntimeModelId = null;
}

export function __setImageAttachmentRecallRuntimeLoaderForTests(
  loader: (() => Promise<FlorenceRuntime>) | null,
): void {
  runtimeLoaderOverride = loader;
  __resetImageAttachmentRecallModelForTests();
}
