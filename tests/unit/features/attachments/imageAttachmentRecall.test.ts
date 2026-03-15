import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetImageAttachmentRecallModelForTests,
  __setImageAttachmentRecallRuntimeLoaderForTests,
  summarizeImageAttachmentForRecall,
} from '@/features/attachments/imageAttachmentRecall';

const mockRawImageFromBlob = vi.fn();
const mockProcessorFromPretrained = vi.fn();
const mockModelFromPretrained = vi.fn();

describe('imageAttachmentRecall', () => {
  beforeEach(() => {
    __resetImageAttachmentRecallModelForTests();
    __setImageAttachmentRecallRuntimeLoaderForTests(async () => ({
      RawImage: {
        fromBlob: mockRawImageFromBlob,
      },
      AutoProcessor: {
        from_pretrained: mockProcessorFromPretrained,
      },
      AutoModelForImageTextToText: {
        from_pretrained: mockModelFromPretrained,
      },
    }));
    vi.useRealTimers();
    mockRawImageFromBlob.mockReset();
    mockProcessorFromPretrained.mockReset();
    mockModelFromPretrained.mockReset();
  });

  afterEach(() => {
    __setImageAttachmentRecallRuntimeLoaderForTests(null);
  });

  it('combines Florence caption and OCR into bounded recall text', async () => {
    const processor = Object.assign(
      vi.fn(async (_image: unknown, task?: string | null) => ({ task })),
      {
        batch_decode: vi.fn((value: unknown) => [String(value)]),
        post_process_generation: vi.fn((_decoded: string, task: string) => ({
          [task]:
            task === '<MORE_DETAILED_CAPTION>'
              ? 'crowded reaction meme with a cat pointing at text'
              : { labels: ['TOP TEXT', 'BOTTOM TEXT'] },
        })),
      },
    );
    const model = {
      generate: vi.fn(async (inputs: Record<string, unknown>) =>
        Number(inputs.max_new_tokens) === 256 ? 'caption tokens' : 'ocr tokens',
      ),
    };

    mockRawImageFromBlob.mockResolvedValue({ width: 640, height: 480 });
    mockProcessorFromPretrained.mockResolvedValue(processor);
    mockModelFromPretrained.mockResolvedValue(model);

    const result = await summarizeImageAttachmentForRecall({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'image/png',
      modelId: 'onnx-community/Florence-2-large-ft',
      timeoutMs: 1_000,
    });

    expect(result.summaryText).toBe('crowded reaction meme with a cat pointing at text');
    expect(result.visibleText).toBe('TOP TEXT\nBOTTOM TEXT');
    expect(result.text).toContain('Image summary: crowded reaction meme with a cat pointing at text');
    expect(result.text).toContain('Visible text: TOP TEXT\nBOTTOM TEXT');
    expect(model.generate).toHaveBeenCalledTimes(2);
  });

  it('times out cleanly when the Florence runtime does not finish loading', async () => {
    vi.useFakeTimers();
    mockProcessorFromPretrained.mockImplementation(() => new Promise(() => undefined));
    mockModelFromPretrained.mockImplementation(() => new Promise(() => undefined));

    const promise = summarizeImageAttachmentForRecall({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'image/png',
      modelId: 'onnx-community/Florence-2-large-ft',
      timeoutMs: 25,
    });
    const expectation = expect(promise).rejects.toThrow('Florence model load timed out');

    await vi.advanceTimersByTimeAsync(30);
    await expectation;
  });

  it('retries Florence loading after a prior load timeout', async () => {
    vi.useFakeTimers();
    let shouldHang = true;
    const processor = Object.assign(
      vi.fn(async (_image: unknown, task?: string | null) => ({ task })),
      {
        batch_decode: vi.fn((value: unknown) => [String(value)]),
        post_process_generation: vi.fn((_decoded: string, task: string) => ({
          [task]: task === '<MORE_DETAILED_CAPTION>' ? 'retry caption' : { labels: ['retry text'] },
        })),
      },
    );
    const model = {
      generate: vi.fn(async (inputs: Record<string, unknown>) =>
        Number(inputs.max_new_tokens) === 256 ? 'caption tokens' : 'ocr tokens',
      ),
    };

    mockRawImageFromBlob.mockResolvedValue({ width: 640, height: 480 });
    mockProcessorFromPretrained.mockImplementation(async () => {
      if (shouldHang) {
        return await new Promise(() => undefined);
      }
      return processor;
    });
    mockModelFromPretrained.mockImplementation(async () => {
      if (shouldHang) {
        return await new Promise(() => undefined);
      }
      return model;
    });

    const firstAttempt = summarizeImageAttachmentForRecall({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'image/png',
      modelId: 'onnx-community/Florence-2-large-ft',
      timeoutMs: 25,
    });
    const firstExpectation = expect(firstAttempt).rejects.toThrow('Florence model load timed out');

    await vi.advanceTimersByTimeAsync(30);
    await firstExpectation;

    shouldHang = false;
    vi.useRealTimers();

    await expect(
      summarizeImageAttachmentForRecall({
        buffer: Buffer.from([1, 2, 3]),
        contentType: 'image/png',
        modelId: 'onnx-community/Florence-2-large-ft',
        timeoutMs: 250,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        summaryText: 'retry caption',
        visibleText: 'retry text',
      }),
    );

    expect(mockProcessorFromPretrained).toHaveBeenCalledTimes(2);
    expect(mockModelFromPretrained).toHaveBeenCalledTimes(2);
  });
});
