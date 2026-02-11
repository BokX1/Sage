import { LLMChatMessage } from '../../llm/llm-types';
import { WorkerPromptInput, WORKER_JSON_SCHEMA_HINT } from './workerPromptTypes';

export function buildSynthesisWorkerMessages(input: WorkerPromptInput): LLMChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the synthesis worker in a manager-worker runtime.',
        'Merge findings into a concise, implementation-oriented synthesis.',
        'Respect unresolved uncertainty and call out risks.',
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
        input.priorFindingsText ? `Worker findings to synthesize:\n${input.priorFindingsText}` : '',
        '',
        `Context:\n${input.contextText || '[none]'}`,
      ]
        .filter((part) => part.length > 0)
        .join('\n'),
    },
  ];
}
