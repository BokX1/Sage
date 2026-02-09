/**
 * Context Provider names in the virtual MoE system.
 */
export type ContextProviderName = 'Summarizer' | 'SocialGraph' | 'Memory' | 'VoiceAnalytics';

/**
 * Context packet: bounded context injection from a backend provider.
 */
export interface ContextPacket {
  /** Name of the provider that produced this packet */
  name: ContextProviderName;
  /** Human-readable content safe to inject into LLM context */
  content: string;
  /** Optional structured copy for trace persistence */
  json?: unknown;
  /** Estimated token count */
  tokenEstimate?: number;
  /** Optional binary attachment (e.g. charts, no longer images) */
  binary?: {
    data: Buffer;
    filename: string;
    mimetype: string;
  };
}
