import type { BaseMessage } from '@langchain/core/messages';
import type { RuntimeAutopilotMode } from '../autopilotMode';
import type { CurrentTurnContext, ReplyTargetContext } from '../continuityContext';
import type { LLMMessageContent } from '../../../platform/llm/llm-types';
import type { DiscordAuthorityTier } from '../../../platform/discord/admin-permissions';
import type { InjectedBridgeNamespace } from '../../code-mode/bridge/types';

export type PromptInputMode =
  | 'standard'
  | 'image_only'
  | 'reply_only'
  | 'direct_attention'
  | 'durable_resume'
  | 'waiting_follow_up';

export type PromptBuildMode =
  | 'interactive'
  | 'approval_resume'
  | 'user_input_resume'
  | 'background_resume';

export interface PromptWaitingFollowUp {
  matched: boolean;
  matchKind: 'direct_reply';
  outstandingPrompt: string;
  responseMessageId?: string | null;
}

export interface ToolObservationEvidence {
  ref: string;
  toolName: string;
  status: 'success' | 'failure';
  summary: string;
  errorText?: string | null;
  cacheHit?: boolean;
}

export interface PromptWorkingMemoryFrame {
  objective: string;
  verifiedFacts: string[];
  completedActions: string[];
  openQuestions: string[];
  pendingApprovals: string[];
  deliveryState: 'none' | 'awaiting_approval' | 'paused' | 'final';
  nextAction: string;
  activeEvidenceRefs?: string[];
  droppedMessageCutoff?: number;
  compactionRevision?: number;
}

export interface PromptCapabilityMethod {
  method: string;
  access: 'public' | 'moderator' | 'admin' | 'owner';
  approvalMode: 'none' | 'required';
}

export interface PromptCapabilityNamespaceSnapshot {
  namespace: InjectedBridgeNamespace;
  ownership: string;
  methods: PromptCapabilityMethod[];
}

export interface PromptCapabilitySnapshot {
  namespaces: PromptCapabilityNamespaceSnapshot[];
}

export interface BuildUniversalPromptContractParams {
  userProfileSummary: string | null;
  currentTurn: CurrentTurnContext;
  activeTools?: string[];
  model?: string | null;
  invokedBy?: string | null;
  invokerAuthority?: DiscordAuthorityTier;
  invokerIsAdmin?: boolean;
  invokerCanModerate?: boolean;
  inGuild?: boolean;
  autopilotMode?: RuntimeAutopilotMode;
  graphLimits?: {
    maxRounds: number;
  };
  guildSagePersona?: string | null;
  replyTarget?: ReplyTargetContext | null;
  userText: string;
  userContent?: LLMMessageContent;
  focusedContinuity?: string | null;
  recentTranscript?: string | null;
  workingMemoryFrame?: PromptWorkingMemoryFrame | null;
  toolObservationEvidence?: ToolObservationEvidence[] | null;
  promptMode?: PromptInputMode;
  waitingFollowUp?: PromptWaitingFollowUp | null;
  buildMode?: PromptBuildMode;
}

export interface UniversalPromptContract {
  version: string;
  systemMessage: string;
  workingMemoryFrame: PromptWorkingMemoryFrame;
  promptFingerprint: string;
}

export interface PromptContextMessagesResult extends UniversalPromptContract {
  trustedContextMessage: string;
  untrustedContextMessage: LLMMessageContent | null;
  capabilitySnapshot: PromptCapabilitySnapshot;
  buildMode: PromptBuildMode;
  messages: BaseMessage[];
}
