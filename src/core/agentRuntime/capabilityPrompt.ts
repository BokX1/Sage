import { DISCORD_ACTION_CATALOG, formatDiscordGuardrailsLines } from './discordToolCatalog';

export interface BuildCapabilityPromptSectionParams {
  activeTools?: string[];
  model?: string | null;
  invokedBy?: string | null;
  invokerIsAdmin?: boolean;
  inGuild?: boolean;
  toolLoopLimits?: {
    maxRounds: number;
    maxCallsPerRound: number;
    parallelReadOnlyTools: boolean;
    maxParallelReadOnlyTools: number;
  };
}

function formatListLine(values: string[]): string {
  if (values.length === 0) return 'none';
  return values.join(', ');
}

/**
 * Build a compact machine-readable agent state JSON.
 *
 * This is embedded as a structured block inside the consolidated
 * capability prompt so the model can reference exact capabilities.
 *
 * @returns XML-wrapped JSON block.
 */
export function buildAgenticStateBlock(params: BuildCapabilityPromptSectionParams): string {
  const activeTools =
    params.activeTools?.map((tool) => tool.trim()).filter((tool) => tool.length > 0) ?? [];
  const hasDiscordTool = activeTools.includes('discord');
  const state = {
    architecture: 'single_agent',
    orchestrator: 'runtime_assistant',
    current_time_utc: new Date().toISOString(),
    model: params.model?.trim() || null,
    tools_available: activeTools,
    invoked_by: params.invokedBy ?? null,
    invoker_is_admin: params.invokerIsAdmin ?? null,
    in_guild: params.inGuild ?? null,
    tool_loop_limits: params.toolLoopLimits ?? null,
    tool_capabilities: hasDiscordTool
      ? {
        discord: {
          read_only_actions: [...DISCORD_ACTION_CATALOG.read_only],
          write_actions: [...DISCORD_ACTION_CATALOG.writes],
          admin_only_actions: [...DISCORD_ACTION_CATALOG.admin_only],
        },
      }
      : null,
  };

  return ['<agent_state>', JSON.stringify(state, null, 2), '</agent_state>'].join('\n');
}

/**
 * Build the consolidated capability prompt section.
 *
 * Merges execution rules, tool selection guidance, and reasoning protocol
 * into a single <agent_config> block. This eliminates the previous duplication
 * between execution_rules and agent_state blocks.
 *
 * @returns XML-wrapped agent configuration prompt.
 */
