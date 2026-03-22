import { config as appConfig } from '../../../platform/config/env';
import type { McpServerConfig, McpServerDescriptor, McpServerTrustLevel } from './types';
import { sanitizeMcpServerId } from './naming';

type PresetId = 'github' | 'context7' | 'playwright' | 'firecrawl' | 'markitdown';

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

function parseJsonStringArray(value: string, label: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error(`${label} must be a JSON array of strings.`);
  }
  return parsed;
}

function parseEnabledPresetIds(value: string): Set<PresetId> {
  const supported = new Set<PresetId>(['github', 'context7', 'playwright', 'firecrawl', 'markitdown']);
  const enabled = new Set<PresetId>();
  for (const entry of value.split(',')) {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) continue;
    if (supported.has(normalized as PresetId)) {
      enabled.add(normalized as PresetId);
      continue;
    }
    throw new Error(`Unsupported MCP preset "${normalized}".`);
  }
  return enabled;
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

  const base: Omit<McpServerConfig, 'transport'> = {
    id,
    enabled: record.enabled !== false,
    trustLevel: record.trustLevel === 'trusted' ? 'trusted' : 'untrusted',
    source: 'custom',
    presetId: undefined,
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
      ...base,
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
    ...base,
    transport: {
      kind,
      url,
      headers,
    },
  };
}

function buildPresetServerConfig(params: {
  id: PresetId;
  trustLevel: McpServerTrustLevel;
  transport: 'stdio' | 'streamable_http';
  command: string;
  argsJson: string;
  url: string;
  token?: string;
  stdioEnv?: Record<string, string>;
  httpHeaders?: Record<string, string>;
  allow?: McpServerConfig['allow'];
}): McpServerConfig {
  const base: Omit<McpServerConfig, 'transport'> = {
    id: params.id,
    enabled: true,
    trustLevel: params.trustLevel,
    source: 'preset',
    presetId: params.id,
    allow: params.allow,
  };

  if (params.transport === 'streamable_http') {
    if (!params.url.trim()) {
      throw new Error(`MCP_PRESET_${params.id.toUpperCase()}_URL is required when the preset transport is streamable_http.`);
    }
    const headers: Record<string, string> = {
      ...(params.httpHeaders ?? {}),
    };
    if (params.token?.trim()) {
      headers.Authorization = `Bearer ${params.token.trim()}`;
    }
    return {
      ...base,
      transport: {
        kind: 'streamable_http',
        url: params.url.trim(),
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      },
    };
  }

  if (!params.command.trim()) {
    throw new Error(`MCP_PRESET_${params.id.toUpperCase()}_COMMAND is required when the preset transport is stdio.`);
  }
  const env = {
    ...(params.stdioEnv ?? {}),
  };
  return {
    ...base,
    transport: {
      kind: 'stdio',
      command: params.command.trim(),
      args: parseJsonStringArray(params.argsJson, `MCP_PRESET_${params.id.toUpperCase()}_ARGS_JSON`),
      env: Object.keys(env).length > 0 ? env : undefined,
      stderr: 'inherit',
    },
  };
}

