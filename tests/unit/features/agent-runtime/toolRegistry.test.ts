import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { defineToolSpecV2, ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
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
        expect(result.result).toEqual({
          structuredContent: { echoed: 'hello world' },
          modelSummary: JSON.stringify({ echoed: 'hello world' }),
        });
      }
    });

    it('rejects successful tool outputs that violate declared outputSchema', async () => {
      const runtimeRegistry = new ToolRegistry();
      runtimeRegistry.register(
        defineToolSpecV2({
          name: 'schema_checked',
          description: 'Returns a validated payload.',
          input: z.object({}),
          outputSchema: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
            },
            required: ['ok'],
            additionalProperties: false,
          },
          runtime: {
            class: 'query',
            readOnly: true,
            capabilityTags: ['system'],
          },
          prompt: {
            summary: 'Return a schema-checked payload.',
          },
          execute: async () => ({
            structuredContent: { nope: true },
          }),
        }),
      );

      const result = await runtimeRegistry.executeValidated(
        { name: 'schema_checked', args: {} },
        { traceId: 'test', userId: 'u1', channelId: 'c1' },
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errorType).toBe('execution');
      expect(result.error).toContain('did not match its output schema');
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

    it('keeps direct-tool validation hints for granular tool definitions', async () => {
      const runtimeRegistry = new ToolRegistry();
      registerDefaultAgenticTools(runtimeRegistry);

      const result = await runtimeRegistry.executeValidated(
        {
          name: 'github_get_repo',
          args: {},
        },
        { traceId: 'test', userId: 'u1', channelId: 'c1' },
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errorType).toBe('validation');
      expect(result.errorDetails?.hint).toContain('owner/name');
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
    });
  });

  describe('action policy resolution', () => {
    it('classifies granular Discord writes explicitly without requiring approval', async () => {
      const runtimeRegistry = new ToolRegistry();
      registerDefaultAgenticTools(runtimeRegistry);

      const result = await runtimeRegistry.resolveActionPolicy(
        {
          name: 'discord_messages_create_poll',
          args: {
            action: 'create_poll',
            question: 'hello from Sage',
            answers: ['A', 'B'],
          },
        },
        { traceId: 'test', userId: 'u1', channelId: 'c1' },
      );

      expect(result).not.toBeNull();
      expect(result?.policy).toMatchObject({
        mutability: 'write',
        approvalMode: 'none',
      });
    });

    it('keeps admin-only Discord reads on the read path', async () => {
      const runtimeRegistry = new ToolRegistry();
      registerDefaultAgenticTools(runtimeRegistry);

      const serverRead = await runtimeRegistry.resolveActionPolicy(
        {
          name: 'discord_server_list_members',
          args: {
            action: 'list_members',
          },
        },
        { traceId: 'test', userId: 'u1', channelId: 'c1' },
      );

      const adminRead = await runtimeRegistry.resolveActionPolicy(
        {
          name: 'discord_admin_get_server_key_status',
          args: {
            action: 'get_server_key_status',
          },
        },
        { traceId: 'test', userId: 'u1', channelId: 'c1' },
      );

      expect(serverRead).not.toBeNull();
      expect(serverRead?.policy).toMatchObject({
        mutability: 'read',
        approvalMode: 'none',
      });
      expect(adminRead).not.toBeNull();
      expect(adminRead?.policy).toMatchObject({
        mutability: 'read',
        approvalMode: 'none',
      });
    });
  });

});