export function buildCapabilityPromptSection(
  params: BuildCapabilityPromptSectionParams,
): string {
  const normalizedTools =
    params.activeTools?.map((tool) => tool.trim()).filter((tool) => tool.length > 0) ?? [];
  const activeToolLine = formatListLine(normalizedTools);
  const hasDiscordTool = normalizedTools.includes('discord');
  const hasGenerateImage = normalizedTools.includes('image_generate');

  // --- Invocation context ---
  const invocationParts: string[] = [];
  if (params.invokedBy) invocationParts.push(`invokedBy=${params.invokedBy}`);
  if (params.inGuild !== undefined) invocationParts.push(`inGuild=${params.inGuild}`);
  if (params.invokerIsAdmin !== undefined) invocationParts.push(`invokerIsAdmin=${params.invokerIsAdmin}`);
  const invocationLine =
    invocationParts.length > 0 ? `- Invocation context: ${invocationParts.join(', ')}.` : null;

  // --- Tool loop limits ---
  const toolLoopLimitsLine = params.toolLoopLimits
    ? `- Tool loop limits: maxRounds=${params.toolLoopLimits.maxRounds}, maxCallsPerRound=${params.toolLoopLimits.maxCallsPerRound}, parallelReadOnlyTools=${params.toolLoopLimits.parallelReadOnlyTools}, maxParallelReadOnlyTools=${params.toolLoopLimits.maxParallelReadOnlyTools}.`
    : null;

  // --- Discord guardrails ---
  const discordGuardrailLines = hasDiscordTool
    ? formatDiscordGuardrailsLines().map((line) => `- ${line}`)
    : [];

  // --- Execution rules ---
  const executionRules = [
    '<execution_rules>',
    `- Active model: ${params.model?.trim() || 'unspecified'}.`,
    `- Runtime tools available this turn: ${activeToolLine}.`,
    ...(invocationLine ? [invocationLine] : []),
    ...(toolLoopLimitsLine ? [toolLoopLimitsLine] : []),
    '- Call tools only when they materially improve correctness. When confident, answer directly.',
    '- Never fabricate tool outputs. If a tool fails, acknowledge honestly and adapt.',
    '- Batch multiple read-only tools in a single tool_calls envelope for parallel execution.',
    hasDiscordTool
      ? '- Discord tool behavior: use the `discord` tool with action-based calls. Non-admin writes (send, react, poll, thread) are available to all users. Admin-only actions require admin context and may need approval.'
      : '- Discord tool behavior: you do not have access to Discord memory/actions via tools this turn.',
    hasDiscordTool
      ? '- Attachment memory behavior: historical non-image files are cached outside transcript; when transcript notes include `attachment:<id>` you can call `discord` action `files.read_attachment` directly. Otherwise use `files.list_channel`/`files.list_server` or `files.find_channel` to locate attachments.'
      : '- Attachment memory behavior: you do not have access to retrieve historical files this turn.',
    hasDiscordTool
      ? '- Guild memory: the <guild_memory> block (if present) contains admin-configured server memory. To update it, use discord: memory.update_server (admin only). Changes take effect on the next turn.'
      : '',
    hasDiscordTool && params.invokedBy === 'autopilot'
      ? '- Autopilot-restricted reads: files.read_attachment, files.list_server, files.find_server, messages.search_guild, messages.user_timeline, analytics.top_relationships.'
      : '',
    ...discordGuardrailLines,
    hasGenerateImage
      ? '- Image generation behavior: use image_generate for image creation requests (supports optional reference image); attachments are returned by the runtime.'
      : '- Image generation behavior: you do not have image generation capabilities this turn.',
    normalizedTools.includes('github')
      ? '- GitHub file strategy: when repo path is unknown, use code.search first then file.get. For large files, use file.get with startLine/endLine or file.page. If file.get fails, do NOT claim paths as verified.'
      : '',
    '</execution_rules>',
  ].filter(line => line.length > 0).join('\n');

  // --- Tool selection decision tree ---
  const toolSelectionGuide = normalizedTools.length > 0 ? buildToolSelectionGuide(normalizedTools) : '';

  // --- Reasoning protocol ---
  const reasoningProtocol = normalizedTools.length > 0 ? `
<reasoning_protocol>
For every turn, follow this reasoning cycle:

BEFORE calling tools — use the \`think\` field to reason:
1. INTENT — What is the user actually asking? Restate in your own words.
2. PLAN — What information do I need? Which tools will get it?
3. TOOL CHOICE — Why this specific tool/action? What do I expect to learn?

AFTER receiving tool results:
1. VERIFY — Does this data answer the original question?
2. CROSS-CHECK — If the result seems surprising, can I corroborate it?
3. DECIDE — If insufficient, plan and execute the next tool call. If sufficient, synthesize.

WHEN TO STOP:
- Stop calling tools once you have enough information to answer confidently.
- Do NOT call additional tools just to "be thorough" if the answer is already clear.
- Finalize with plain text once your reasoning is complete.
</reasoning_protocol>` : '';

  const errorRecovery = normalizedTools.length > 0 ? `
<error_recovery>
If a tool call fails:
1. Acknowledge the failure honestly to the user.
2. Try an alternative approach (different tool, different parameters).
3. If no alternative exists, answer with what you know and note the limitation.

If the query is ambiguous:
- MISSING PARAMETERS: If the user refers to a specific entity (e.g., "that guy", "the file") but provides ZERO searchable context, you MUST ask for clarification BEFORE guessing and calling tools.
- MULTIPLE MEANINGS: Answer the most likely interpretation, briefly note other possibilities, and offer to clarify.
</error_recovery>` : '';

  const agentStateBlock = buildAgenticStateBlock(params);

  return [executionRules, agentStateBlock, toolSelectionGuide, reasoningProtocol, errorRecovery]
    .filter((section) => section.length > 0)
    .join('\n\n');
}

/**
 * Build a structured tool selection guide based on active tools.
 */
