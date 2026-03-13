import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../../src/features/agent-runtime/defaultTools';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  // Sample tool schemas for testing
  const echoToolSchema = z.object({
    message: z.string().min(1),
  });

  const calcToolSchema = z.object({
    a: z.number(),
    b: z.number(),
    operation: z.enum(['add', 'subtract', 'multiply']),
  });

  beforeEach(() => {
    registry = new ToolRegistry();

    // Register test tools
    registry.register({
      name: 'echo',
      description: 'Echo a message back',
      schema: echoToolSchema,
      execute: async (args) => ({ echoed: args.message }),
    });

    registry.register({
      name: 'calc',
      description: 'Perform a calculation',
      schema: calcToolSchema,
      execute: async (args) => {
        switch (args.operation) {
          case 'add':
            return args.a + args.b;
          case 'subtract':
            return args.a - args.b;
          case 'multiply':
            return args.a * args.b;
        }
      },
    });
  });

  describe('allowlist validation', () => {
    it('should reject unknown tool names', () => {
      const result = registry.validateToolCall({
        name: 'unknown_tool',
        args: { foo: 'bar' },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Unknown tool');
        expect(result.error).toContain('unknown_tool');
        expect(result.error).toContain('Allowed tools');
      }
    });

    it('should list allowed tools in error message', () => {
      const result = registry.validateToolCall({
        name: 'not_registered',
        args: {},
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('echo');
        expect(result.error).toContain('calc');
      }
    });

    it('should accept registered tool names', () => {
      const result = registry.validateToolCall({
        name: 'echo',
        args: { message: 'hello' },
      });

      expect(result).toEqual({
        success: true,
        args: { message: 'hello' },
      });
    });
  });

  describe('schema validation', () => {
    it('should reject invalid args - missing required field', () => {
      const result = registry.validateToolCall({
        name: 'echo',
        args: {}, // missing 'message'
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid arguments');
        expect(result.error).toContain('echo');
      }
    });

    it('should reject invalid args - wrong type', () => {
      const result = registry.validateToolCall({
        name: 'calc',
        args: { a: 'not a number', b: 5, operation: 'add' },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid arguments');
      }
    });

    it('should reject invalid args - invalid enum value', () => {
      const result = registry.validateToolCall({
        name: 'calc',
        args: { a: 1, b: 2, operation: 'divide' }, // 'divide' not in enum
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid arguments');
      }
    });

    it('should accept valid args matching schema', () => {
      const result = registry.validateToolCall({
        name: 'calc',
        args: { a: 10, b: 5, operation: 'multiply' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args).toEqual({ a: 10, b: 5, operation: 'multiply' });
      }
    });


    it('should reject undefined top-level args safely', () => {
      const result = registry.validateToolCall({
        name: 'echo',
        args: undefined,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('must be JSON-serializable');
      }
    });

    it('should reject non-serializable args safely', () => {
      const circular: Record<string, unknown> = { message: 'hello' };
      circular.self = circular;

      const result = registry.validateToolCall({
        name: 'echo',
        args: circular,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('must be JSON-serializable');
      }
    });

    it('should reject args exceeding size limit', () => {
      // Create args that exceed the tool args guardrail.
      const largeString = 'x'.repeat(300_000);

      const result = registry.validateToolCall({
        name: 'echo',
        args: { message: largeString },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('exceed maximum size');
      }
    });
  });

  describe('tool execution', () => {
    it('should execute validated tool and return result', async () => {
      const ctx = { traceId: 'test', userId: 'u1', channelId: 'c1' };

      const result = await registry.executeValidated(
        { name: 'echo', args: { message: 'hello world' } },
        ctx,
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result).toEqual({ echoed: 'hello world' });
      }
    });

    it('should return error for invalid tool call during execution', async () => {
      const ctx = { traceId: 'test', userId: 'u1', channelId: 'c1' };

      const result = await registry.executeValidated({ name: 'unknown', args: {} }, ctx);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Unknown tool');
        expect(result.errorType).toBe('validation');
      }
    });

    it('adds missing-action repair guidance for routed tools', async () => {
      const runtimeRegistry = new ToolRegistry();
      registerDefaultAgenticTools(runtimeRegistry);

      const result = await runtimeRegistry.executeValidated(
        {
          name: 'github',
          args: { repo: 'openai/openai-node' },
        },
        { traceId: 'test', userId: 'u1', channelId: 'c1' },
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errorType).toBe('validation');
      expect(result.errorDetails?.repair).toMatchObject({
        tool: 'github',
        kind: 'missing_action',
      });
      expect(result.errorDetails?.repair?.suggestedActions).toContain('help');
      expect(result.errorDetails?.repair?.actionContract?.action).toBe('help');
    });

    it('adds unknown-action repair guidance with closest action suggestions', async () => {
      const runtimeRegistry = new ToolRegistry();
      registerDefaultAgenticTools(runtimeRegistry);

      const result = await runtimeRegistry.executeValidated(
        {
          name: 'github',
          args: { action: 'repo.gt', repo: 'openai/openai-node' },
        },
        { traceId: 'test', userId: 'u1', channelId: 'c1' },
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errorType).toBe('validation');
      expect(result.errorDetails?.repair).toMatchObject({
        tool: 'github',
        kind: 'unknown_action',
      });
      expect(result.errorDetails?.repair?.suggestedActions[0]).toBe('repo.get');
      expect(result.errorDetails?.repair?.actionContract?.action).toBe('repo.get');
    });

    it('avoids expensive fuzzy ranking for oversized unknown action strings', async () => {
      const runtimeRegistry = new ToolRegistry();
      registerDefaultAgenticTools(runtimeRegistry);
      const hugeAction = `repo.get${'x'.repeat(20_000)}`;

      const result = await runtimeRegistry.executeValidated(
        {
          name: 'github',
          args: { action: hugeAction, repo: 'openai/openai-node' },
        },
        { traceId: 'test', userId: 'u1', channelId: 'c1' },
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errorType).toBe('validation');
      expect(result.errorDetails?.repair).toMatchObject({
        tool: 'github',
        kind: 'unknown_action',
      });
      expect(result.errorDetails?.repair?.suggestedActions).toEqual(['repo.get']);
      expect(result.errorDetails?.repair?.actionContract?.action).toBe('repo.get');
    });

    it('adds invalid-action-payload repair guidance for known routed actions', async () => {
      const runtimeRegistry = new ToolRegistry();
      registerDefaultAgenticTools(runtimeRegistry);

      const result = await runtimeRegistry.executeValidated(
        {
          name: 'github',
          args: { action: 'repo.get' },
        },
        { traceId: 'test', userId: 'u1', channelId: 'c1' },
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errorType).toBe('validation');
      expect(result.errorDetails?.repair).toMatchObject({
        tool: 'github',
        kind: 'invalid_action_payload',
      });
      expect(result.errorDetails?.repair?.actionContract?.action).toBe('repo.get');
      expect(result.errorDetails?.repair?.actionContract?.requiredFields).toContain('repo');
    });

    it('keeps direct-tool validation hints without routed repair guidance', async () => {
      const runtimeRegistry = new ToolRegistry();
      registerDefaultAgenticTools(runtimeRegistry);

      const result = await runtimeRegistry.executeValidated(
        {
          name: 'npm_info',
          args: {},
        },
        { traceId: 'test', userId: 'u1', channelId: 'c1' },
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errorType).toBe('validation');
      expect(result.errorDetails?.hint).toContain('packageName');
      expect(result.errorDetails?.repair).toBeUndefined();
    });
  });

});
