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

  it('uses the aggressive frontier research runtime defaults when not provided', async () => {
    await withEnv({ NODE_ENV: 'test' }, async () => {
      delete process.env.AGENT_RUN_SLICE_MAX_STEPS;
      delete process.env.AGENT_RUN_TOOL_TIMEOUT_MS;
      delete process.env.AGENT_RUN_SLICE_MAX_DURATION_MS;
      delete process.env.AGENT_GRAPH_MAX_OUTPUT_TOKENS;
      delete process.env.AGENT_RUN_COMPACTION_TRIGGER_EST_TOKENS;
      delete process.env.AGENT_RUN_COMPACTION_TRIGGER_ROUNDS;
      delete process.env.AGENT_RUN_COMPACTION_TRIGGER_TOOL_RESULTS;
      delete process.env.AGENT_RUN_COMPACTION_MAX_RAW_MESSAGES;
      delete process.env.AGENT_RUN_COMPACTION_MAX_TOOL_OBSERVATIONS;
      delete process.env.AGENT_GRAPH_MAX_TOOL_CALLS_PER_ROUND;
      delete process.env.AGENT_GRAPH_MAX_IDENTICAL_TOOL_BATCHES;
      delete process.env.AGENT_GRAPH_MAX_LOOP_GUARD_RECOVERIES;
      delete process.env.CONTEXT_MAX_INPUT_TOKENS;
      delete process.env.CONTEXT_RESERVED_OUTPUT_TOKENS;
      delete process.env.CHAT_MAX_OUTPUT_TOKENS;
      delete process.env.TOOL_WEB_SEARCH_TIMEOUT_MS;
      delete process.env.TOOL_WEB_SCRAPE_TIMEOUT_MS;
      const envModule = await importFresh(() => import('@/platform/config/env'));
      expect(envModule.config.AGENT_RUN_SLICE_MAX_STEPS).toBe(14);
      expect(envModule.config.AGENT_RUN_TOOL_TIMEOUT_MS).toBe(75000);
      expect(envModule.config.AGENT_RUN_SLICE_MAX_DURATION_MS).toBe(180000);
      expect(envModule.config.AGENT_GRAPH_MAX_OUTPUT_TOKENS).toBe(6000);
      expect(envModule.config.AGENT_RUN_COMPACTION_TRIGGER_EST_TOKENS).toBe(100000);
      expect(envModule.config.AGENT_RUN_COMPACTION_TRIGGER_ROUNDS).toBe(8);
      expect(envModule.config.AGENT_RUN_COMPACTION_TRIGGER_TOOL_RESULTS).toBe(32);
      expect(envModule.config.AGENT_RUN_COMPACTION_MAX_RAW_MESSAGES).toBe(32);
      expect(envModule.config.AGENT_RUN_COMPACTION_MAX_TOOL_OBSERVATIONS).toBe(16);
      expect(envModule.config.AGENT_GRAPH_MAX_TOOL_CALLS_PER_ROUND).toBe(14);
      expect(envModule.config.AGENT_GRAPH_MAX_IDENTICAL_TOOL_BATCHES).toBe(4);
      expect(envModule.config.AGENT_GRAPH_MAX_LOOP_GUARD_RECOVERIES).toBe(4);
      expect(envModule.config.CONTEXT_MAX_INPUT_TOKENS).toBe(180000);
      expect(envModule.config.CONTEXT_RESERVED_OUTPUT_TOKENS).toBe(6000);
      expect(envModule.config.CHAT_MAX_OUTPUT_TOKENS).toBe(6000);
      expect(envModule.config.TOOL_WEB_SEARCH_TIMEOUT_MS).toBe(60000);
      expect(envModule.config.TOOL_WEB_SCRAPE_TIMEOUT_MS).toBe(75000);
    });
  });

  it('uses the frontier-tuned prompt and closeout defaults when not provided', async () => {
    await withEnv({ NODE_ENV: 'test' }, async () => {
      delete process.env.AGENT_WINDOW_CLOSEOUT_MAX_OUTPUT_TOKENS;
      delete process.env.AGENT_WINDOW_CLOSEOUT_REQUEST_TIMEOUT_MS;
      const envModule = await importFresh(() => import('@/platform/config/env'));
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
