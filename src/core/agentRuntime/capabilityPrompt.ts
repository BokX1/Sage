import { DISCORD_ACTION_CATALOG, formatDiscordActionIndexLines } from './discordToolCatalog';

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

export function buildAgenticStateBlock(params: BuildCapabilityPromptSectionParams): string {
  const activeTools =
    params.activeTools?.map((tool) => tool.trim()).filter((tool) => tool.length > 0) ?? [];
  const hasDiscordTool = activeTools.includes('discord');
  const state = {
    architecture: 'single_agent',
    orchestrator: 'runtime_assistant',
    model: params.model?.trim() || null,
    tools_available: activeTools,
    loop_stages: ['model_call', 'tool_calls_if_needed', 'final_answer'],
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

export function buildCapabilityPromptSection(
  params: BuildCapabilityPromptSectionParams,
): string {
  const normalizedTools =
    params.activeTools?.map((tool) => tool.trim()).filter((tool) => tool.length > 0) ?? [];
  const activeToolLine = formatListLine(normalizedTools);
  const hasDiscordTool = normalizedTools.includes('discord');
  const hasGenerateImage = normalizedTools.includes('image_generate');

  const invocationParts: string[] = [];
  if (params.invokedBy) invocationParts.push(`invokedBy=${params.invokedBy}`);
  if (params.inGuild !== undefined) invocationParts.push(`inGuild=${params.inGuild}`);
  if (params.invokerIsAdmin !== undefined) invocationParts.push(`invokerIsAdmin=${params.invokerIsAdmin}`);
  const invocationLine =
    invocationParts.length > 0 ? `- Invocation context: ${invocationParts.join(', ')}.` : null;

  const toolLoopLimitsLine = params.toolLoopLimits
    ? `- Tool loop limits: maxRounds=${params.toolLoopLimits.maxRounds}, maxCallsPerRound=${params.toolLoopLimits.maxCallsPerRound}, parallelReadOnlyTools=${params.toolLoopLimits.parallelReadOnlyTools}, maxParallelReadOnlyTools=${params.toolLoopLimits.maxParallelReadOnlyTools}.`
    : null;

  const discordActionIndexLines = hasDiscordTool
    ? formatDiscordActionIndexLines().map((line) => `- ${line}`)
    : [];

  return [
    '<execution_rules>',
    '- Architecture: single-agent orchestrator with iterative tool calling.',
    `- Active model: ${params.model?.trim() || 'unspecified'}.`,
    `- Runtime tools available this turn: ${activeToolLine}.`,
    ...(invocationLine ? [invocationLine] : []),
    ...(toolLoopLimitsLine ? [toolLoopLimitsLine] : []),
    hasDiscordTool
      ? '- Discord tool behavior: use the `discord` tool with action-based calls for memory, retrieval, and safe interactions. Admin-only actions and writes may require approval.'
      : '- Discord tool behavior: you do not have access to Discord memory/actions via tools this turn.',
    hasDiscordTool
      ? '- Attachment memory behavior: historical non-image files are cached outside transcript; use `discord` actions `files.lookup_channel` or `files.lookup_server` (server-wide is permission-filtered) to retrieve file content on demand.'
      : '- Attachment memory behavior: you do not have access to retrieve historical files this turn.',
    ...discordActionIndexLines,
    hasGenerateImage
      ? '- Image generation behavior: use image_generate for image creation/edit requests; attachments are returned by the runtime.'
      : '- Image generation behavior: you do not have image generation capabilities this turn.',
    '- Tool calls are executed by the runtime assistant.',
    '- This turn follows one loop: model response -> tool assistance (if needed) -> final answer.',
    '- If tools fail, acknowledge limitations and continue with the safest possible answer.',
    '- Finalize with plain text once tool gathering is sufficient.',
    '- Only utilize the tools explicitly listed above when they materially improve correctness.',
    '- For factual, versioned, or external claims, you must gather tool-backed evidence before finalizing.',
    '</execution_rules>',
  ].join('\n');
}
