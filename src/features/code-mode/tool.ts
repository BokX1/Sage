import { z } from 'zod';
import { defineToolSpecV2, type ToolExecutionContext } from '../agent-runtime/toolRegistry';
import { executeCodeMode } from './executor';

const codeModeInputSchema = z.object({
  language: z.literal('javascript').default('javascript'),
  code: z.string().trim().min(1).max(120_000),
});

export const runtimeExecuteCodeTool = defineToolSpecV2({
  name: 'runtime_execute_code',
  title: 'Runtime Execute Code',
  description:
    'Execute short JavaScript programs inside Sage Code Mode. Use this instead of calling many narrow tools directly. The code receives a host bridge named sage with sage.tool(name, args), sage.tools.list(), sage.http.fetch(...), and sage.workspace.* helpers. Code Mode uses scoped host bridge access, task-local workspaces, and a separate runner process, but it still should not be treated as a perfectly hardened system sandbox.',
  input: codeModeInputSchema,
  outputSchema: {
    type: 'object',
    properties: {
      language: { type: 'string' },
      executionId: { type: 'string' },
      taskId: { type: 'string' },
      result: {},
      stdout: { type: 'array', items: { type: 'string' } },
      stderr: { type: 'array', items: { type: 'string' } },
      bridgeCalls: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            operationKind: { type: 'string' },
            label: { type: 'string' },
            mutability: { type: 'string' },
            status: { type: 'string' },
            replayed: { type: 'boolean' },
          },
          required: ['index', 'operationKind', 'label', 'mutability', 'status', 'replayed'],
          additionalProperties: false,
        },
      },
      workspaceSummary: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          relativeRoot: { type: 'string' },
        },
        required: ['taskId', 'relativeRoot'],
        additionalProperties: false,
      },
    },
    required: ['language', 'executionId', 'taskId', 'stdout', 'stderr', 'bridgeCalls', 'workspaceSummary'],
    additionalProperties: true,
  },
  annotations: {
    openWorldHint: true,
  },
  runtime: {
    class: 'runtime',
    readOnly: false,
    observationPolicy: 'large',
    capabilityTags: ['code_mode_surface', 'code_mode'],
  },
  prompt: {
    summary:
      'Use this as Sage’s primary execution surface when you need host capabilities. Write short code against the sage bridge instead of calling many narrow tools directly.',
    whenToUse: [
      'You need to inspect, transform, combine, or act on multiple host capabilities in one coherent step.',
      'You need to call sage.tool(name, args), sage.http.fetch(...), or sage.workspace.* from a single program.',
    ],
    whenNotToUse: [
      'A plain assistant-text answer is enough and no execution is needed.',
      'You only need runtime_request_user_input or runtime_cancel_turn.',
    ],
    argumentNotes: [
      'JavaScript code runs as an async function body and may end with return ... .',
      'Use sage.tools.list() when you need to inspect the internal host bridge tool inventory.',
    ],
  },
  validationHint:
    'Pass { "language": "javascript", "code": "const tools = await sage.tools.list(); return tools;" }.',
  execute: async ({ language, code }, ctx: ToolExecutionContext) => {
    const result = await executeCodeMode({
      language,
      code,
      toolContext: ctx,
      accessibleToolNames: ctx.activeToolNames ?? [],
    });

    return {
      structuredContent: {
        language: result.language,
        executionId: result.executionId,
        taskId: result.taskId,
        result: result.result,
        stdout: result.stdout,
        stderr: result.stderr,
        bridgeCalls: result.bridgeCalls,
        workspaceSummary: result.workspaceSummary,
      },
      modelSummary:
        typeof result.result === 'string'
          ? result.result
          : `Code Mode executed ${result.bridgeCalls.length} bridge call(s) in ${result.language}.`,
      artifacts: result.artifacts,
    };
  },
});
