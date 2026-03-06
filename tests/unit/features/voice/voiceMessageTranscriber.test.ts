import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchDiscordAttachmentBytes, mockTranscribeWav } = vi.hoisted(() => ({
  mockFetchDiscordAttachmentBytes: vi.fn(),
  mockTranscribeWav: vi.fn(),
}));

vi.mock('@/platform/files/file-handler', () => ({
  fetchDiscordAttachmentBytes: mockFetchDiscordAttachmentBytes,
}));

vi.mock('@/features/voice/voiceServiceClient', () => ({
  transcribeWav: mockTranscribeWav,
}));

vi.mock('prism-media', async () => {
  const { Transform } = await import('stream');

  class MockOggDemuxer extends Transform {
    _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
      this.push(chunk);
      callback();
    }
  }

  class MockDecoder extends Transform {
    _transform(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
      // Push enough PCM to exceed a 1s budget (48kHz mono PCM16 ~= 96,000 bytes/s).
      this.push(Buffer.alloc(100_000));
      callback();
    }
  }

  return {
    default: {
      opus: {
        OggDemuxer: MockOggDemuxer,
        Decoder: MockDecoder,
      },
    },
  };
});

import { transcribeDiscordVoiceMessageAttachment } from '@/features/voice/voiceMessageTranscriber';

describe('voiceMessageTranscriber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fakeOggOpus = Buffer.concat([Buffer.from('OpusHead', 'ascii'), Buffer.from([1, 1, 0, 0])]);
    mockFetchDiscordAttachmentBytes.mockResolvedValue({
      kind: 'ok',
      buffer: fakeOggOpus,
      mimeType: 'audio/ogg',
      byteLength: fakeOggOpus.byteLength,
    });
    mockTranscribeWav.mockResolvedValue({ text: 'unused transcript' });
  });

  it('returns too_large when decoded PCM exceeds max duration', async () => {
    const result = await transcribeDiscordVoiceMessageAttachment({
      url: 'https://cdn.discordapp.com/voice.ogg',
      filename: 'voice.ogg',
      contentType: 'audio/ogg',
      declaredSizeBytes: 2048,
      durationSeconds: null,
      timeoutMs: 5_000,
      maxBytes: 1_000_000,
      maxSeconds: 1,
      maxChars: 2_000,
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'too_large',
        extractor: 'voice_stt',
      }),
    );
    expect(String((result as { message?: string }).message ?? '')).toContain('too long');
    expect(mockTranscribeWav).not.toHaveBeenCalled();
  });
});
