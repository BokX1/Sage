/**
 * Expert names in the virtual MoE system.
 */
export type ExpertName = 'Summarizer' | 'SocialGraph' | 'Memory' | 'VoiceAnalytics' | 'ImageGenerator';

/**
 * Expert packet: bounded context injection from a backend expert.
 */
export interface ExpertPacket {
  /** Name of the expert that produced this packet */
  name: ExpertName;
  /** Human-readable content safe to inject into LLM context */
  content: string;
  /** Optional structured copy for trace persistence */
  json?: unknown;
  /** Estimated token count */
  tokenEstimate?: number;
  /** Optional binary attachment (e.g. generated image) */
  binary?: {
    data: Buffer;
    filename: string;
    mimetype: string;
  };
}
