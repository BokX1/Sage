import { LLMChatMessage } from './llm-types';
import { getDefaultModelId } from './model-catalog';

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

export async function resolveModelForRequest(params: ResolveModelParams): Promise<string> {
  void params;
  return getDefaultModelId();
}
