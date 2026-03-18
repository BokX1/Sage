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

  it('uses AGENT_RUN_SLICE_MAX_STEPS default of 10 when not provided', async () => {
    await withEnv({ NODE_ENV: 'test' }, async () => {
      delete process.env.AGENT_RUN_SLICE_MAX_STEPS;
      const envModule = await importFresh(() => import('@/platform/config/env'));
      expect(envModule.config.AGENT_RUN_SLICE_MAX_STEPS).toBe(10);
    });
  });

  it('uses the scrape timeout default when not provided', async () => {
    await withEnv({ NODE_ENV: 'test' }, async () => {
      delete process.env.TOOL_WEB_SCRAPE_TIMEOUT_MS;
      const envModule = await importFresh(() => import('@/platform/config/env'));
      expect(envModule.config.TOOL_WEB_SCRAPE_TIMEOUT_MS).toBe(45000);
    });
  });

  it('uses the frontier-tuned prompt and closeout defaults when not provided', async () => {
    await withEnv({ NODE_ENV: 'test' }, async () => {
      delete process.env.PROMPT_TOOL_OBSERVATION_MAX_CHARS;
      delete process.env.AGENT_WINDOW_CLOSEOUT_MAX_OUTPUT_TOKENS;
      delete process.env.AGENT_WINDOW_CLOSEOUT_REQUEST_TIMEOUT_MS;
      const envModule = await importFresh(() => import('@/platform/config/env'));
      expect(envModule.config.PROMPT_TOOL_OBSERVATION_MAX_CHARS).toBe(48000);
      expect(envModule.config.AGENT_WINDOW_CLOSEOUT_MAX_OUTPUT_TOKENS).toBe(2400);
      expect(envModule.config.AGENT_WINDOW_CLOSEOUT_REQUEST_TIMEOUT_MS).toBe(20000);
    });
  });

  it('leaves AGENT_GRAPH_RECURSION_LIMIT unset when operators do not override it', async () => {
    await withEnv({ NODE_ENV: 'test' }, async () => {
      delete process.env.AGENT_GRAPH_RECURSION_LIMIT;
      const envModule = await importFresh(() => import('@/platform/config/env'));
      expect(envModule.config.AGENT_GRAPH_RECURSION_LIMIT).toBeUndefined();
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
      },
      async () => {
        const envModule = await importFresh(() => import('@/platform/config/env'));
        expect(envModule.config.CONTEXT_MAX_INPUT_TOKENS).toBe(16000);
        expect(envModule.config.CONTEXT_RESERVED_OUTPUT_TOKENS).toBe(4000);
      },
    );
  });
});
