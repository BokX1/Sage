import type { z } from 'zod';
import type { ToolExecutionContext } from '../../agent-runtime/runtimeToolContract';

export type BridgeNamespace =
  | 'discord'
  | 'history'
  | 'context'
  | 'artifacts'
  | 'approvals'
  | 'admin'
  | 'moderation'
  | 'schedule';
export type InjectedBridgeNamespace = BridgeNamespace | 'http' | 'workspace';

export type BridgeMutability = 'read' | 'write';
export type BridgeAccess = 'public' | 'moderator' | 'admin' | 'owner';
export type BridgeApprovalMode = 'none' | 'required';

export interface BridgeMethodContext {
  toolContext: ToolExecutionContext;
}

export interface BridgeMethodDefinition<TArgs = unknown> {
  namespace: BridgeNamespace;
  method: string;
  summary: string;
  input: z.ZodType<TArgs>;
  mutability: BridgeMutability;
  access?: BridgeAccess;
  approvalMode?: BridgeApprovalMode;
  execute: (args: TArgs, context: BridgeMethodContext) => Promise<unknown>;
}

export interface BridgeMethodSummary {
  key: string;
  namespace: InjectedBridgeNamespace;
  method: string;
  summary: string;
  mutability: BridgeMutability;
  access: BridgeAccess;
  approvalMode: BridgeApprovalMode;
  requiredArgs: string[];
  optionalArgs: string[];
}
