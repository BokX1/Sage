import type { PromptInputMode } from './promptContract';
import type { ToolClass, ToolDefinition } from './toolRegistry';

type InvocationKind = 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';
type ToolExposurePhase = 'turn' | 'background_resume' | 'retry';

export interface ToolExposurePlan {
  activeToolNames: string[];
  strategy: 'all_eligible' | 'intent_subset' | 'resume_all_eligible';
  matchedCapabilityTags: string[];
}

interface ToolExposureParams {
  allToolNames: string[];
  resolveTool: (toolName: string) => Pick<
    ToolDefinition<unknown>,
    'name' | 'runtime' | 'metadata'
  > | undefined;
  phase: ToolExposurePhase;
  invokedBy: InvocationKind;
  isAdmin: boolean;
  canModerate: boolean;
  userText?: string;
  promptMode?: PromptInputMode;
  hasReplyTarget?: boolean;
  inGuild?: boolean;
  isVoiceActive?: boolean;
}

function tokenizeIntent(text: string): string {
  return text.toLowerCase();
}

function inferIntentTags(params: {
  userText?: string;
  promptMode?: PromptInputMode;
  hasReplyTarget?: boolean;
  inGuild?: boolean;
  isVoiceActive?: boolean;
}): Set<string> {
  const tags = new Set<string>();
  const normalized = tokenizeIntent(params.userText ?? '');

  const maybeAdd = (tag: string, pattern: RegExp): void => {
    if (pattern.test(normalized)) {
      tags.add(tag);
    }
  };

  maybeAdd('web', /\b(web|search|research|browse|latest|current|recent|news|look up|lookup|find online)\b/);
  maybeAdd('search', /\b(search|find|lookup|look up|discover)\b/);
  maybeAdd('github', /\b(github|repo|repository|pull request|pr\b|issue|commit|readme|source code|codebase)\b/);
  maybeAdd('developer', /\b(code|typescript|javascript|node|npm|package|sdk|api)\b/);
  maybeAdd('npm', /\bnpm|package\b/);
  maybeAdd('discord', /\b(discord|server|guild|channel|thread|role|member|message|reaction|poll|attachment|file)\b/);
  maybeAdd('messages', /\b(message|reply|thread|poll|reaction|history|conversation|chat)\b/);
  maybeAdd('files', /\b(file|attachment|upload|download|image|pdf|document)\b/);
  maybeAdd('voice', /\b(voice|call|vc|listen|speaking)\b/);
  maybeAdd('moderation', /\b(moderat|ban|kick|timeout|spam|cleanup|clean up|enforce|mute|warn)\b/);
  maybeAdd('governance', /\b(persona|instruction|governance|review channel|server key|config|configuration)\b/);
  maybeAdd('generation', /\b(generate|draw|image|picture|art)\b/);
  maybeAdd('image', /\b(image|picture|photo|art)\b/);
  maybeAdd('system', /\b(time|timezone|offset|latency|stats|telemetry)\b/);

  if (params.hasReplyTarget) {
    tags.add('messages');
    tags.add('discord');
  }
  if (params.promptMode === 'image_only') {
    tags.add('image');
  }
  if (params.isVoiceActive) {
    tags.add('voice');
  }
  if (params.inGuild === false) {
    tags.delete('discord');
    tags.delete('moderation');
    tags.delete('governance');
  }

  return tags;
}

function getToolAccess(tool: Pick<ToolDefinition<unknown>, 'runtime' | 'metadata'>): 'public' | 'admin' {
  return tool.runtime?.access ?? tool.metadata?.access ?? 'public';
}

function getToolClass(tool: Pick<ToolDefinition<unknown>, 'runtime'>): ToolClass {
  return tool.runtime?.class ?? 'query';
}

function isEligibleTool(params: {
  toolName: string;
  tool: Pick<ToolDefinition<unknown>, 'runtime' | 'metadata'>;
  invokedBy: InvocationKind;
  isAdmin: boolean;
  canModerate: boolean;
}): boolean {
  const access = getToolAccess(params.tool);
  if (access === 'public') {
    return true;
  }
  if (params.invokedBy === 'autopilot') {
    return false;
  }
  if (params.isAdmin) {
    return true;
  }
  const tags = params.tool.runtime?.capabilityTags ?? [];
  return tags.includes('moderation') && params.canModerate;
}

export function planToolExposure(params: ToolExposureParams): ToolExposurePlan {
  const eligibleTools = params.allToolNames.filter((toolName) => {
    const tool = params.resolveTool(toolName);
    if (!tool) {
      return false;
    }
    return isEligibleTool({
      toolName,
      tool,
      invokedBy: params.invokedBy,
      isAdmin: params.isAdmin,
      canModerate: params.canModerate,
    });
  });

  if (params.phase !== 'turn' || eligibleTools.length <= 8) {
    return {
      activeToolNames: eligibleTools,
      strategy: params.phase === 'turn' ? 'all_eligible' : 'resume_all_eligible',
      matchedCapabilityTags: [],
    };
  }

  const intentTags = inferIntentTags({
    userText: params.userText,
    promptMode: params.promptMode,
    hasReplyTarget: params.hasReplyTarget,
    inGuild: params.inGuild,
    isVoiceActive: params.isVoiceActive,
  });

  if (intentTags.size === 0) {
    return {
      activeToolNames: eligibleTools,
      strategy: 'all_eligible',
      matchedCapabilityTags: [],
    };
  }

  const matchedTools = eligibleTools.filter((toolName) => {
    const tool = params.resolveTool(toolName);
    if (!tool) {
      return false;
    }
    const classMatches =
      intentTags.has('generation') && getToolClass(tool) === 'artifact';
    const capabilityTags = tool.runtime?.capabilityTags ?? [];
    return classMatches || capabilityTags.some((tag) => intentTags.has(tag));
  });

  const baselineToolNames = eligibleTools.filter((toolName) => {
    const tool = params.resolveTool(toolName);
    if (!tool) {
      return false;
    }
    const capabilityTags = tool.runtime?.capabilityTags ?? [];
    return capabilityTags.includes('system') || capabilityTags.includes('time');
  });

  const activeToolNames = Array.from(new Set([...baselineToolNames, ...matchedTools]));
  if (activeToolNames.length === 0) {
    return {
      activeToolNames: eligibleTools,
      strategy: 'all_eligible',
      matchedCapabilityTags: Array.from(intentTags),
    };
  }

  return {
    activeToolNames,
    strategy: 'intent_subset',
    matchedCapabilityTags: Array.from(intentTags).sort(),
  };
}
