import { config as appConfig } from '../../../platform/config/env';
import type { McpServerConfig, McpServerDescriptor } from './types';
import { sanitizeMcpServerId } from './naming';

function interpolateEnvPlaceholders(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key: string) => env[key] ?? '');
}

function interpolateUnknown(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value === 'string') {
    return interpolateEnvPlaceholders(value, env);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => interpolateUnknown(entry, env));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, interpolateUnknown(nested, env)]),
  );
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function parseServerConfig(value: unknown): McpServerConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MCP server entries must be objects.');
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) {
    throw new Error('MCP server entry is missing "id".');
  }

  const transport = record.transport;
  if (!transport || typeof transport !== 'object' || Array.isArray(transport)) {
    throw new Error(`MCP server "${id}" is missing a valid "transport" object.`);
  }
  const transportRecord = transport as Record<string, unknown>;
  const kind = typeof transportRecord.kind === 'string' ? transportRecord.kind.trim() : '';
  if (kind !== 'stdio' && kind !== 'streamable_http') {
    throw new Error(`MCP server "${id}" has unsupported transport kind "${kind}".`);
  }

  const allow = record.allow && typeof record.allow === 'object' && !Array.isArray(record.allow)
    ? (record.allow as Record<string, unknown>)
    : null;

  if (kind === 'stdio') {
    const command = typeof transportRecord.command === 'string' ? transportRecord.command.trim() : '';
    if (!command) {
      throw new Error(`MCP server "${id}" stdio transport is missing "command".`);
    }
    const env =
      transportRecord.env && typeof transportRecord.env === 'object' && !Array.isArray(transportRecord.env)
        ? Object.fromEntries(
            Object.entries(transportRecord.env as Record<string, unknown>)
              .filter(([, nested]) => typeof nested === 'string')
              .map(([key, nested]) => [key, String(nested)]),
          )
        : undefined;

    return {
      id,
      enabled: record.enabled !== false,
      trustLevel: record.trustLevel === 'trusted' ? 'trusted' : 'untrusted',
      transport: {
        kind,
        command,
        args: asStringArray(transportRecord.args),
        env,
        cwd: typeof transportRecord.cwd === 'string' ? transportRecord.cwd.trim() || undefined : undefined,
        stderr:
          transportRecord.stderr === 'pipe' || transportRecord.stderr === 'ignore'
            ? transportRecord.stderr
            : 'inherit',
      },
      allow: allow
        ? {
            tools: asStringArray(allow.tools),
            resources: asStringArray(allow.resources),
            prompts: asStringArray(allow.prompts),
          }
        : undefined,
      refresh:
        record.refresh && typeof record.refresh === 'object' && !Array.isArray(record.refresh)
          ? {
              discoverOnInit:
                (record.refresh as Record<string, unknown>).discoverOnInit !== false,
            }
          : undefined,
    };
  }

  const url = typeof transportRecord.url === 'string' ? transportRecord.url.trim() : '';
  if (!url) {
    throw new Error(`MCP server "${id}" streamable_http transport is missing "url".`);
  }
  const headers =
    transportRecord.headers && typeof transportRecord.headers === 'object' && !Array.isArray(transportRecord.headers)
      ? Object.fromEntries(
          Object.entries(transportRecord.headers as Record<string, unknown>)
            .filter(([, nested]) => typeof nested === 'string')
            .map(([key, nested]) => [key, String(nested)]),
        )
      : undefined;

  return {
    id,
    enabled: record.enabled !== false,
    trustLevel: record.trustLevel === 'trusted' ? 'trusted' : 'untrusted',
    transport: {
      kind,
      url,
      headers,
    },
    allow: allow
      ? {
          tools: asStringArray(allow.tools),
          resources: asStringArray(allow.resources),
          prompts: asStringArray(allow.prompts),
        }
      : undefined,
    refresh:
      record.refresh && typeof record.refresh === 'object' && !Array.isArray(record.refresh)
        ? {
            discoverOnInit:
              (record.refresh as Record<string, unknown>).discoverOnInit !== false,
          }
        : undefined,
  };
}

