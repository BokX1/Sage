import { globalToolRegistry, type ToolDefinition } from './toolRegistry';

export interface PromptToolGuidance {
  purpose?: string;
  decisionEdges: string[];
  antiPatterns?: string[];
  argumentNotes?: string[];
}

export type WebsiteToolCategory = 'discord' | 'search' | 'dev' | 'gen' | 'system';

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

type ToolDocOverride = {
  selectionHints?: string[];
  avoidWhen?: string[];
  promptGuidance?: PromptToolGuidance;
  websiteShort?: string;
  websiteDesc?: string;
  websiteCategory?: WebsiteToolCategory;
  websiteColor?: string;
};

function categoryColor(category: WebsiteToolCategory): string {
  switch (category) {
    case 'discord':
      return '#5865F2';
    case 'search':
      return '#0EA5E9';
    case 'dev':
      return '#10B981';
    case 'gen':
      return '#F59E0B';
    case 'system':
      return '#6B7280';
  }
}

function categoryForTool(toolName: string): WebsiteToolCategory {
  if (toolName.startsWith('discord_')) return 'discord';
  if (toolName.startsWith('web_') || toolName === 'wikipedia_search' || toolName === 'stack_overflow_search') {
    return 'search';
  }
  if (toolName.startsWith('mcp__github__') || toolName === 'npm_info') {
    return 'dev';
  }
  if (toolName.startsWith('image_')) return 'gen';
  return 'system';
}

function defaultShortName(tool: ToolDefinition<unknown>): string {
  return tool.title?.trim() || tool.name;
}

