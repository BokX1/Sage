export interface PromptToolGuidance {
  purpose?: string;
  decisionEdges: string[];
  antiPatterns?: string[];
  argumentNotes?: string[];
}

export type WebsiteToolCategory = 'system';

export interface WebsiteNativeToolRow {
  name: string;
  short: string;
  desc: string;
  cat: WebsiteToolCategory;
  color: string;
}

export interface ToolSmokeDoc {
  mode: 'required' | 'optional' | 'skip';
  args?: Record<string, unknown>;
  reason?: string;
}

export interface TopLevelToolDoc {
  tool: string;
  purpose: string;
  selectionHints: string[];
  avoidWhen?: string[];
  promptGuidance?: PromptToolGuidance;
  validationHint?: string;
  website: WebsiteNativeToolRow;
  smoke: ToolSmokeDoc;
}

const CODE_MODE_DOC: TopLevelToolDoc = {
  tool: 'runtime_execute_code',
  purpose: 'Run short JavaScript programs against Sage’s direct bridge namespaces.',
  selectionHints: [
    'Use as Sage’s only host execution surface when the task needs reads, writes, HTTP, or workspace state.',
    'Prefer one short deterministic program over long narrated plans or multi-step tool orchestration.',
  ],
  avoidWhen: [
    'A direct assistant-text answer is enough and no execution is needed.',
    'You only need the runtime to wait for user input or cancel the turn.',
  ],
  promptGuidance: {
    purpose: 'Run short JavaScript against direct bridge namespaces such as discord, history, context, artifacts, approvals, admin, moderation, schedule, http, and workspace.',
    decisionEdges: [
      'Need host-backed reads or writes -> runtime_execute_code.',
      'Need outbound fetch -> runtime_execute_code with http.fetch(...).',
      'Need task-local files -> runtime_execute_code with workspace.*.',
      'No execution needed -> answer directly in assistant text.',
    ],
    antiPatterns: [
      'Do not invent a generic dispatch helper or search for hidden tool names.',
      'Do not narrate a long plan when one short program can verify or perform the work directly.',
    ],
    argumentNotes: [
      'Use top-level namespaces directly, for example discord.messages.send(...), history.search(...), context.summary.get(...), admin.instructions.update(...).',
      'There is no sage.* root object and no tool-discovery fallback.',
    ],
  },
  validationHint: 'Pass { "language": "javascript", "code": "return await history.recent({ channelId: \\"123\\", limit: 5 });" }.',
  website: {
    name: 'runtime_execute_code',
    short: 'Runtime Execute Code',
    desc: 'Run short JavaScript against direct bridge namespaces for Discord, history, context, admin, moderation, scheduling, HTTP, and workspace access.',
    cat: 'system',
    color: '#6B7280',
  },
  smoke: { mode: 'skip', reason: 'Code Mode behavior is covered by execution tests rather than registry smoke args.' },
};

export function getTopLevelToolDoc(toolName: string): TopLevelToolDoc | null {
  return toolName === CODE_MODE_DOC.tool ? CODE_MODE_DOC : null;
}

export function listTopLevelToolDocs(): TopLevelToolDoc[] {
  return [CODE_MODE_DOC];
}

export function getPromptToolGuidance(toolName: string): PromptToolGuidance | null {
  return getTopLevelToolDoc(toolName)?.promptGuidance ?? null;
}

export function getToolValidationHint(toolName: string): string | undefined {
  return getTopLevelToolDoc(toolName)?.validationHint;
}

export function listSmokeToolDocs(): TopLevelToolDoc[] {
  return listTopLevelToolDocs().filter((doc) => doc.smoke.mode !== 'skip');
}

export function buildWebsiteNativeTools(): WebsiteNativeToolRow[] {
  return listTopLevelToolDocs().map((doc) => doc.website);
}
