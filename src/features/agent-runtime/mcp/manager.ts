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
import { sanitizeJsonSchemaForProvider } from '../../../shared/validation/json-schema';
import { buildStableMcpToolName } from './naming';
import { convertJsonSchemaToZod } from './jsonSchemaToZod';
import { loadMcpServerConfigs } from './config';
import type {
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

  async callTool(params: {
    serverId: string;
    rawToolName: string;
    args: unknown;
  }): Promise<McpToolExecutionResult> {
    const runtime = this.runtimes.get(params.serverId);
    if (!runtime || !runtime.snapshot.connected) {
      throw new Error(`MCP server "${params.serverId}" is unavailable.`);
    }
    const result = await runtime.client.callTool({
      name: params.rawToolName,
      arguments: toRecord(params.args) ?? {},
    });

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