function buildToolSelectionGuide(activeTools: string[]): string {
  const lines: string[] = ['<tool_selection_guide>'];
  lines.push('Use this decision tree to select the right tool. Match the FIRST applicable branch.');
  lines.push('');

  // --- Time ---
  if (activeTools.includes('system_time')) {
    lines.push('IF timezone conversion for a specific utcOffset → system_time (the current UTC time is already in <agent_state>, use it directly for basic time questions)');
    lines.push('');
  }

  // --- Telemetry ---
  if (activeTools.includes('system_tool_stats')) {
    lines.push('IF tool latency/cache debugging:');
    lines.push('  → system_tool_stats');
    lines.push('');
  }

  // --- Discord ---
  if (activeTools.includes('discord')) {
    lines.push('IF Discord memory/data:');
    lines.push('  ├─ schema or action help       → discord: help');
    lines.push('  ├─ user profile                 → discord: memory.get_user');
    lines.push('  ├─ channel summary (rolling)    → discord: memory.get_channel');
    lines.push('  ├─ server overview              → discord: memory.get_server');
    lines.push('  ├─ archived weekly summaries    → discord: memory.channel_archives');
    lines.push('  ├─ exact message quotes         → discord: messages.search_history');
    lines.push('  ├─ one-shot search + context    → discord: messages.search_with_context');
    lines.push('  ├─ time-windowed search         → messages.search_history (sinceHours/sinceDays/sinceIso/untilIso)');
    lines.push('  ├─ message context by ID        → discord: messages.get_context');
    lines.push('  ├─ server-wide search           → discord: messages.search_guild');
    lines.push('  ├─ user timeline                → discord: messages.user_timeline');
    lines.push('  ├─ list recent files            → discord: files.list_channel / files.list_server');
    lines.push('  ├─ find file content (semantic) → discord: files.find_channel / files.find_server');
    lines.push('  ├─ read cached attachment        → discord: files.read_attachment');
    lines.push('  ├─ social graph analytics       → discord: analytics.get_social_graph');
    lines.push('  ├─ top relationships            → discord: analytics.top_relationships');
    lines.push('  ├─ voice stats                  → discord: analytics.get_voice_analytics');
    lines.push('  ├─ voice sessions               → discord: analytics.voice_summaries');
    lines.push('  └─ bot invite URL               → discord: oauth2.invite_url');
    lines.push('');
    lines.push('  IF Discord writes (any user):');
    lines.push('    ├─ send a message              → discord: messages.send');
    lines.push('    ├─ react / unreact             → discord: reactions.add / reactions.remove_self');
    lines.push('    ├─ create a poll               → discord: polls.create');
    lines.push('    └─ start a thread              → discord: threads.create');
    lines.push('');
    lines.push('  IF Discord admin operations (admin only):');
    lines.push('    ├─ edit / delete messages       → discord: messages.edit / messages.delete');
    lines.push('    ├─ pin / unpin messages         → discord: messages.pin / messages.unpin');
    lines.push('    ├─ channel CRUD                 → discord: channels.create / channels.edit');
    lines.push('    ├─ role CRUD                    → discord: roles.create / roles.edit / roles.delete');
    lines.push('    ├─ role assignment              → discord: members.add_role / members.remove_role');
    lines.push('    ├─ moderation (kick/ban/timeout) → discord: moderation.submit');
    lines.push('    ├─ update server memory/config  → discord: memory.update_server');
    lines.push('    └─ raw API passthrough          → discord: discord.api');
    lines.push('');
  }

  // --- Web ---
  if (activeTools.includes('web')) {
    lines.push('IF real-time web information:');
    lines.push('  ├─ schema/action help           → web (action=help)');
    lines.push('  ├─ search the web               → web (action=search)');
    lines.push('  ├─ read a URL (raw scrape)      → web (action=read)  ← fast, cheap');
    lines.push('  ├─ read a large URL (paged)     → web (action=read.page)');
    lines.push('  ├─ extract data (LLM-powered)   → web (action=extract)  ← use only when raw read cannot answer');
    lines.push('  └─ one-shot search+read         → web (action=research)');
    lines.push('');
  }

  // --- GitHub ---
  if (activeTools.includes('github')) {
    lines.push('IF GitHub data:');
    lines.push('  ├─ schema/action help           → github (action=help)');
    lines.push('  ├─ repo overview                → github (action=repo.get)');
    lines.push('  ├─ find code across files       → github (action=code.search)');
    lines.push('  ├─ read file                    → github (action=file.get / file.page / file.ranges / file.snippet)');
    lines.push('  ├─ issues/PRs                   → github (action=issues.search / prs.search)');
    lines.push('  └─ recent commits               → github (action=commits.list)');
    lines.push('');
  }

  // --- Other tools ---
  if (activeTools.includes('npm_info')) {
    lines.push('IF npm package info → npm_info (returns githubRepo when available)');
  }
  if (activeTools.includes('workflow')) {
    lines.push('IF composed workflows → workflow (action=help; e.g. action=npm.github_code_search)');
  }
  if (activeTools.includes('wikipedia_search')) {
    lines.push('IF encyclopedia facts → wikipedia_search');
  }
  if (activeTools.includes('stack_overflow_search')) {
    lines.push('IF coding Q&A → stack_overflow_search (set includeAcceptedAnswer=true for answer body)');
  }
  if (activeTools.includes('image_generate')) {
    lines.push('IF image creation → image_generate');
  }
  if (activeTools.includes('system_plan')) {
    lines.push('IF complex multi-step reasoning → system_plan (reasoning scratchpad — logs your hypothesis for reference; does NOT execute anything)');
  }

  // --- Disambiguation ---
  if (activeTools.includes('discord')) {
    lines.push('');
    lines.push('DISAMBIGUATION:');
    lines.push('  "What did X say?"         → messages.search_history (NOT memory.get_channel)');
    lines.push('  "What\'s been happening?" → memory.get_channel (rolling summary, NOT raw messages)');
    lines.push('  "Who is X?"              → memory.get_user first, then social graph if needed');
    lines.push('  "Find the file about..." → files.find_channel (semantic) before files.list_channel');
  }

  // --- Anti-patterns ---
  lines.push('');
  lines.push('ANTI-PATTERNS — AVOID:');
  if (activeTools.includes('discord')) {
    lines.push('  ✗ memory.get_channel when user wants specific quotes → use messages.search_history');
  }
  if (activeTools.includes('web') && activeTools.includes('discord')) {
    lines.push('  ✗ web for Discord-internal questions → use discord memory tools');
  }
  if (activeTools.includes('web')) {
    lines.push('  ✗ web extract for simple page reads → use web read (raw scrape, faster/cheaper)');
    lines.push('  ✗ web read when you need structured extraction from messy pages → use web extract (LLM-powered)');
  }
  lines.push('  ✗ multiple tools that return the same data → pick the most specific one');

  lines.push('</tool_selection_guide>');
  return lines.join('\n');
}
