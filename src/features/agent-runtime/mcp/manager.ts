import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { logger } from '../../../platform/logging/logger';
import {
  defineToolSpecV2,
  globalToolRegistry,
  type ToolRegistry,
  type ToolSpecV2,
} from '../toolRegistry';
import {
  ToolDetailedError,
  buildToolErrorDetails,
  extractToolErrorDetails,
  type ToolErrorDetails,
} from '../toolErrors';
import { buildToolCacheKey } from '../toolCache';
import { sanitizeJsonSchemaForProvider } from '../../../shared/validation/json-schema';
import { buildStableMcpToolName } from './naming';
import { convertJsonSchemaToZod } from './jsonSchemaToZod';
import { loadMcpServerConfigs } from './config';
import type {
  McpServerDiagnostic,
  McpDiscoverySnapshot,
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpResourceTemplateDescriptor,
  McpServerDescriptor,
  McpToolBinding,
  McpToolDescriptor,
  McpToolExecutionResult,
  McpToolExposureResult,
} from './types';

type McpClientTransport = StdioClientTransport | StreamableHTTPClientTransport;

type ServerRuntime = {
  descriptor: McpServerDescriptor;
  client: Client;
  transport: McpClientTransport;
  snapshot: McpDiscoverySnapshot;
  bindings: Map<string, McpToolBinding>;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function matchesAllowList(value: string, allowList?: string[]): boolean {
  if (!allowList || allowList.length === 0) return true;
  return allowList.includes(value);
}

function normalizeToolDescriptor(raw: Record<string, unknown>): McpToolDescriptor {
  return {
    name: String(raw.name ?? ''),
    title: typeof raw.title === 'string' ? raw.title : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    inputSchema: toRecord(raw.inputSchema) ?? { type: 'object', properties: {}, additionalProperties: true },
    outputSchema: toRecord(raw.outputSchema) ?? undefined,
    annotations: toRecord(raw.annotations) ?? undefined,
  };
}

function normalizeResourceDescriptor(raw: Record<string, unknown>): McpResourceDescriptor {
  return {
    uri: String(raw.uri ?? ''),
    name: String(raw.name ?? ''),
    description: typeof raw.description === 'string' ? raw.description : undefined,
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : undefined,
  };
}

function normalizeResourceTemplateDescriptor(raw: Record<string, unknown>): McpResourceTemplateDescriptor {
  return {
    uriTemplate: String(raw.uriTemplate ?? raw.uri ?? ''),
    name: String(raw.name ?? ''),
    description: typeof raw.description === 'string' ? raw.description : undefined,
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : undefined,
  };
}

function normalizePromptDescriptor(raw: Record<string, unknown>): McpPromptDescriptor {
  return {
    name: String(raw.name ?? ''),
    description: typeof raw.description === 'string' ? raw.description : undefined,
  };
}

function extractTextContent(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((entry) => {
    const record = toRecord(entry);
    if (!record) return [];
    if (record.type === 'text' && typeof record.text === 'string') {
      return [record.text];
    }
    return [];
  });
}

function extractStructuredContent(value: unknown): unknown {
  const record = toRecord(value);
  if (!record) return undefined;
  if ('structuredContent' in record) {
    return record.structuredContent;
  }
  return undefined;
}

function resolveTransportHost(descriptor: McpServerDescriptor): string | undefined {
  if (descriptor.transport.kind !== 'streamable_http') {
    return undefined;
  }
  try {
    return new URL(descriptor.transport.url).host;
  } catch {
    return undefined;
  }
}

function isGitHubServer(descriptor: McpServerDescriptor): boolean {
  return descriptor.id === 'github' || descriptor.sanitizedId === 'github';
}

function isGitHubAuthConfigured(descriptor: McpServerDescriptor): boolean {
  if (!isGitHubServer(descriptor)) {
    return false;
  }
  if (descriptor.transport.kind === 'streamable_http') {
    return typeof descriptor.transport.headers?.Authorization === 'string'
      && descriptor.transport.headers.Authorization.trim().length > 0;
  }
  return typeof descriptor.transport.env?.GITHUB_PERSONAL_ACCESS_TOKEN === 'string'
    && descriptor.transport.env.GITHUB_PERSONAL_ACCESS_TOKEN.trim().length > 0;
}

function isExposedTool(runtime: ServerRuntime, rawToolName: string): boolean {
  return runtime.snapshot.exposure.some((entry) => entry.exposed && entry.rawToolName === rawToolName);
}

function buildMcpOperationKey(params: {
  descriptor: McpServerDescriptor;
  rawToolName: string;
  args: unknown;
}): string {
  return buildToolCacheKey(
    buildStableMcpToolName({
      serverId: params.descriptor.sanitizedId,
      rawToolName: params.rawToolName,
    }),
    params.args,
  );
}

function createMcpToolDetailedError(params: {
  message: string;
  descriptor: McpServerDescriptor;
  details: ToolErrorDetails;
  cause?: unknown;
}): ToolDetailedError {
  return new ToolDetailedError(
    params.message,
    buildToolErrorDetails({
      ...params.details,
      provider: params.details.provider ?? `mcp:${params.descriptor.id}`,
      host: params.details.host ?? resolveTransportHost(params.descriptor),
    }),
    { cause: params.cause },
  );
}

function classifyGitHubToolFailure(params: {
  descriptor: McpServerDescriptor;
  rawToolName: string;
  args?: unknown;
  message: string;
  details: ToolErrorDetails;
  cause?: unknown;
}): ToolDetailedError {
  const category = params.details.category;
  const baseDetails = {
    ...params.details,
    provider: 'github-mcp',
    host: resolveTransportHost(params.descriptor),
  } satisfies ToolErrorDetails;

  if (category === 'unauthorized' || category === 'forbidden') {
    if (params.rawToolName === 'get_me') {
      return new ToolDetailedError(
        'GitHub MCP authentication failed for the configured token.',
        buildToolErrorDetails({
          ...baseDetails,
          code: 'github_mcp_auth_failed',
          hint: 'The configured GitHub token could not authenticate with GitHub MCP. Check MCP_GITHUB_TOKEN and the selected transport configuration.',
          retryable: false,
        }),
        { cause: params.cause },
      );
    }

    if (params.rawToolName === 'search_code') {
      return new ToolDetailedError(
        'GitHub code search was denied for this request.',
        buildToolErrorDetails({
          ...baseDetails,
          code: 'github_mcp_search_code_access_denied',
          operationKey: buildMcpOperationKey({
            descriptor: params.descriptor,
            rawToolName: params.rawToolName,
            args: params.args,
          }),
          hint: 'The GitHub MCP server is reachable, but this repo or query may not be searchable with the current token. If the exact repo/path is known, use mcp__github__get_file_contents instead, or ask the user to confirm repository visibility or provide repo/path.',
          retryable: false,
        }),
        { cause: params.cause },
      );
    }

    return new ToolDetailedError(
      `GitHub MCP tool "${params.rawToolName}" was denied for this request.`,
      buildToolErrorDetails({
        ...baseDetails,
        code: 'github_mcp_tool_access_denied',
        hint: 'The current GitHub token may not have access to the requested repository or resource. Confirm access or ask the user for a narrower repository/path target.',
        retryable: false,
      }),
      { cause: params.cause },
    );
  }

  if (category === 'not_found') {
    return new ToolDetailedError(
      `GitHub MCP tool "${params.rawToolName}" did not find the requested resource.`,
      buildToolErrorDetails({
        ...baseDetails,
        code: 'github_mcp_not_found',
        hint: 'Confirm the owner, repository, and exact path or identifier before retrying.',
        retryable: false,
      }),
      { cause: params.cause },
    );
  }

  if (
    category === 'network_error'
    || category === 'timeout'
    || category === 'server_error'
    || category === 'upstream_error'
    || category === 'misconfigured'
  ) {
    return new ToolDetailedError(
      `GitHub MCP is unavailable for "${params.rawToolName}" right now.`,
      buildToolErrorDetails({
        ...baseDetails,
        code: 'github_mcp_unavailable',
        hint: 'The GitHub MCP server or upstream GitHub endpoint is unavailable. Treat this as a server or transport problem, not proof that repository access is permanently broken.',
      }),
      { cause: params.cause },
    );
  }

  return new ToolDetailedError(
    `GitHub MCP tool "${params.rawToolName}" failed.`,
    buildToolErrorDetails({
      ...baseDetails,
      code: 'github_mcp_tool_failure',
      hint: 'Treat this as a scoped GitHub MCP tool failure unless diagnostics show a broader outage.',
    }),
    { cause: params.cause },
  );
}

function classifyMcpToolFailure(params: {
  descriptor: McpServerDescriptor;
  rawToolName: string;
  args?: unknown;
  message: string;
  cause?: unknown;
}): ToolDetailedError {
  const details =
    extractToolErrorDetails(params.cause)
    ?? extractToolErrorDetails(new Error(params.message))
    ?? buildToolErrorDetails({ category: 'upstream_error' });

  if (isGitHubServer(params.descriptor)) {
    return classifyGitHubToolFailure({
      descriptor: params.descriptor,
      rawToolName: params.rawToolName,
      args: params.args,
      message: params.message,
      details,
      cause: params.cause,
    });
  }

  if (details.category === 'network_error' || details.category === 'timeout') {
    return createMcpToolDetailedError({
      message: `MCP server "${params.descriptor.id}" is unavailable for tool "${params.rawToolName}".`,
      descriptor: params.descriptor,
      details: {
        ...details,
        code: 'mcp_server_unavailable',
      },
      cause: params.cause,
    });
  }

  return createMcpToolDetailedError({
    message: `MCP tool "${params.rawToolName}" from server "${params.descriptor.id}" failed.`,
    descriptor: params.descriptor,
    details,
    cause: params.cause,
  });
}

function extractMcpErrorMessage(result: unknown, fallbackToolName: string): string {
  const text = extractTextContent(toRecord(result)?.content).join('\n').trim();
  if (text) {
    return text;
  }
  return `MCP tool "${fallbackToolName}" reported an error.`;
}

function buildPromptGuidance(tool: McpToolDescriptor, serverId: string) {
  return {
    summary:
      tool.description?.trim() ||
      `Call the ${tool.name} tool exposed by MCP server "${serverId}" when its capability matches the request.`,
    argumentNotes: [
      `This tool is provided by the MCP server "${serverId}".`,
    ],
  };
}

function resolveReadOnlyHint(params: {
  descriptor: McpServerDescriptor;
  tool: McpToolDescriptor;
}): boolean {
  if (params.descriptor.trustLevel !== 'trusted') {
    return false;
  }
  const annotations = params.tool.annotations ?? {};
  return annotations.readOnlyHint === true || annotations.readOnly === true;
}

function buildMcpToolSpec(params: {
  server: McpServerDescriptor;
  tool: McpToolDescriptor;
  toolName: string;
  manager: McpManager;
}): ToolSpecV2<unknown, unknown> {
  const inputSchema = sanitizeJsonSchemaForProvider(params.tool.inputSchema);
  const inputValidator = convertJsonSchemaToZod(inputSchema);
  const readOnly = resolveReadOnlyHint({
    descriptor: params.server,
    tool: params.tool,
  });

  return defineToolSpecV2({
    name: params.toolName,
    title: params.tool.title ?? params.tool.name,
    description:
      params.tool.description?.trim() ||
      `MCP tool "${params.tool.name}" from server "${params.server.id}".`,
    input: inputValidator as z.ZodType<unknown>,
    outputSchema: params.tool.outputSchema ? sanitizeJsonSchemaForProvider(params.tool.outputSchema) : undefined,
    annotations: {
      readOnlyHint: readOnly,
      parallelSafe: readOnly,
    },
    runtime: {
      class: readOnly ? 'query' : 'mutation',
      readOnly,
      observationPolicy: 'default',
      capabilityTags: ['mcp', params.server.sanitizedId],
      actionPolicy: () => ({
        mutability: readOnly ? 'read' : 'write',
        approvalMode: readOnly ? 'none' : 'required',
        approvalGroupKey: `mcp:${params.server.sanitizedId}:${params.tool.name}`,
      }),
    },
    prompt: buildPromptGuidance(params.tool, params.server.id),
    smoke: {
      mode: 'skip',
      reason: `MCP tool "${params.tool.name}" requires external server availability.`,
    },
    validationHint: `This MCP tool expects object-shaped JSON arguments that match the server-advertised schema.`,
    execute: async (args): Promise<McpToolExecutionResult> =>
      params.manager.callTool({
        serverId: params.server.id,
        rawToolName: params.tool.name,
        args,
      }),
  });
}

export class McpManager {
  private runtimes = new Map<string, ServerRuntime>();
  private initialized = false;

  async initialize(registry: ToolRegistry = globalToolRegistry): Promise<void> {
    if (this.initialized) {
      for (const runtime of this.runtimes.values()) {
        this.registerExposedTools(runtime, registry);
      }
      return;
    }
    const descriptors = loadMcpServerConfigs();
    for (const descriptor of descriptors) {
      const runtime = await this.connectServer(descriptor);
      this.runtimes.set(descriptor.id, runtime);
      this.registerExposedTools(runtime, registry);
    }
    this.initialized = true;
  }

  private async connectServer(descriptor: McpServerDescriptor): Promise<ServerRuntime> {
    const client = new Client({
      name: 'sage',
      version: '1.0.0',
    });
    const transport =
      descriptor.transport.kind === 'stdio'
        ? new StdioClientTransport({
            command: descriptor.transport.command,
            args: descriptor.transport.args,
            env: descriptor.transport.env,
            cwd: descriptor.transport.cwd,
            stderr: descriptor.transport.stderr ?? 'inherit',
          })
        : new StreamableHTTPClientTransport(new URL(descriptor.transport.url), {
            requestInit: {
              headers: descriptor.transport.headers,
            },
          });

    const snapshot: McpDiscoverySnapshot = {
      server: descriptor,
      connected: false,
      discoveredAtIso: null,
      tools: [],
      resources: [],
      resourceTemplates: [],
      prompts: [],
      exposure: [],
    };
    const runtime: ServerRuntime = {
      descriptor,
      client,
      transport,
      snapshot,
      bindings: new Map<string, McpToolBinding>(),
    };

    try {
      await client.connect(transport);
      snapshot.connected = true;
      if (descriptor.refresh?.discoverOnInit === false) {
        snapshot.exposure = [];
      } else {
        await this.refreshDiscovery(runtime);
      }
    } catch (error) {
      snapshot.connected = false;
      snapshot.errorText = error instanceof Error ? error.message : String(error);
      logger.warn({ error, serverId: descriptor.id }, 'Failed to initialize MCP server');
    }

    return runtime;
  }

  private async refreshDiscovery(runtime: ServerRuntime): Promise<void> {
    const { client, descriptor, snapshot } = runtime;
    const [toolResult, resourceResult, templateResult, promptResult] = await Promise.all([
      client.listTools().catch((error) => ({ tools: [], _error: error })),
      client.listResources().catch((error) => ({ resources: [], _error: error })),
      client.listResourceTemplates().catch((error) => ({ resourceTemplates: [], _error: error })),
      client.listPrompts().catch((error) => ({ prompts: [], _error: error })),
    ]);

    snapshot.tools = Array.isArray(toolResult.tools)
      ? toolResult.tools
          .map((tool) => normalizeToolDescriptor(toRecord(tool) ?? {}))
          .filter((tool) => tool.name.length > 0 && matchesAllowList(tool.name, descriptor.allow?.tools))
      : [];
    snapshot.resources = Array.isArray(resourceResult.resources)
      ? resourceResult.resources
          .map((resource) => normalizeResourceDescriptor(toRecord(resource) ?? {}))
          .filter((resource) => resource.name.length > 0 && matchesAllowList(resource.name, descriptor.allow?.resources))
      : [];
    snapshot.resourceTemplates = Array.isArray(templateResult.resourceTemplates)
      ? templateResult.resourceTemplates
          .map((resource) => normalizeResourceTemplateDescriptor(toRecord(resource) ?? {}))
          .filter((resource) => resource.name.length > 0 && matchesAllowList(resource.name, descriptor.allow?.resources))
      : [];
    snapshot.prompts = Array.isArray(promptResult.prompts)
      ? promptResult.prompts
          .map((prompt) => normalizePromptDescriptor(toRecord(prompt) ?? {}))
          .filter((prompt) => prompt.name.length > 0 && matchesAllowList(prompt.name, descriptor.allow?.prompts))
      : [];
    snapshot.discoveredAtIso = new Date().toISOString();
    snapshot.exposure = this.buildExposure(runtime);
  }

  private buildExposure(runtime: ServerRuntime): McpToolExposureResult[] {
    const existingNames = new Set<string>();
    const exposure: McpToolExposureResult[] = [];
    runtime.bindings.clear();

    for (const tool of runtime.snapshot.tools) {
      const baseToolName = buildStableMcpToolName({
        serverId: runtime.descriptor.id,
        rawToolName: tool.name,
        existingNames,
      });
      existingNames.add(baseToolName);
      try {
        convertJsonSchemaToZod(sanitizeJsonSchemaForProvider(tool.inputSchema));
        const binding: McpToolBinding = {
          toolName: baseToolName,
          serverId: runtime.descriptor.id,
          rawToolName: tool.name,
        };
        runtime.bindings.set(baseToolName, binding);
        exposure.push({
          serverId: runtime.descriptor.id,
          rawToolName: tool.name,
          exposed: true,
          boundToolName: baseToolName,
        });
      } catch (error) {
        exposure.push({
          serverId: runtime.descriptor.id,
          rawToolName: tool.name,
          exposed: false,
          boundToolName: null,
          disableReason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return exposure;
  }

  private registerExposedTools(runtime: ServerRuntime, registry: ToolRegistry): void {
    for (const result of runtime.snapshot.exposure) {
      if (!result.exposed || !result.boundToolName) continue;
      const tool = runtime.snapshot.tools.find((entry) => entry.name === result.rawToolName);
      if (!tool) continue;
      if (registry.has(result.boundToolName)) continue;
      registry.register(
        buildMcpToolSpec({
          server: runtime.descriptor,
          tool,
          toolName: result.boundToolName,
          manager: this,
        }),
      );
    }
  }

  listDiscoverySnapshots(): McpDiscoverySnapshot[] {
    return Array.from(this.runtimes.values()).map((runtime) => ({
      ...runtime.snapshot,
      exposure: [...runtime.snapshot.exposure],
      tools: [...runtime.snapshot.tools],
      resources: [...runtime.snapshot.resources],
      resourceTemplates: [...runtime.snapshot.resourceTemplates],
      prompts: [...runtime.snapshot.prompts],
    }));
  }

  async probeDiagnostics(): Promise<McpServerDiagnostic[]> {
    const diagnostics: McpServerDiagnostic[] = [];

    for (const runtime of this.runtimes.values()) {
      if (!isGitHubServer(runtime.descriptor) || !isGitHubAuthConfigured(runtime.descriptor)) {
        continue;
      }

      if (!runtime.snapshot.connected) {
        diagnostics.push({
          kind: 'github_capability',
          serverId: runtime.descriptor.id,
          status: 'unavailable',
          authProbe: 'skip',
          codeSearchProbe: 'skip',
          summary: 'GitHub MCP is configured but unavailable.',
          details: [runtime.snapshot.errorText?.trim() || 'The configured GitHub MCP server could not be reached.'],
        });
        continue;
      }

      const hasGetMe = isExposedTool(runtime, 'get_me');
      const hasSearchCode = isExposedTool(runtime, 'search_code');

      if (hasGetMe) {
        try {
          await this.callTool({
            serverId: runtime.descriptor.id,
            rawToolName: 'get_me',
            args: {},
          });
        } catch (error) {
          const details = extractToolErrorDetails(error);
          diagnostics.push({
            kind: 'github_capability',
            serverId: runtime.descriptor.id,
            status: 'unavailable',
            authProbe: 'fail',
            codeSearchProbe: 'skip',
            summary: 'GitHub MCP discovery succeeded, but baseline auth failed.',
            details: [
              error instanceof Error ? error.message : String(error),
              details?.hint ?? 'Check MCP_GITHUB_TOKEN and the configured GitHub MCP transport.',
            ],
          });
          continue;
        }
      }

      if (!hasSearchCode) {
        diagnostics.push({
          kind: 'github_capability',
          serverId: runtime.descriptor.id,
          status: 'partial',
          authProbe: hasGetMe ? 'pass' : 'skip',
          codeSearchProbe: 'skip',
          summary:
            hasGetMe
              ? 'GitHub MCP authenticated, but search_code is not exposed in the current tool surface.'
              : 'GitHub MCP is connected, but neither get_me nor search_code is exposed in the current tool surface.',
          details: [
            hasGetMe
              ? 'The GitHub MCP server connected successfully, but search_code is not currently exposed or provider-safe.'
              : 'The current GitHub MCP allowlist or provider-safe exposure rules do not expose the baseline auth or code-search probes.',
          ],
        });
        continue;
      }

      try {
        await this.callTool({
          serverId: runtime.descriptor.id,
          rawToolName: 'search_code',
          args: {
            query: 'repo:github/github-mcp-server search_code',
          },
        });
        diagnostics.push({
          kind: 'github_capability',
          serverId: runtime.descriptor.id,
          status: 'healthy',
          authProbe: hasGetMe ? 'pass' : 'skip',
          codeSearchProbe: 'pass',
          summary:
            hasGetMe
              ? 'GitHub MCP auth and baseline code search both succeeded.'
              : 'GitHub MCP baseline code search succeeded under the current restricted tool surface.',
          details:
            hasGetMe
              ? []
              : ['Baseline auth probing was skipped because get_me is not exposed in the current GitHub MCP tool surface.'],
        });
      } catch (error) {
        const details = extractToolErrorDetails(error);
        diagnostics.push({
          kind: 'github_capability',
          serverId: runtime.descriptor.id,
          status: 'partial',
          authProbe: hasGetMe ? 'pass' : 'skip',
          codeSearchProbe: 'fail',
          summary:
            hasGetMe
              ? 'GitHub MCP authenticated, but baseline code search is restricted or unavailable.'
              : 'GitHub MCP search_code is exposed, but baseline auth probing was skipped and code search is restricted or unavailable.',
          details: [
            error instanceof Error ? error.message : String(error),
            ...(!hasGetMe
              ? ['Baseline auth probing was skipped because get_me is not exposed in the current GitHub MCP tool surface.']
              : []),
            details?.hint ?? 'Treat this as a scoped GitHub code-search capability problem, not a blanket MCP outage.',
          ],
        });
      }
    }

    return diagnostics;
  }

  async callTool(params: {
    serverId: string;
    rawToolName: string;
    args: unknown;
  }): Promise<McpToolExecutionResult> {
    const runtime = this.runtimes.get(params.serverId);
    if (!runtime || !runtime.snapshot.connected) {
      const descriptor = runtime?.descriptor ?? {
        id: params.serverId,
        sanitizedId: params.serverId,
        enabled: true,
        trustLevel: 'untrusted',
        transport: {
          kind: 'stdio',
          command: 'unavailable',
        },
      } satisfies McpServerDescriptor;
      throw createMcpToolDetailedError({
        message: `MCP server "${params.serverId}" is unavailable.`,
        descriptor,
        details: {
          category: 'network_error',
          code: 'mcp_server_unavailable',
          hint: 'The configured MCP server is unavailable right now.',
        },
      });
    }

    let result: Awaited<ReturnType<typeof runtime.client.callTool>>;
    try {
      result = await runtime.client.callTool({
        name: params.rawToolName,
        arguments: toRecord(params.args) ?? {},
      });
    } catch (error) {
      throw classifyMcpToolFailure({
        descriptor: runtime.descriptor,
        rawToolName: params.rawToolName,
        args: params.args,
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });
    }

    if (toRecord(result)?.isError === true) {
      const message = extractMcpErrorMessage(result, params.rawToolName);
      throw classifyMcpToolFailure({
        descriptor: runtime.descriptor,
        rawToolName: params.rawToolName,
        args: params.args,
        message,
        cause: new Error(message),
      });
    }

    const textBlocks = extractTextContent(result.content);
    return {
      structuredContent: extractStructuredContent(result),
      modelSummary: textBlocks.join('\n').trim() || undefined,
    };
  }

  async shutdown(): Promise<void> {
    const runtimes = Array.from(this.runtimes.values());
    this.runtimes.clear();
    this.initialized = false;
    await Promise.all(
      runtimes.map(async (runtime) => {
        try {
          await runtime.transport.close();
        } catch (error) {
          logger.warn({ error, serverId: runtime.descriptor.id }, 'Failed to close MCP transport cleanly');
        }
      }),
    );
  }
}

export const globalMcpManager = new McpManager();

export async function initializeMcpTools(registry: ToolRegistry = globalToolRegistry): Promise<void> {
  await globalMcpManager.initialize(registry);
}

export async function shutdownMcpTools(): Promise<void> {
  await globalMcpManager.shutdown();
}

export function listMcpDiscoverySnapshots(): McpDiscoverySnapshot[] {
  return globalMcpManager.listDiscoverySnapshots();
}

export async function probeMcpServerDiagnostics(): Promise<McpServerDiagnostic[]> {
  return globalMcpManager.probeDiagnostics();
}
