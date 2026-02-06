import { LLMChatMessage } from './llm-types';
import { getDefaultModelId } from './model-catalog';

type ResolveModelParams = {
  guildId: string | null;
  messages: LLMChatMessage[];
  route?: string; // Add route parameter
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
  // If the route is explicitly 'search', use the requested perplexity-reasoning model
  // REVERTED for SAG pipeline: The main model handles the synthesis, Perplexity is called manually.
  /*
  if (params.route === 'search') {
    return 'perplexity-reasoning';
  }
  */


  return getDefaultModelId();
}
