import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../../src/core/agentRuntime/toolRegistry';

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

      expect(result.success).toBe(true);
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

    it('should reject args exceeding size limit', () => {
      // Create args that exceed 10KB
      const largeString = 'x'.repeat(15_000);

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
      }
    });
  });

  describe('OpenAI tool specs', () => {
    it('should generate valid OpenAI-compatible tool specs', () => {
      const specs = registry.listOpenAIToolSpecs();

      expect(specs).toHaveLength(2);
      expect(specs[0].type).toBe('function');
      expect(specs.map((s) => s.function.name)).toContain('echo');
      expect(specs.map((s) => s.function.name)).toContain('calc');
    });
  });
});
