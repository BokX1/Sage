import { LLMChatMessage, LLMMessageContent } from './types';
import {
  getDefaultModelId,
  loadModelCatalog,
  modelSupports,
  ModelCaps,
} from './modelCatalog';
import { logger } from '../../utils/logger';

type ResolveModelParams = {
  guildId: string | null;
  messages: LLMChatMessage[];
  featureFlags?: {
    tools?: boolean;
    search?: boolean;
    reasoning?: boolean;
    audioIn?: boolean;
    audioOut?: boolean;
    codeExec?: boolean;
  };
};

type RequiredCaps = Partial<ModelCaps> & {
  inputModalities?: string[];
  outputModalities?: string[];
};

function contentHasImage(content: LLMMessageContent): boolean {
  if (typeof content === 'string') return false;
  return content.some((part) => part.type === 'image_url');
}

function deriveRequirementsFromMessages(
  messages: LLMChatMessage[],
  featureFlags?: ResolveModelParams['featureFlags'],
): RequiredCaps {
  const needsVision = messages.some((message) => contentHasImage(message.content));

  return {
    vision: needsVision || undefined,
    tools: featureFlags?.tools || undefined,
    search: featureFlags?.search || undefined,
    reasoning: featureFlags?.reasoning || undefined,
    audioIn: featureFlags?.audioIn || undefined,
    audioOut: featureFlags?.audioOut || undefined,
    codeExec: featureFlags?.codeExec || undefined,
  };
}

export async function resolveModelForRequest(params: ResolveModelParams): Promise<string> {
  const defaultModel = getDefaultModelId();
  if (!params.guildId) {
    return defaultModel;
  }

  let preferred: string | null = null;
  try {
    const { getGuildModel } = await import('../settings/guildModelSettings');
    preferred = await getGuildModel(params.guildId);
  } catch (error) {
    logger.warn({ error, guildId: params.guildId }, 'Failed to load guild model preference');
    return defaultModel;
  }
  if (!preferred) {
    return defaultModel;
  }

  const catalog = await loadModelCatalog();
  const preferredInfo = catalog[preferred.trim().toLowerCase()];
  if (!preferredInfo) {
    return defaultModel;
  }

  const requiredCaps = deriveRequirementsFromMessages(params.messages, params.featureFlags);
  if (modelSupports(preferredInfo, requiredCaps)) {
    return preferredInfo.id;
  }

  if (requiredCaps.vision) {
    logger.debug(
      { preferred: preferredInfo.id, fallback: defaultModel },
      `Model ${preferredInfo.id} lacks vision; fallback to ${defaultModel} for this request.`,
    );
  }

  return defaultModel;
}

export { deriveRequirementsFromMessages };