function buildPresetConfigs(env: typeof appConfig): McpServerConfig[] {
  const enabled = parseEnabledPresetIds(env.MCP_PRESETS_ENABLED_CSV);
  const servers: McpServerConfig[] = [];

  if (enabled.has('github')) {
    const requestedToolsets = env.MCP_PRESET_GITHUB_TOOLSETS_CSV
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .join(',');

    servers.push(
      buildPresetServerConfig({
        id: 'github',
        trustLevel: 'trusted',
        transport: env.MCP_PRESET_GITHUB_TRANSPORT,
        command: env.MCP_PRESET_GITHUB_COMMAND,
        argsJson: env.MCP_PRESET_GITHUB_ARGS_JSON,
        url: env.MCP_PRESET_GITHUB_URL ?? '',
        token: env.MCP_PRESET_GITHUB_TOKEN,
        stdioEnv: {
          GITHUB_READ_ONLY: '1',
          ...(requestedToolsets ? { GITHUB_TOOLSETS: requestedToolsets } : {}),
          ...(env.MCP_PRESET_GITHUB_TOKEN?.trim()
            ? { GITHUB_PERSONAL_ACCESS_TOKEN: env.MCP_PRESET_GITHUB_TOKEN.trim() }
            : {}),
        },
        httpHeaders: {
          'X-MCP-Readonly': 'true',
          ...(requestedToolsets ? { 'X-MCP-Toolsets': requestedToolsets } : {}),
        },
      }),
    );
  }

  if (enabled.has('context7')) {
    servers.push(
      buildPresetServerConfig({
        id: 'context7',
        trustLevel: 'trusted',
        transport: env.MCP_PRESET_CONTEXT7_TRANSPORT,
        command: env.MCP_PRESET_CONTEXT7_COMMAND,
        argsJson: env.MCP_PRESET_CONTEXT7_ARGS_JSON,
        url: env.MCP_PRESET_CONTEXT7_URL ?? '',
        token: env.MCP_PRESET_CONTEXT7_TOKEN,
        stdioEnv: env.MCP_PRESET_CONTEXT7_TOKEN?.trim()
          ? { CONTEXT7_API_KEY: env.MCP_PRESET_CONTEXT7_TOKEN.trim() }
          : undefined,
      }),
    );
  }

  if (enabled.has('playwright')) {
    servers.push(
      buildPresetServerConfig({
        id: 'playwright',
        trustLevel: 'trusted',
        transport: env.MCP_PRESET_PLAYWRIGHT_TRANSPORT,
        command: env.MCP_PRESET_PLAYWRIGHT_COMMAND,
        argsJson: env.MCP_PRESET_PLAYWRIGHT_ARGS_JSON,
        url: env.MCP_PRESET_PLAYWRIGHT_URL ?? '',
        token: env.MCP_PRESET_PLAYWRIGHT_TOKEN,
      }),
    );
  }

  if (enabled.has('firecrawl')) {
    servers.push(
      buildPresetServerConfig({
        id: 'firecrawl',
        trustLevel: 'trusted',
        transport: env.MCP_PRESET_FIRECRAWL_TRANSPORT,
        command: env.MCP_PRESET_FIRECRAWL_COMMAND,
        argsJson: env.MCP_PRESET_FIRECRAWL_ARGS_JSON,
        url: env.MCP_PRESET_FIRECRAWL_URL ?? '',
        token: env.MCP_PRESET_FIRECRAWL_TOKEN,
      }),
    );
  }

  if (enabled.has('markitdown')) {
    servers.push(
      buildPresetServerConfig({
        id: 'markitdown',
        trustLevel: 'trusted',
        transport: env.MCP_PRESET_MARKITDOWN_TRANSPORT,
        command: env.MCP_PRESET_MARKITDOWN_COMMAND,
        argsJson: env.MCP_PRESET_MARKITDOWN_ARGS_JSON,
        url: env.MCP_PRESET_MARKITDOWN_URL ?? '',
        token: env.MCP_PRESET_MARKITDOWN_TOKEN,
      }),
    );
  }

  return servers;
}

export function loadMcpServerConfigs(
  env: typeof appConfig = appConfig,
  processEnv: NodeJS.ProcessEnv = process.env,
): McpServerDescriptor[] {
  const servers: McpServerConfig[] = [];
  if (env.MCP_EXTRA_SERVERS_JSON?.trim()) {
    const parsed = JSON.parse(interpolateEnvPlaceholders(env.MCP_EXTRA_SERVERS_JSON, processEnv)) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('MCP_EXTRA_SERVERS_JSON must be a JSON array.');
    }
    for (const entry of parsed) {
      servers.push(parseServerConfig(interpolateUnknown(entry, processEnv)));
    }
  }
  servers.push(...buildPresetConfigs(env));

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
