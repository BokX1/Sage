import { describe, it, expect, vi } from 'vitest';
import { governOutput } from '../../../src/core/orchestration/governor';

describe('Governor', () => {
  describe('governOutput', () => {
    it('should pass through clean text unchanged', async () => {
      const mockLLM = {
        chat: vi.fn(),
      };

      const result = await governOutput({
        traceId: 'test-trace',
        route: { kind: 'qa', experts: [], allowTools: true, temperature: 0.7 },
        draftText: 'This is a clean reply.',
        llm: mockLLM,
      });

      expect(result.finalText).toBe('This is a clean reply.');
      expect(result.actions).toHaveLength(0);
      expect(result.flagged).toBe(false);
    });

    it('should truncate text exceeding Discord length limit', async () => {
      const mockLLM = {
        chat: vi.fn(),
      };

      const longText = 'A'.repeat(2100);

      const result = await governOutput({
        traceId: 'test-trace',
        route: { kind: 'qa', experts: [], allowTools: true, temperature: 0.7 },
        draftText: longText,
        llm: mockLLM,
      });

      expect(result.finalText.length).toBeLessThanOrEqual(2000);
      expect(result.finalText).toContain('(truncated)');
      expect(result.actions).toContain('trim:discord_limit');
    });

    it('should detect banned phrases and attempt rewrite', async () => {
      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: 'Here is a clean rewritten version.',
        }),
      };

      const draftText = 'I found this by browsing the web for you.';

      const result = await governOutput({
        traceId: 'test-trace',
        route: { kind: 'qa', experts: [], allowTools: true, temperature: 0.7 },
        draftText,
        llm: mockLLM,
        rewriteEnabled: true,
      });

      expect(result.finalText).toBe('Here is a clean rewritten version.');
      expect(result.actions).toContain('rewrite:banned_phrase');
      expect(result.flagged).toBe(true);
      expect(mockLLM.chat).toHaveBeenCalled();
    });

    it('should use fallback trim if rewrite fails', async () => {
      const mockLLM = {
        chat: vi.fn().mockRejectedValue(new Error('LLM error')),
      };

      const draftText = 'I used a tool to search the web for this.';

      const result = await governOutput({
        traceId: 'test-trace',
        route: { kind: 'qa', experts: [], allowTools: true, temperature: 0.7 },
        draftText,
        llm: mockLLM,
        rewriteEnabled: true,
      });

      expect(result.finalText).toContain('[redacted]');
      expect(result.actions).toContain('fallback:rewrite_error');
      expect(result.flagged).toBe(true);
    });

    it('should skip rewrite if disabled', async () => {
      const mockLLM = {
        chat: vi.fn(),
      };

      const draftText = 'I found this by browsing.';

      const result = await governOutput({
        traceId: 'test-trace',
        route: { kind: 'qa', experts: [], allowTools: true, temperature: 0.7 },
        draftText,
        llm: mockLLM,
        rewriteEnabled: false,
      });

      expect(result.finalText).toBe(draftText);
      expect(result.flagged).toBe(true);
      expect(mockLLM.chat).not.toHaveBeenCalled();
    });

    it('should detect multiple banned phrase patterns', async () => {
      const mockLLM = {
        chat: vi.fn().mockResolvedValue({ content: 'Clean response' }),
      };

      const testCases = [
        'I will browse the web',
        'Using tools to find this',
        'Making an API call now',
        'Google search results show',
      ];

      for (const text of testCases) {
        vi.clearAllMocks();
        const result = await governOutput({
          traceId: 'test',
          route: { kind: 'qa', experts: [], allowTools: true, temperature: 0.7 },
          draftText: text,
          llm: mockLLM,
          rewriteEnabled: true,
        });

        expect(result.flagged).toBe(true);
      }
    });
  });
});
