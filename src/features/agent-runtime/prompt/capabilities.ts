import {
  listBridgeMethodSummaries,
  listBridgeMethodSummariesForAuthority,
} from '../../code-mode/bridge/contract';
import type { InjectedBridgeNamespace } from '../../code-mode/bridge/types';
import type { DiscordAuthorityTier } from '../../../platform/discord/admin-permissions';
import type {
  PromptCapabilityMethod,
  PromptCapabilityNamespaceSnapshot,
  PromptCapabilitySnapshot,
} from './types';

export const PROMPT_NAMESPACE_ORDER: InjectedBridgeNamespace[] = [
  'discord',
  'history',
  'context',
  'artifacts',
  'approvals',
  'admin',
  'moderation',
  'schedule',
  'http',
  'workspace',
];

export const PROMPT_NAMESPACE_OWNERSHIP: Readonly<Record<InjectedBridgeNamespace, string>> =
  Object.freeze({
    discord: 'Live Discord actions only.',
    history: 'Stored transcript retrieval and search only.',
    context: 'Summaries and profile memory only.',
    artifacts: 'Artifact lifecycle and publication.',
    approvals: 'Approval record reads only.',
    admin: 'Guild instructions and runtime capability introspection.',
    moderation: 'Moderation cases, notes, and moderator-only enforcement actions.',
    schedule: 'Scheduled job inspection and control.',
    http: 'Host-mediated outbound HTTP only.',
    workspace: 'Task-scoped workspace files only.',
  });

function toPromptCapabilityMethod(method: ReturnType<typeof listBridgeMethodSummaries>[number]): PromptCapabilityMethod {
  return {
    method: method.method,
    access: method.access,
    approvalMode: method.approvalMode,
  };
}

export function buildPromptCapabilitySnapshot(
  authority: DiscordAuthorityTier | null | undefined,
): PromptCapabilitySnapshot {
  const methodsByNamespace = new Map<InjectedBridgeNamespace, PromptCapabilityMethod[]>();

  for (const method of listBridgeMethodSummariesForAuthority(authority)) {
    const bucket = methodsByNamespace.get(method.namespace) ?? [];
    bucket.push(toPromptCapabilityMethod(method));
    methodsByNamespace.set(method.namespace, bucket);
  }

  const namespaces: PromptCapabilityNamespaceSnapshot[] = PROMPT_NAMESPACE_ORDER.flatMap(
    (namespace) => {
      const methods = methodsByNamespace.get(namespace) ?? [];
      if (methods.length === 0) {
        return [];
      }

      return [
        {
          namespace,
          ownership: PROMPT_NAMESPACE_OWNERSHIP[namespace],
          methods: methods.sort((left, right) => left.method.localeCompare(right.method)),
        },
      ];
    },
  );

  return { namespaces };
}

export function buildPromptCapabilityOwnershipLines(): string[] {
  return PROMPT_NAMESPACE_ORDER.map(
    (namespace) => `- ${namespace}: ${PROMPT_NAMESPACE_OWNERSHIP[namespace]}`,
  );
}

export function buildPromptCapabilityFingerprintSource(): string {
  return JSON.stringify({
    namespaces: PROMPT_NAMESPACE_ORDER.map((namespace) => ({
      namespace,
      ownership: PROMPT_NAMESPACE_OWNERSHIP[namespace],
    })),
    methods: listBridgeMethodSummaries().map((method) => ({
      key: method.key,
      summary: method.summary,
      mutability: method.mutability,
      access: method.access,
      approvalMode: method.approvalMode,
      requiredArgs: method.requiredArgs,
      optionalArgs: method.optionalArgs,
    })),
  });
}

export function buildPromptCapabilityArgumentNotes(): string[] {
  return [
    'Use top-level namespaces directly, for example discord.messages.send(...), history.search(...), context.summary.get(...), or admin.runtime.getCapabilities().',
    'Use history.* for stored retrieval/search and discord.* for live Discord actions.',
    'There is no sage.* root object and no generic tool-dispatch fallback.',
  ];
}
