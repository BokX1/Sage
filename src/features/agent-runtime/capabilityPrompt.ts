import { formatDiscordGuardrailsLines } from './discordToolCatalog';
import { RuntimeAutopilotMode } from './autopilotMode';
import { getPromptToolGuidance, isRoutedTool } from './toolDocs';

export interface BuildCapabilityPromptSectionParams {
  activeTools?: string[];
  model?: string | null;
  invokedBy?: string | null;
  invokerIsAdmin?: boolean;
  inGuild?: boolean;
  turnMode?: 'text' | 'voice';
  autopilotMode?: RuntimeAutopilotMode;
  graphLimits?: {
    maxRounds: number;
    maxCallsPerRound: number;
  };
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
  const state = {
    current_time_utc: new Date().toISOString(),
    model: params.model?.trim() || null,
    tools_available: activeTools,
    invoked_by: params.invokedBy ?? null,
    invoker_is_admin: params.invokerIsAdmin ?? null,
    in_guild: params.inGuild ?? null,
    turn_mode: params.turnMode ?? 'text',
    autopilot_mode: params.autopilotMode ?? null,
    graph_limits: params.graphLimits
      ? {
        max_steps: params.graphLimits.maxRounds,
        max_tool_calls_per_step: params.graphLimits.maxCallsPerRound,
      }
      : null,
  };

  return ['<agent_state>', JSON.stringify(state, null, 2), '</agent_state>'].join('\n');
}

/**
 * Build the consolidated capability prompt section.
 *
 * Merges execution rules, structured runtime state, and compact tool-routing
 * guidance into a single capability section.
 *
 * @returns XML-wrapped agent configuration prompt.
 */