function buildGitHubPreset(env: typeof appConfig): McpServerConfig[] {
  if (!env.MCP_GITHUB_ENABLED) {
    return [];
  }

  const requestedToolsets = env.MCP_GITHUB_TOOLSETS_CSV
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .join(',');

  if (env.MCP_GITHUB_TRANSPORT === 'streamable_http') {
    if (!env.MCP_GITHUB_URL?.trim()) {
      throw new Error('MCP_GITHUB_URL is required when MCP_GITHUB_ENABLED=true and MCP_GITHUB_TRANSPORT=streamable_http.');
    }
    const headers: Record<string, string> = {
      'X-MCP-Readonly': 'true',
    };
    if (requestedToolsets.length > 0) {
      headers['X-MCP-Toolsets'] = requestedToolsets;
    }
    if (env.MCP_GITHUB_TOKEN?.trim()) {
      headers.Authorization = `Bearer ${env.MCP_GITHUB_TOKEN.trim()}`;
    }
    return [
      {
        id: 'github',
        enabled: true,
        trustLevel: 'trusted',
        transport: {
          kind: 'streamable_http',
          url: env.MCP_GITHUB_URL.trim(),
          headers: Object.keys(headers).length > 0 ? headers : undefined,
        },
        allow: {
          tools: undefined,
          resources: undefined,
          prompts: undefined,
        },
      },
    ];
  }

  if (!env.MCP_GITHUB_COMMAND?.trim()) {
    throw new Error('MCP_GITHUB_COMMAND is required when MCP_GITHUB_ENABLED=true and MCP_GITHUB_TRANSPORT=stdio.');
  }
  const args =
    env.MCP_GITHUB_ARGS_JSON?.trim()
      ? JSON.parse(env.MCP_GITHUB_ARGS_JSON) as unknown
      : [];
  if (!Array.isArray(args) || !args.every((entry) => typeof entry === 'string')) {
    throw new Error('MCP_GITHUB_ARGS_JSON must be a JSON array of strings.');
  }

  const transportEnv: Record<string, string> = {
    GITHUB_READ_ONLY: '1',
  };
  if (requestedToolsets.length > 0) {
    transportEnv.GITHUB_TOOLSETS = requestedToolsets;
  }
  if (env.MCP_GITHUB_TOKEN?.trim()) {
    transportEnv.GITHUB_PERSONAL_ACCESS_TOKEN = env.MCP_GITHUB_TOKEN.trim();
  }

  return [
    {
      id: 'github',
      enabled: true,
      trustLevel: 'trusted',
      transport: {
        kind: 'stdio',
        command: env.MCP_GITHUB_COMMAND.trim(),
        args,
        env: transportEnv,
        cwd: undefined,
        stderr: 'inherit',
      },
      allow: undefined,
    },
  ];
}

export function loadMcpServerConfigs(
  env: typeof appConfig = appConfig,
  processEnv: NodeJS.ProcessEnv = process.env,
): McpServerDescriptor[] {
  const servers: McpServerConfig[] = [];
  if (env.MCP_SERVERS_JSON?.trim()) {
    const parsed = JSON.parse(interpolateEnvPlaceholders(env.MCP_SERVERS_JSON, processEnv)) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('MCP_SERVERS_JSON must be a JSON array.');
    }
    for (const entry of parsed) {
      servers.push(parseServerConfig(interpolateUnknown(entry, processEnv)));
    }
  }
  servers.push(...buildGitHubPreset(env));

  const seen = new Set<string>();
  return servers
    .filter((server) => server.enabled)
    .map((server) => {
      const sanitizedId = sanitizeMcpServerId(server.id);
      if (seen.has(sanitizedId)) {
        throw new Error(`Duplicate MCP server id "${server.id}" after sanitization.`);
      }
      seen.add(sanitizedId);
      return {
        ...server,
        sanitizedId,
      };
    });
}
