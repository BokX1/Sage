import type {
  BridgeAccess,
  BridgeMethodDefinition,
  BridgeMethodSummary,
  InjectedBridgeNamespace,
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
import { z } from 'zod';

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
    summary: 'List the bridge namespaces and methods currently available to this actor in this turn.',
    mutability: 'read',
    access: 'public',
    approvalMode: 'none',
    requiredArgs: [],
    optionalArgs: [],
  },
  {
    key: toBridgeMethodKey('http', 'fetch'),
    namespace: 'http',
    method: 'fetch',
    summary: 'Fetch an external HTTP or HTTPS URL through Sage’s host-managed egress layer.',
    mutability: 'read',
    access: 'public',
    approvalMode: 'none',
    requiredArgs: ['url'],
    optionalArgs: ['method', 'headers', 'bodyText'],
  },
  {
    key: toBridgeMethodKey('workspace', 'read'),
    namespace: 'workspace',
    method: 'read',
    summary: 'Read a text file from the current task workspace.',
    mutability: 'read',
    access: 'public',
    approvalMode: 'none',
    requiredArgs: ['path'],
    optionalArgs: [],
  },
  {
    key: toBridgeMethodKey('workspace', 'write'),
    namespace: 'workspace',
    method: 'write',
    summary: 'Write a text file in the current task workspace.',
    mutability: 'write',
    access: 'public',
    approvalMode: 'required',
    requiredArgs: ['path', 'content'],
    optionalArgs: [],
  },
  {
    key: toBridgeMethodKey('workspace', 'append'),
    namespace: 'workspace',
    method: 'append',
    summary: 'Append text to a file in the current task workspace.',
    mutability: 'write',
    access: 'public',
    approvalMode: 'required',
    requiredArgs: ['path', 'content'],
    optionalArgs: [],
  },
  {
    key: toBridgeMethodKey('workspace', 'list'),
    namespace: 'workspace',
    method: 'list',
    summary: 'List files and folders in the current task workspace.',
    mutability: 'read',
    access: 'public',
    approvalMode: 'none',
    requiredArgs: [],
    optionalArgs: ['path'],
  },
  {
    key: toBridgeMethodKey('workspace', 'search'),
    namespace: 'workspace',
    method: 'search',
    summary: 'Search text files in the current task workspace.',
    mutability: 'read',
    access: 'public',
    approvalMode: 'none',
    requiredArgs: ['query'],
    optionalArgs: ['path'],
  },
  {
    key: toBridgeMethodKey('workspace', 'delete'),
    namespace: 'workspace',
    method: 'delete',
    summary: 'Delete a file or folder from the current task workspace.',
    mutability: 'write',
    access: 'public',
    approvalMode: 'required',
    requiredArgs: ['path'],
    optionalArgs: [],
  },
];

function extractInputArgs(input: z.ZodType<unknown>): {
  requiredArgs: string[];
  optionalArgs: string[];
} {
  const schema = z.toJSONSchema(input);
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { requiredArgs: [], optionalArgs: [] };
  }
  const properties =
    'properties' in schema && schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? Object.keys(schema.properties)
      : [];
  const required = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === 'string')
    : [];
  const requiredArgs = properties.filter((name) => required.includes(name));
  const optionalArgs = properties.filter((name) => !required.includes(name));
  return { requiredArgs, optionalArgs };
}

function toSummary(
  namespace: InjectedBridgeNamespace,
  method: BridgeMethodDefinition<unknown>,
): BridgeMethodSummary {
  const { requiredArgs, optionalArgs } = extractInputArgs(method.input);
  return {
    key: toBridgeMethodKey(namespace, method.method),
    namespace,
    method: method.method,
    summary: method.summary,
    mutability: method.mutability,
    access: method.access ?? 'public',
    approvalMode: method.approvalMode ?? 'none',
    requiredArgs,
    optionalArgs,
  };
}

export function listBridgeMethodSummaries(): BridgeMethodSummary[] {
  const declared = (Object.entries(FIXED_BRIDGE_CONTRACT) as Array<[BridgeNamespace, BridgeMethodMap]>)
    .flatMap(([namespace, methods]) =>
      Object.values(methods).map((method) => toSummary(namespace, method)),
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
