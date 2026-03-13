import { describe, expect, it, vi } from 'vitest';
import { importFresh } from '../../../testkit/importFresh';
import { withEnv } from '../../../testkit/env';

describe('env embedding dimension guard', () => {
  it('accepts EMBEDDING_DIMENSIONS=256', async () => {
    await withEnv({ NODE_ENV: 'test', EMBEDDING_DIMENSIONS: '256' }, async () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as unknown as typeof process.exit);

      const envModule = await importFresh(() => import('@/platform/config/env'));
      expect(envModule.config.EMBEDDING_DIMENSIONS).toBe(256);
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  it('rejects EMBEDDING_DIMENSIONS values other than 256', async () => {
    await withEnv({ NODE_ENV: 'test', EMBEDDING_DIMENSIONS: '128' }, async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
        throw new Error(`process.exit:${code ?? ''}`);
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(importFresh(() => import('@/platform/config/env'))).rejects.toThrow(
        'process.exit:1',
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  it('uses AGENT_GRAPH_MAX_STEPS default of 6 when not provided', async () => {
    await withEnv({ NODE_ENV: 'test' }, async () => {
      delete process.env.AGENT_GRAPH_MAX_STEPS;
      const envModule = await importFresh(() => import('@/platform/config/env'));
      expect(envModule.config.AGENT_GRAPH_MAX_STEPS).toBe(6);
    });
  });

  it('uses lean defaults for tool result and scrape char caps', async () => {
    await withEnv({ NODE_ENV: 'test' }, async () => {
      delete process.env.AGENT_GRAPH_MAX_RESULT_CHARS;
      delete process.env.TOOL_WEB_SCRAPE_MAX_CHARS;
      const envModule = await importFresh(() => import('@/platform/config/env'));
      expect(envModule.config.AGENT_GRAPH_MAX_RESULT_CHARS).toBe(8000);
      expect(envModule.config.TOOL_WEB_SCRAPE_MAX_CHARS).toBe(20000);
    });
  });

  it('rejects blank AI provider chat model configuration', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        AI_PROVIDER_MAIN_AGENT_MODEL: '',
      },
      async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
          throw new Error(`process.exit:${code ?? ''}`);
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(importFresh(() => import('@/platform/config/env'))).rejects.toThrow(
          'process.exit:1',
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalled();
      },
    );
  });

  it('keeps configured context limits for explicitly configured AI provider models', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        AI_PROVIDER_MAIN_AGENT_MODEL: 'test-main-agent-model',
        CONTEXT_MAX_INPUT_TOKENS: '16000',
        CONTEXT_RESERVED_OUTPUT_TOKENS: '4000',
        CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT: '4000',
      },
      async () => {
        const envModule = await importFresh(() => import('@/platform/config/env'));
        expect(envModule.config.CONTEXT_MAX_INPUT_TOKENS).toBe(16000);
        expect(envModule.config.CONTEXT_RESERVED_OUTPUT_TOKENS).toBe(4000);
        expect(envModule.config.CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT).toBe(4000);
      },
    );
  });
});
