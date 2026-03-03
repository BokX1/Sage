/**
 * @module src/core/agentRuntime/capabilityPrompt
 * @description Defines the capability prompt module.
 */
import { DISCORD_ACTION_CATALOG, formatDiscordActionIndexLines, formatDiscordGuardrailsLines } from './discordToolCatalog';

/**
 * Represents the BuildCapabilityPromptSectionParams contract.
 */
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

  // --- Discord action index + guardrails ---
  const discordActionIndexLines = hasDiscordTool
    ? formatDiscordActionIndexLines().map((line) => `- ${line}`)
    : [];
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
    hasDiscordTool
      ? '- Discord tool behavior: use the `discord` tool with action-based calls for memory, retrieval, and safe interactions. Admin-only actions and writes may require approval.'
      : '- Discord tool behavior: you do not have access to Discord memory/actions via tools this turn.',
    hasDiscordTool
      ? '- Attachment memory behavior: historical non-image files are cached outside transcript; use `discord` actions `files.list_channel` or `files.list_server` (server-wide is permission-filtered) to retrieve file content on demand.'
      : '- Attachment memory behavior: you do not have access to retrieve historical files this turn.',
    ...discordActionIndexLines,
    ...discordGuardrailLines,
    hasGenerateImage
      ? '- Image generation behavior: use image_generate for image creation/edit requests; attachments are returned by the runtime.'
      : '- Image generation behavior: you do not have image generation capabilities this turn.',
    '</execution_rules>',
  ].join('\n');

  // --- Tool selection decision tree ---
  const toolSelectionGuide = normalizedTools.length > 0 ? buildToolSelectionGuide(normalizedTools) : '';

  // --- Reasoning protocol ---
  const reasoningProtocol = normalizedTools.length > 0 ? `
<reasoning_protocol>
For every tool call, use the \`think\` field to document:
1. What information you need and why.
2. Why this specific tool/action is the right choice.
3. What you expect to learn from the result.

After receiving tool results:
- Verify the data answers the original question.
- If insufficient, plan and execute the next tool call.
- If sufficient, synthesize a natural-language response.
- Only utilize tools when they materially improve correctness.
- Finalize with plain text once tool gathering is sufficient.
</reasoning_protocol>` : '';

  return [executionRules, toolSelectionGuide, reasoningProtocol]
    .filter((section) => section.length > 0)
    .join('\n\n');
}

/**
 * Build a structured tool selection guide based on active tools.
 *
 * This decision tree helps Kimi K2.5 route to the correct tool on first attempt.
 */
function buildToolSelectionGuide(activeTools: string[]): string {
  const lines: string[] = ['<tool_selection_guide>'];
  lines.push('Follow this decision tree to select the right tool:');
  lines.push('');

  if (activeTools.includes('system_time')) {
    lines.push('TIME/DATE OFFSET CALCULATION? → system_time (NOTE: UTC time is already in your agent_state)');
  }

  if (activeTools.includes('discord')) {
    lines.push('DISCORD MEMORY/DATA?');
    lines.push('  User profile → discord: memory.get_user');
    lines.push('  Channel summary → discord: memory.get_channel');
    lines.push('  Server overview → discord: memory.get_server');
    lines.push('  Archived summaries → discord: memory.channel_archives');
    lines.push('  Exact message quotes → discord: messages.search_history');
    lines.push('  Message context → discord: messages.get_context');
    lines.push('  Channel files → discord: files.list_channel / files.find_channel');
    lines.push('  Server files → discord: files.list_server / files.find_server');
    lines.push('  Social graph → discord: analytics.get_social_graph');
    lines.push('  Voice stats → discord: analytics.get_voice_analytics');
    lines.push('  Voice sessions → discord: analytics.voice_summaries');
    lines.push('  Bot invite URL → discord: oauth2.invite_url');
  }

  if (activeTools.includes('web_search') || activeTools.includes('web_read') || activeTools.includes('web_scrape')) {
    lines.push('REAL-TIME WEB INFO?');
    if (activeTools.includes('web_search')) lines.push('  Search the web → web_search');
    if (activeTools.includes('web_read')) lines.push('  Read a specific URL → web_read');
    if (activeTools.includes('web_scrape')) lines.push('  Extract specific data from URL → web_scrape (targeted extraction, not full dump)');
  }

  if (activeTools.includes('github_repo') || activeTools.includes('github_search_code') || activeTools.includes('github_get_file')) {
    lines.push('GITHUB DATA?');
    if (activeTools.includes('github_repo')) lines.push('  Repo overview → github_repo');
    if (activeTools.includes('github_search_code')) lines.push('  Find code across files → github_search_code');
    if (activeTools.includes('github_get_file')) lines.push('  Read specific file → github_get_file (use line ranges for large files)');
  }

  if (activeTools.includes('npm_info')) {
    lines.push('NPM PACKAGE INFO? → npm_info');
  }
  if (activeTools.includes('wikipedia_search')) {
    lines.push('ENCYCLOPEDIA FACTS? → wikipedia_search');
  }
  if (activeTools.includes('stack_overflow_search')) {
    lines.push('CODING Q&A? → stack_overflow_search');
  }
  if (activeTools.includes('image_generate')) {
    lines.push('IMAGE CREATION? → image_generate');
  }
  if (activeTools.includes('system_plan')) {
    lines.push('COMPLEX PLANNING? → system_plan first, then execute');
  }

  lines.push('');
  lines.push('MULTIPLE READ-ONLY TOOLS NEEDED? → Batch them in a single tool_calls envelope for parallel execution.');
  lines.push('</tool_selection_guide>');

  return lines.join('\n');
}
