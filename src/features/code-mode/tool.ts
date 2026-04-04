import { z } from 'zod';
import { defineRuntimeToolSpec, type ToolExecutionContext } from '../agent-runtime/runtimeToolContract';
import { buildPromptCapabilityArgumentNotes } from '../agent-runtime/prompt';
import { executeCodeMode } from './executor';

const codeModeInputSchema = z.object({
  language: z.literal('javascript').default('javascript'),
  code: z.string().trim().min(1).max(120_000),
});

export const runtimeExecuteCodeTool = defineRuntimeToolSpec({
  name: 'runtime_execute_code',
  title: 'Runtime Execute Code',
  description:
    'Execute short JavaScript programs inside Sage Code Mode. Use this as the only execution surface for host capabilities. The code receives top-level bridge namespaces such as discord, history, context, artifacts, approvals, admin, moderation, schedule, http, and workspace. Code Mode uses scoped host bridge access, task-local workspaces, and a separate runner process, but it still should not be treated as a perfectly hardened system sandbox.',
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
      'Use this as Sage’s only host execution surface. Write short JavaScript against the injected bridge namespaces.',
    whenToUse: [
      'You need to inspect, transform, combine, or act on multiple host capabilities in one coherent step.',
      'You need to use namespaces like discord, history, context, artifacts, admin, moderation, schedule, http, or workspace from one program.',
    ],
    whenNotToUse: [
      'A plain assistant-text answer is enough and no execution is needed.',
      'The turn only needs a visible wait or cancel control rather than host execution.',
    ],
    argumentNotes: [
      'JavaScript code runs as an async function body and may end with return ... .',
      ...buildPromptCapabilityArgumentNotes(),
    ],
  },
  validationHint:
    'Pass { "language": "javascript", "code": "return await history.recent({ channelId: "123", limit: 5 });" }.',
  execute: async ({ language, code }, ctx: ToolExecutionContext) => {
    const result = await executeCodeMode({
      language,
      code,
      toolContext: ctx,
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
          : result.result &&
              typeof result.result === 'object' &&
              !Array.isArray(result.result) &&
              Array.isArray((result.result as { namespaces?: unknown }).namespaces)
            ? `Available bridge namespaces: ${((result.result as { namespaces: string[] }).namespaces).join(', ')}.`
            : `Code Mode executed ${result.bridgeCalls.length} bridge call(s) in ${result.language}.`,
      artifacts: result.artifacts,
    };
  },
});
