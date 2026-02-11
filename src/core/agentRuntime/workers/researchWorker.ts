import { LLMChatMessage } from '../../llm/llm-types';
import { WorkerPromptInput, WORKER_JSON_SCHEMA_HINT } from './workerPromptTypes';

export function buildResearchWorkerMessages(input: WorkerPromptInput): LLMChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the research worker in a manager-worker runtime.',
        'Focus on extracting relevant facts, constraints, and source leads.',
        'Do not fabricate evidence.',
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
        input.priorFindingsText ? `Prior findings:\n${input.priorFindingsText}` : '',
        '',
        `Context:\n${input.contextText || '[none]'}`,
      ]
        .filter((part) => part.length > 0)
        .join('\n'),
    },
  ];
}
