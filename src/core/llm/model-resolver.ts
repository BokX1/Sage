import { LLMChatMessage } from './llm-types';
import { getDefaultModelId } from './model-catalog';

/**
 * Inputs available when selecting an LLM model for a request.
 */
type ResolveModelParams = {
  guildId: string | null;
  messages: LLMChatMessage[];
  route?: string;
  featureFlags?: {
    tools?: boolean;
    search?: boolean;
    reasoning?: boolean;
    audioIn?: boolean;
    audioOut?: boolean;
    codeExec?: boolean;
  };
};

/**
 * Resolves the model id used for a chat request.
 *
 * @param _params Request metadata and message context for routing decisions.
 * @returns The model identifier to send to the configured LLM provider.
 */
export async function resolveModelForRequest(params: ResolveModelParams): Promise<string> {
  void params;
  return getDefaultModelId();
}