export function buildCapabilityPromptSection(
  params: BuildCapabilityPromptSectionParams,
): string {
  const normalizedTools =
    params.activeTools?.map((tool) => tool.trim()).filter((tool) => tool.length > 0) ?? [];
  const activeRoutedTools = normalizedTools.filter((tool) => isRoutedTool(tool));
  const activeDirectTools = normalizedTools.filter((tool) => !isRoutedTool(tool));
  const hasDiscordContextTool = normalizedTools.includes('discord_context');
  const hasDiscordMessagesTool = normalizedTools.includes('discord_messages');
  const hasDiscordFilesTool = normalizedTools.includes('discord_files');
  const hasDiscordServerTool = normalizedTools.includes('discord_server');
  const hasDiscordAdminTool = normalizedTools.includes('discord_admin');
  const hasDiscordVoiceTool = normalizedTools.includes('discord_voice');
  const hasAnyDiscordTool =
    hasDiscordContextTool ||
    hasDiscordMessagesTool ||
    hasDiscordFilesTool ||
    hasDiscordServerTool ||
    hasDiscordAdminTool ||
    hasDiscordVoiceTool;
  const hasGenerateImage = normalizedTools.includes('image_generate');
  const discordToolNames = [
    'discord_context',
    'discord_messages',
    'discord_files',
    'discord_server',
    'discord_voice',
    'discord_admin',
  ];
  const activeDiscordTools = discordToolNames.filter((tool) => normalizedTools.includes(tool));

  const discordGuardrailLines = hasAnyDiscordTool
    ? formatDiscordGuardrailsLines().map((line) => `- ${line}`)
    : [];

  const operatorModel = [
    '<operator_model>',
    '- Lock onto the current user\'s objective before room noise.',
    '- Decide the needed source: exact evidence, summary context, file recall, guild resource, live voice, admin action, or public web facts.',
    '- Choose the narrowest active tool that can answer it.',
    '- Stop when enough evidence exists. Then answer in the simplest fitting format.',
    '</operator_model>',
  ].join('\n');

  const executionRules = [
    '<execution_rules>',
    '- Read exact runtime facts from <agent_state> for current time, model, active tools, invocation context, turn mode, autopilot mode, and graph limits.',
    '- If <agent_state>.turn_mode is "voice", spoken-response behavior is expected and the <voice_mode> block overrides the default Discord markdown guidance.',
    '- If <agent_state>.autopilot_mode is non-null, the <autopilot_mode> block determines whether Sage should respond or emit [SILENCE].',
    activeRoutedTools.length > 0
      ? `- Routed tools expose action-level \`help\`: ${activeRoutedTools.map((tool) => `\`${tool}\``).join(', ')}. Use it only when a routed-tool contract is genuinely unclear.`
      : '',
    activeDirectTools.length > 0
      ? `- Direct tools do not expose \`help\`; rely on schema and description for: ${activeDirectTools.map((tool) => `\`${tool}\``).join(', ')}.`
      : '',
    '- Use tools only when they materially improve the answer or are required to complete the request.',
    '- Use native tool calls silently. Never narrate tool choice, args, or approval payloads.',
    '- Batch read-only calls in one provider-native turn when possible. Do NOT loop them one by one across rounds.',
    '- If a required parameter is missing, ask instead of guessing.',
    '- If approval review interrupts the turn, treat that action as already queued. Do not retry the same approval-gated action again.',
    '- If the runtime blocks a repeated call for this turn, do not retry it unchanged. Pivot to different arguments, another tool, or one clarifying question.',
    '- If no tool is needed, answer in plain text.',
    '- After an approval-review interrupt, keep the channel reply brief. Do not repeat action IDs, approval card contents, raw admin workflow steps, or recovery protocol.',
    hasAnyDiscordTool
      ? '- Think Discord-first when Discord tools can answer the request. Use web only for questions outside Discord.'
      : '- Discord-native profiles, summaries, files, messages, and actions are unavailable this turn.',
    hasDiscordContextTool && hasDiscordMessagesTool
      ? '- Summary vs exact evidence: `discord_context.get_channel_summary` is recap; `discord_messages` is for quotes and message-level proof.'
      : '',
    hasDiscordContextTool && hasDiscordAdminTool
      ? '- Sage Persona read vs write: `discord_context.get_server_instructions` reads the guild Sage Persona, while `discord_admin.update_server_instructions` queues a change.'
      : '',
    hasDiscordAdminTool
      ? '- Governance/config vs moderation: Sage Persona changes how Sage behaves; moderation acts on users, messages, reactions, or content.'
      : '',
    hasDiscordAdminTool
      ? '- Reply-targeted enforcement uses moderation: replied-to spam or abuse -> `discord_admin.submit_moderation`.'
      : '',
    hasDiscordAdminTool && !hasDiscordMessagesTool
      ? '- Exact Discord message-history tools are unavailable; gather moderation evidence via `discord_admin.api` GET `/channels/{channelId}/messages` (or `/messages/{messageId}`) before calling `submit_moderation`.'
      : '',
    hasDiscordFilesTool && hasDiscordServerTool
      ? '- File recall vs guild resources: `discord_files.list_channel` / `find_channel` operate on attachments, while `discord_server.list_channels` inspects channels.'
      : '',
    hasDiscordContextTool && hasDiscordVoiceTool
      ? '- Voice analytics vs live control: `discord_context` covers voice analytics and summaries, while `discord_voice` handles current voice status and join/leave.'
      : '',
    hasDiscordAdminTool && hasDiscordServerTool
      ? '- Typed Discord actions come before raw API fallback. Use `discord_admin.api` only after typed `discord_server` or `discord_admin` actions do not cover the task.'
      : '',
    hasDiscordMessagesTool
      ? '- Plain assistant text is fine for normal answers. Use `discord_messages.send` only when final delivery must be a Discord-native message inside the channel.'
      : '',
    hasDiscordMessagesTool
      ? '- If `send` already delivers the final answer into the channel, do not repeat the same answer again as a normal assistant reply.'
      : '',
    hasAnyDiscordTool && params.invokedBy === 'autopilot'
      ? '- Autopilot-restricted Discord reads include server-wide file lookup, attachment paging, guild-wide message search, user timelines, top relationship summaries, and all discord_server writes.'
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

  const replyFormatPolicy = hasDiscordMessagesTool
    ? [
        '<reply_format_policy>',
        '- Use plain send payloads for short conversational replies or simple status updates.',
        '- Use `presentation="components_v2"` only when structure, grouped evidence, files, or guided next actions materially improve the reply.',
        '- If you are not using Discord-native send, answer normally in plain text.',
        '- `presentation` is not a cosmetic toggle: `plain` and `components_v2` have different payload rules and validation constraints.',
        '- Components V2 requires the `IS_COMPONENTS_V2` flag.',
        '- When using Components V2, do not combine it with `content`, `embeds`, `poll`, or `stickers` in the same message.',
        '- Avoid decorative layouts, trivial buttons, or fake structure that do not add clarity.',
        '</reply_format_policy>',
      ].join('\n')
    : '';

  const toolSelectionGuide = normalizedTools.length > 0
    ? buildToolSelectionGuide({
        activeTools: normalizedTools,
        activeDiscordTools,
      })
    : '';

  const agentStateBlock = buildAgenticStateBlock(params);

  return [operatorModel, executionRules, replyFormatPolicy, agentStateBlock, toolSelectionGuide]
    .filter((section) => section.length > 0)
    .join('\n\n');
}

/**
 * Build a structured tool selection guide based on compact prompt metadata.
 */
function buildToolSelectionGuide(params: {
  activeTools: string[];
  activeDiscordTools: string[];
}): string {
  const { activeTools, activeDiscordTools } = params;
  const lines: string[] = ['<tool_selection_guide>'];
  lines.push('Look in the narrowest place that fits. Keep tool choice out of the visible reply.');

  if (activeDiscordTools.length > 0) {
    lines.push('');
    lines.push('DISCORD-FIRST:');
    for (const toolName of activeDiscordTools) {
      appendPromptToolGuidance(lines, toolName);
    }
  }

  const nonDiscordTools = activeTools.filter((tool) => !activeDiscordTools.includes(tool));
  if (nonDiscordTools.length > 0) {
    lines.push('');
    lines.push('OTHER ACTIVE TOOLS:');
    for (const toolName of nonDiscordTools) {
      appendPromptToolGuidance(lines, toolName);
    }
  }

  const antiPatterns = new Set<string>();
  for (const toolName of activeTools) {
    const guidance = getPromptToolGuidance(toolName);
    for (const antiPattern of guidance?.antiPatterns ?? []) {
      antiPatterns.add(antiPattern);
    }
  }
  antiPatterns.add('Do not mention tool calls, approval payloads, action IDs, or retry protocol in the visible reply.');
  antiPatterns.add('Do not make extra tool calls after you already have enough evidence to answer.');

  if (antiPatterns.size > 0) {
    lines.push('');
    lines.push('ANTI-PATTERNS — AVOID:');
    for (const line of antiPatterns) {
      lines.push(`- ${line}`);
    }
  }

  lines.push('</tool_selection_guide>');
  return lines.join('\n');
}

function appendPromptToolGuidance(lines: string[], toolName: string): void {
  const guidance = getPromptToolGuidance(toolName);
  if (!guidance) {
    lines.push(`- ${toolName}: use the tool schema and description directly.`);
    return;
  }

  const summary = guidance.purpose?.trim() || `Use ${toolName} when it is the narrowest fit.`;
  const edgeText = guidance.decisionEdges.join(' ');
  lines.push(`- ${toolName}: ${summary} ${edgeText}`.trim());
}