function defaultSelectionHints(tool: ToolDefinition<unknown>): string[] {
  const guidance = tool.prompt;
  const hints = [
    guidance?.summary,
    ...(guidance?.whenToUse ?? []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  if (hints.length > 0) {
    return hints;
  }

  return [tool.description];
}

const TOOL_DOC_OVERRIDES: Record<string, ToolDocOverride> = {
  web_search: {
    selectionHints: [
      'Use for current or open-web facts when you need recent sources or latest-state verification.',
      'Prefer this over Wikipedia when freshness matters.',
    ],
    avoidWhen: [
      'You already know the exact page to read.',
    ],
    promptGuidance: {
      purpose: 'Search the public web for recent facts and candidate sources.',
      decisionEdges: [
        'Fresh external facts -> web_search.',
        'Known exact page -> web_read or web_read_page instead.',
      ],
    },
  },
  web_read: {
    selectionHints: [
      'Use for a known exact page, especially when verifying current content or docs behavior at that URL.',
    ],
    avoidWhen: [
      'You still need discovery or source selection across the open web.',
    ],
    promptGuidance: {
      purpose: 'Verify or read the contents of one known page directly.',
      decisionEdges: [
        'Known current docs page or exact URL -> web_read.',
        'Need discovery across unknown sources -> web_search first.',
      ],
    },
  },
  web_extract: {
    selectionHints: [
      'Use for extracting exact current fields or behaviors from a known page without reading everything.',
    ],
    avoidWhen: [
      'You still need broad discovery or you only need a general page read.',
    ],
    promptGuidance: {
      purpose: 'Extract exact structured facts from one known page.',
      decisionEdges: [
        'Known page plus exact fields/behaviors -> web_extract.',
        'Known page but general reading -> web_read instead.',
      ],
    },
  },
  npm_info: {
    selectionHints: [
      'Use for current npm package metadata such as latest versions, dist-tags, maintainers, and repository links.',
    ],
    avoidWhen: [
      'You already know the repository and need exact source files rather than package-registry metadata.',
    ],
    promptGuidance: {
      purpose: 'Verify current npm package metadata instead of relying on stale package knowledge.',
      decisionEdges: [
        'Current package version or dist-tags -> npm_info.',
        'Exact repository source lookup -> direct GitHub tools instead.',
      ],
      antiPatterns: [
        'Avoid using npm_info as a substitute for exact repository code reads when the repo/path is already known.',
      ],
    },
  },
  web_research: {
    selectionHints: [
      'Use for one bounded search-plus-read research pass across a few sources.',
    ],
    avoidWhen: [
      'You only need one exact page.',
    ],
    promptGuidance: {
      purpose: 'Do bounded multi-source web research in one tool step.',
      decisionEdges: [
        'Multi-source synthesis in one step -> web_research.',
        'Single-page retrieval -> web_read or web_read_page instead.',
      ],
      antiPatterns: [
        'Avoid unbounded crawl loops when one bounded research pass is enough.',
      ],
    },
  },
  mcp__github__search_code: {
    selectionHints: [
      'Use when the repository path or file location is still unknown.',
      'If GitHub code search is denied for this request, stop retrying the same search blindly and pivot to an exact-file read or a clarification request.',
    ],
    avoidWhen: [
      'The exact owner/repo/path is already known.',
      'The same run already hit a GitHub code-search access failure for this request.',
    ],
    promptGuidance: {
      purpose: 'Find candidate files or symbols inside a known repository.',
      decisionEdges: [
        'Unknown path inside a repo -> mcp__github__search_code.',
        'Known exact path -> mcp__github__get_file_contents instead.',
      ],
      antiPatterns: [
        'Do not keep retrying GitHub code search after an unauthorized or forbidden result in the same run. Switch to exact-file reads, confirm access, or ask the user for repo/path clarification.',
      ],
    },
  },
  mcp__github__get_file_contents: {
    selectionHints: [
      'Use when you already know the repo and exact path.',
    ],
    avoidWhen: [
      'The path is still unknown.',
    ],
    promptGuidance: {
      purpose: 'Fetch one exact repository file.',
      decisionEdges: [
        'Known exact path -> mcp__github__get_file_contents.',
        'Unknown exact path -> mcp__github__search_code first.',
      ],
    },
  },
  discord_context_get_channel_summary: {
    selectionHints: [
      'Use for continuity and recap, not exact message proof.',
    ],
    avoidWhen: [
      'You need exact message-level evidence.',
    ],
  },
  discord_messages_search_history: {
    selectionHints: [
      'Use for exact message-history evidence in one channel.',
    ],
    avoidWhen: [
      'You only need high-level continuity or recap.',
    ],
  },
  discord_admin_update_server_instructions: {
    selectionHints: [
      'Use to change Sage’s guild persona or behavior instructions.',
    ],
    avoidWhen: [
      'You only need to read the current instructions.',
    ],
  },
  discord_admin_submit_moderation: {
    selectionHints: [
      'Use for moderation and enforcement requests, especially reply-targeted cleanup.',
    ],
    avoidWhen: [
      'You are changing Sage behavior or governance config rather than enforcing on content or users.',
    ],
  },
};

function buildPromptGuidance(tool: ToolDefinition<unknown>): PromptToolGuidance | undefined {
  const override = TOOL_DOC_OVERRIDES[tool.name]?.promptGuidance;
  if (override) {
    return override;
  }
  const prompt = tool.prompt;
  const decisionEdges = [...(prompt?.whenToUse ?? [])];
  const antiPatterns = prompt?.whenNotToUse ? [...prompt.whenNotToUse] : undefined;
  const argumentNotes = prompt?.argumentNotes ? [...prompt.argumentNotes] : undefined;

  if (!prompt?.summary && decisionEdges.length === 0 && !antiPatterns && !argumentNotes) {
    return undefined;
  }

  return {
    purpose: prompt?.summary,
    decisionEdges,
    antiPatterns,
    argumentNotes,
  };
}

function buildTopLevelDoc(tool: ToolDefinition<unknown>): TopLevelToolDoc {
  const override = TOOL_DOC_OVERRIDES[tool.name];
  const category = override?.websiteCategory ?? categoryForTool(tool.name);
  const short = override?.websiteShort ?? defaultShortName(tool);
  const desc = override?.websiteDesc ?? tool.description;

  return {
    tool: tool.name,
    purpose: tool.description,
    selectionHints: override?.selectionHints ?? defaultSelectionHints(tool),
    avoidWhen: override?.avoidWhen ?? tool.prompt?.whenNotToUse,
    promptGuidance: buildPromptGuidance(tool),
    validationHint: tool.validationHint,
    website: {
      name: tool.name,
      short,
      desc,
      cat: category,
      color: override?.websiteColor ?? categoryColor(category),
    },
    smoke: tool.smoke ?? { mode: 'skip', reason: 'No smoke metadata defined.' },
  };
}

function buildTopLevelToolDocs(): TopLevelToolDoc[] {
  return globalToolRegistry
    .listSpecs()
    .map((tool) => buildTopLevelDoc(tool))
    .sort((left, right) => left.tool.localeCompare(right.tool));
}

export function getTopLevelToolDoc(toolName: string): TopLevelToolDoc | null {
  return buildTopLevelToolDocs().find((doc) => doc.tool === toolName) ?? null;
}

export function listTopLevelToolDocs(): TopLevelToolDoc[] {
  return buildTopLevelToolDocs();
}

export function getPromptToolGuidance(toolName: string): PromptToolGuidance | null {
  return getTopLevelToolDoc(toolName)?.promptGuidance ?? null;
}

export function getToolValidationHint(toolName: string): string | undefined {
  return getTopLevelToolDoc(toolName)?.validationHint;
}

export function listSmokeToolDocs(): TopLevelToolDoc[] {
  return buildTopLevelToolDocs().filter((doc) => doc.smoke.mode !== 'skip');
}

export function buildWebsiteNativeTools(): WebsiteNativeToolRow[] {
  return buildTopLevelToolDocs().map((doc) => doc.website);
}
