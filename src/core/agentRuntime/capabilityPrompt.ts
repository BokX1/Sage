export interface BuildCapabilityPromptSectionParams {
  activeTools?: string[];
  model?: string | null;
}

function formatListLine(values: string[]): string {
  if (values.length === 0) return 'none';
  return values.join(', ');
}

export function buildAgenticStateBlock(params: BuildCapabilityPromptSectionParams): string {
  const activeTools =
    params.activeTools?.map((tool) => tool.trim()).filter((tool) => tool.length > 0) ?? [];
  const state = {
    architecture: 'single_agent',
    orchestrator: 'runtime_assistant',
    model: params.model?.trim() || null,
    tools_available: activeTools,
    loop_stages: ['model_call', 'tool_calls_if_needed', 'final_answer'],
  };

  return ['<agent_state>', JSON.stringify(state, null, 2), '</agent_state>'].join('\n');
}

export function buildCapabilityPromptSection(
  params: BuildCapabilityPromptSectionParams,
): string {
  const normalizedTools =
    params.activeTools?.map((tool) => tool.trim()).filter((tool) => tool.length > 0) ?? [];
  const activeToolLine = formatListLine(normalizedTools);
  const hasChannelFileLookup = normalizedTools.includes('discord_lookup_channel_files');
  const hasServerFileLookup = normalizedTools.includes('discord_lookup_server_files');
  const hasGenerateImage = normalizedTools.includes('image_generate');

  return [
    '<execution_rules>',
    '- Architecture: single-agent orchestrator with iterative tool calling.',
    `- Active model: ${params.model?.trim() || 'unspecified'}.`,
    `- Runtime tools available this turn: ${activeToolLine}.`,
    hasChannelFileLookup || hasServerFileLookup
      ? `- Attachment memory behavior: historical non-image files are cached outside transcript; use ${hasServerFileLookup ? 'discord_lookup_server_files (server-wide, permission-filtered)' : 'discord_lookup_channel_files'} to retrieve file content on demand.`
      : '- Attachment memory behavior: you do not have access to retrieve historical files this turn.',
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
