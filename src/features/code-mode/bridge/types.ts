import type { z } from 'zod';
import type { ToolExecutionContext } from '../../agent-runtime/toolRegistry';

export type BridgeNamespace =
  | 'discord'
  | 'history'
  | 'context'
  | 'artifacts'
  | 'approvals'
  | 'admin'
  | 'moderation'
  | 'schedule';

export type BridgeMutability = 'read' | 'write';
export type BridgeAccess = 'public' | 'moderator' | 'admin' | 'owner';
export type BridgeApprovalMode = 'none' | 'required';

export interface BridgeMethodContext {
  toolContext: ToolExecutionContext;
}

export interface BridgeMethodDefinition<TArgs = unknown> {
  namespace: BridgeNamespace;
  method: string;
  input: z.ZodType<TArgs>;
  mutability: BridgeMutability;
  access?: BridgeAccess;
  approvalMode?: BridgeApprovalMode;
  execute: (args: TArgs, context: BridgeMethodContext) => Promise<unknown>;
}

export interface RegisteredBridgeMethod<TArgs = unknown> extends BridgeMethodDefinition<TArgs> {
  key: string;
}

export interface BridgeMethodSummary {
  key: string;
  namespace: BridgeNamespace;
  method: string;
  mutability: BridgeMutability;
  access: BridgeAccess;
  approvalMode: BridgeApprovalMode;
}
