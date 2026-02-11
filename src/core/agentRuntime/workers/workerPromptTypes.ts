export interface WorkerPromptInput {
  userText: string;
  objective: string;
  contextText: string;
  priorFindingsText: string | null;
}

export const WORKER_JSON_SCHEMA_HINT = [
  'Return JSON only with this schema:',
  '{',
  '  "summary": "string",',
  '  "keyPoints": ["string"],',
  '  "openQuestions": ["string"],',
  '  "citations": ["string"],',
  '  "confidence": 0.0',
  '}',
].join('\n');
