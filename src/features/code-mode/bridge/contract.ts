import type {
  BridgeAccess,
  BridgeMethodDefinition,
  BridgeMethodSummary,
  BridgeNamespace,
} from './types';
import { toBridgeMethodKey } from './common';
import {
  hasAuthorityAtLeast,
  type DiscordAuthorityTier,
} from '../../../platform/discord/admin-permissions';
import { adminDomainMethods } from './adminDomain';
import { approvalsDomainMethods } from './approvalsDomain';
import { artifactsDomainMethods } from './artifactsDomain';
import { contextDomainMethods } from './contextDomain';
import { discordDomainMethods } from './discordDomain';
import { historyDomainMethods } from './historyDomain';
import { moderationDomainMethods } from './moderationDomain';
import { scheduleDomainMethods } from './scheduleDomain';

// Erased contract view used only for the fixed namespace table and test injection.
// The per-method definitions remain strongly typed at their declaration sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BridgeMethodMap = Readonly<Record<string, BridgeMethodDefinition<any>>>;
export type FixedBridgeContract = Readonly<Record<BridgeNamespace, BridgeMethodMap>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMethodMap(definitions: ReadonlyArray<BridgeMethodDefinition<any>>): BridgeMethodMap {
  return Object.freeze(
    Object.fromEntries(
      definitions.map((definition) => [definition.method, definition]),
    ),
  );
}

export const FIXED_BRIDGE_CONTRACT: FixedBridgeContract = Object.freeze({
  discord: buildMethodMap(discordDomainMethods),
  history: buildMethodMap(historyDomainMethods),
  context: buildMethodMap(contextDomainMethods),
  artifacts: buildMethodMap(artifactsDomainMethods),
  approvals: buildMethodMap(approvalsDomainMethods),
  admin: buildMethodMap(adminDomainMethods),
  moderation: buildMethodMap(moderationDomainMethods),
  schedule: buildMethodMap(scheduleDomainMethods),
});

const SYNTHETIC_BRIDGE_METHOD_SUMMARIES: BridgeMethodSummary[] = [
  {
    key: toBridgeMethodKey('admin', 'runtime.getCapabilities'),
    namespace: 'admin',
    method: 'runtime.getCapabilities',
    mutability: 'read',
    access: 'public',
    approvalMode: 'none',
  },
];

export function listBridgeMethodSummaries(): BridgeMethodSummary[] {
  const declared = (Object.entries(FIXED_BRIDGE_CONTRACT) as Array<[BridgeNamespace, BridgeMethodMap]>)
    .flatMap(([namespace, methods]) =>
      Object.values(methods).map((method) => ({
        key: toBridgeMethodKey(namespace, method.method),
        namespace,
        method: method.method,
        mutability: method.mutability,
        access: method.access ?? 'public',
        approvalMode: method.approvalMode ?? 'none',
      })),
    )
    .concat(SYNTHETIC_BRIDGE_METHOD_SUMMARIES);

  return declared.sort((left, right) => left.key.localeCompare(right.key));
}

export function listBridgeMethodSummariesForAuthority(
  authority: DiscordAuthorityTier | null | undefined,
): BridgeMethodSummary[] {
  const normalizeRequiredAuthority = (access: BridgeAccess): DiscordAuthorityTier =>
    access === 'public' ? 'member' : access;

  return listBridgeMethodSummaries().filter((method) =>
    hasAuthorityAtLeast(authority ?? 'member', normalizeRequiredAuthority(method.access)),
  );
}
