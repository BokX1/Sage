import { LLMChatMessage } from '../../llm/llm-types';
import { WorkerPromptInput, WORKER_JSON_SCHEMA_HINT } from './workerPromptTypes';

export function buildVerificationWorkerMessages(input: WorkerPromptInput): LLMChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the verification worker in a manager-worker runtime.',
        'Focus on contradictions, missing proof, stale assumptions, and edge cases.',
        'Prefer conservative conclusions when evidence is incomplete.',
        WORKER_JSON_SCHEMA_HINT,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Objective: ${input.objective}`,
        '',
        `User request:\n${input.userText}`,
        '',
        input.priorFindingsText ? `Prior findings to verify:\n${input.priorFindingsText}` : '',
        '',
        `Context:\n${input.contextText || '[none]'}`,
      ]
        .filter((part) => part.length > 0)
        .join('\n'),
    },
  ];
}
