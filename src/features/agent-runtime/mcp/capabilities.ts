import { z } from 'zod';

import { sanitizeJsonSchemaForProvider } from '../../../shared/validation/json-schema';
import {
  defineToolSpecV2,
  globalToolRegistry,
  type ToolRegistry,
  type ToolSpecV2,
} from '../toolRegistry';
import type { ToolAnnotations } from '../toolRegistry';
import {
  callMcpTool,
  getMcpToolDescriptor,
  listMcpDiscoverySnapshots,
} from './manager';
import type { McpServerDescriptor, McpToolDescriptor } from './types';
import { convertJsonSchemaToZod } from './jsonSchemaToZod';

type AliasCapability = {
  capabilityName: string;
  serverId: string;
  rawToolName: string;
  title: string;
  description: string;
  promptSummary: string;
  whenToUse?: string[];
  whenNotToUse?: string[];
  capabilityTags: string[];
};

const ALIAS_CAPABILITIES: AliasCapability[] = [
  {
    capabilityName: 'repo_search_code',
    serverId: 'github',
    rawToolName: 'search_code',
    title: 'Repo Search Code',
    description: 'Search repository code when the exact path or symbol location is not known yet.',
    promptSummary: 'Use to locate code inside a repository when the exact path is still unknown.',
    whenToUse: ['The repository is known but the exact file or symbol location is not.'],
    whenNotToUse: ['The exact repository path is already known; use repo_read_file instead.'],
    capabilityTags: ['repo', 'code', 'search'],
  },
  {
    capabilityName: 'repo_read_file',
    serverId: 'github',
    rawToolName: 'get_file_contents',
    title: 'Repo Read File',
    description: 'Read one exact file from a repository when the path is already known.',
    promptSummary: 'Use to fetch one exact repository file when the path is known.',
    whenToUse: ['The exact owner, repo, and file path are already known.'],
    whenNotToUse: ['You still need to discover which file to read; use repo_search_code first.'],
    capabilityTags: ['repo', 'code', 'file'],
  },
  {
    capabilityName: 'repo_get_repository',
    serverId: 'github',
    rawToolName: 'get_repo',
    title: 'Repo Get Repository',
    description: 'Fetch repository metadata and high-level repository details.',
    promptSummary: 'Use when you need repository metadata or a repository overview.',
    capabilityTags: ['repo', 'metadata'],
  },
  {
    capabilityName: 'repo_search_issues',
    serverId: 'github',
    rawToolName: 'search_issues',
    title: 'Repo Search Issues',
    description: 'Search repository issues across the visible GitHub surface.',
    promptSummary: 'Use to find issue history, prior bug reports, or issue discussions.',
    capabilityTags: ['repo', 'issues'],
  },
  {
    capabilityName: 'repo_search_pull_requests',
    serverId: 'github',
    rawToolName: 'search_pull_requests',
    title: 'Repo Search Pull Requests',
    description: 'Search pull requests across the visible GitHub surface.',
    promptSummary: 'Use to find PR history, design changes, or prior implementation work.',
    capabilityTags: ['repo', 'pull_requests'],
  },
  {
    capabilityName: 'browser_open_page',
    serverId: 'playwright',
    rawToolName: 'browser_navigate',
    title: 'Browser Open Page',
    description: 'Open or navigate the browser to a page.',
    promptSummary: 'Use to start or change browser location.',
    capabilityTags: ['browser', 'navigation'],
  },
  {
    capabilityName: 'browser_read_page',
    serverId: 'playwright',
    rawToolName: 'browser_snapshot',
    title: 'Browser Read Page',
    description: 'Read the current browser page accessibility snapshot.',
    promptSummary: 'Use to inspect the current page structure before acting.',
    capabilityTags: ['browser', 'read'],
  },
  {
    capabilityName: 'browser_click',
    serverId: 'playwright',
    rawToolName: 'browser_click',
    title: 'Browser Click',
    description: 'Click an element in the browser.',
    promptSummary: 'Use when the next browser action is clicking a known element.',
    capabilityTags: ['browser', 'interaction'],
  },
  {
    capabilityName: 'browser_type',
    serverId: 'playwright',
    rawToolName: 'browser_type',
    title: 'Browser Type',
    description: 'Type into an editable element in the browser.',
    promptSummary: 'Use to fill or type text into browser fields.',
    capabilityTags: ['browser', 'interaction', 'input'],
  },
  {
    capabilityName: 'browser_capture',
    serverId: 'playwright',
    rawToolName: 'browser_take_screenshot',
    title: 'Browser Capture',
    description: 'Capture a screenshot of the current browser page or element.',
    promptSummary: 'Use when a screenshot or visual artifact is needed from the browser.',
    capabilityTags: ['browser', 'capture'],
  },
  {
    capabilityName: 'browser_extract',
    serverId: 'playwright',
    rawToolName: 'browser_evaluate',
    title: 'Browser Extract',
    description: 'Extract page data through a bounded page evaluation.',
    promptSummary: 'Use for precise extraction from the already-open page when the snapshot alone is not enough.',
    capabilityTags: ['browser', 'extract'],
  },
];

function resolveReadOnlyHint(server: McpServerDescriptor, tool: McpToolDescriptor): boolean {
  if (server.trustLevel !== 'trusted') {
    return false;
  }
  const annotations = tool.annotations ?? {};
  return annotations.readOnlyHint === true || annotations.readOnly === true;
}

function buildCapabilityAnnotations(server: McpServerDescriptor, tool: McpToolDescriptor): ToolAnnotations {
  const readOnly = resolveReadOnlyHint(server, tool);
  return {
    readOnlyHint: readOnly,
    parallelSafe: readOnly,
  };
}

function buildAliasToolSpec(params: {
  server: McpServerDescriptor;
  tool: McpToolDescriptor;
  capability: AliasCapability;
}): ToolSpecV2<unknown, unknown> {
  const inputSchema = sanitizeJsonSchemaForProvider(params.tool.inputSchema);
  const inputValidator = convertJsonSchemaToZod(inputSchema);
  const readOnly = resolveReadOnlyHint(params.server, params.tool);

  return defineToolSpecV2({
    name: params.capability.capabilityName,
    title: params.capability.title,
    description: params.capability.description,
    input: inputValidator as z.ZodType<unknown>,
    outputSchema: params.tool.outputSchema ? sanitizeJsonSchemaForProvider(params.tool.outputSchema) : undefined,
    annotations: buildCapabilityAnnotations(params.server, params.tool),
    runtime: {
      class: readOnly ? 'query' : 'mutation',
      readOnly,
      observationPolicy: 'default',
      capabilityTags: params.capability.capabilityTags,
      actionPolicy: () => ({
        mutability: readOnly ? 'read' : 'write',
        approvalMode: readOnly ? 'none' : 'required',
        approvalGroupKey: `capability:${params.capability.capabilityName}`,
      }),
    },
    prompt: {
      summary: params.capability.promptSummary,
      whenToUse: params.capability.whenToUse,
      whenNotToUse: params.capability.whenNotToUse,
    },
    smoke: {
      mode: 'skip',
      reason: `Capability "${params.capability.capabilityName}" depends on MCP preset "${params.server.id}".`,
    },
    validationHint: `Arguments must match the advertised schema for ${params.capability.capabilityName}.`,
    execute: async (args) =>
      callMcpTool({
        serverId: params.server.id,
        rawToolName: params.tool.name,
        args,
      }),
  });
}

function findSnapshot(serverId: string) {
  return listMcpDiscoverySnapshots().find((snapshot) => snapshot.server.id === serverId && snapshot.connected);
}

function findTool(serverId: string, rawToolName: string): { server: McpServerDescriptor; tool: McpToolDescriptor } | null {
  const snapshot = findSnapshot(serverId);
  if (!snapshot) return null;
  const tool = snapshot.tools.find((entry) => entry.name === rawToolName);
  if (!tool) return null;
  const exposure = snapshot.exposure.find((entry) => entry.rawToolName === rawToolName);
  if (exposure?.exposed === false) {
    return null;
  }
  return {
    server: snapshot.server,
    tool,
  };
}

function pickToolName(serverId: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (getMcpToolDescriptor(serverId, candidate)) {
      return candidate;
    }
  }
  return null;
}

function pickStringPropertyName(schema: Record<string, unknown>, preferred: string[]): string | null {
  const properties =
    schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : {};
  for (const name of preferred) {
    if (name in properties) {
      return name;
    }
  }
  for (const [name, value] of Object.entries(properties)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const type = (value as Record<string, unknown>).type;
      if (type === 'string') {
        return name;
      }
    }
  }
  return null;
}

function extractLibraryId(value: unknown): string | null {
  const tryFromRecord = (record: Record<string, unknown>): string | null => {
    for (const key of ['libraryId', 'context7CompatibleLibraryID', 'id']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim().startsWith('/')) {
        return candidate.trim();
      }
    }
    return null;
  };

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const direct = tryFromRecord(value as Record<string, unknown>);
    if (direct) return direct;
    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (Array.isArray(nested)) {
        for (const entry of nested) {
          if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            const found = tryFromRecord(entry as Record<string, unknown>);
            if (found) return found;
          }
        }
      }
    }
  }

  const serialized = (() => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value ?? '');
    }
  })();
  const match = serialized.match(/\/[a-z0-9._-]+\/[a-z0-9._-]+(?:\/[a-z0-9._-]+)?/i);
  return match?.[0] ?? null;
}

function extractDocsContent(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ['content', 'text', 'answer', 'docs']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  }
  return null;
}

function buildDocsLookupTool(): ToolSpecV2<
  { technology: string; question: string; version?: string },
  unknown
> | null {
  const resolveToolName = pickToolName('context7', ['resolve-library-id', 'resolve_library_id']);
  const docsToolName = pickToolName('context7', ['get-library-docs', 'get_library_docs', 'query-docs', 'query_docs']);
  if (!resolveToolName || !docsToolName) {
    return null;
  }

  const resolveTool = getMcpToolDescriptor('context7', resolveToolName);
  const docsTool = getMcpToolDescriptor('context7', docsToolName);
  if (!resolveTool || !docsTool) {
    return null;
  }

  const resolveQueryArg = pickStringPropertyName(resolveTool.inputSchema, ['libraryName', 'library', 'query']);
  const docsIdArg = pickStringPropertyName(docsTool.inputSchema, ['context7CompatibleLibraryID', 'libraryId', 'libraryID']);
  const docsQueryArg = pickStringPropertyName(docsTool.inputSchema, ['topic', 'query', 'question']);
  if (!resolveQueryArg || !docsIdArg || !docsQueryArg) {
    return null;
  }

  return defineToolSpecV2({
    name: 'docs_lookup',
    title: 'Docs Lookup',
    description: 'Resolve a technology and fetch its current technical documentation and code examples.',
    input: z.object({
      technology: z.string().trim().min(1).max(200),
      question: z.string().trim().min(3).max(800),
      version: z.string().trim().min(1).max(120).optional(),
    }),
    annotations: {
      readOnlyHint: true,
    },
    runtime: {
      class: 'query',
      readOnly: true,
      observationPolicy: 'default',
      capabilityTags: ['docs', 'developer', 'context7'],
    },
    prompt: {
      summary: 'Use for authoritative current technical docs and code examples.',
      whenToUse: ['The task depends on current library, framework, SDK, API, or CLI documentation.'],
      whenNotToUse: ['The question is about a repository file you already have or a generic open-web fact.'],
    },
    smoke: {
      mode: 'skip',
      reason: 'docs_lookup depends on the Context7 MCP preset.',
    },
    validationHint: 'Pass the technology name and the exact docs question you need answered.',
    execute: async (args) => {
      const input = args as { technology: string; question: string; version?: string };
      const libraryQuery = input.version?.trim()
        ? `${input.technology.trim()} ${input.version.trim()}`
        : input.technology.trim();
      const resolveResult = await callMcpTool({
        serverId: 'context7',
        rawToolName: resolveToolName,
        args: {
          [resolveQueryArg]: libraryQuery,
        },
      });
      const libraryId =
        extractLibraryId(resolveResult.structuredContent)
        ?? extractLibraryId(resolveResult.modelSummary)
        ?? null;
      if (!libraryId) {
        throw new Error('Context7 did not return a usable library id.');
      }

      const docsResult = await callMcpTool({
        serverId: 'context7',
        rawToolName: docsToolName,
        args: {
          [docsIdArg]: libraryId,
          [docsQueryArg]: input.question.trim(),
        },
      });

      return {
        structuredContent: {
          technology: input.technology.trim(),
          version: input.version?.trim() || null,
          libraryId,
          answer: extractDocsContent(docsResult.structuredContent) ?? docsResult.modelSummary ?? null,
          raw: docsResult.structuredContent,
        },
        modelSummary: docsResult.modelSummary,
      };
    },
  });
}

function registerToolIfMissing<TInput, TOutput>(
  registry: ToolRegistry,
  tool: ToolSpecV2<TInput, TOutput>,
): void {
  if (!registry.has(tool.name)) {
    registry.register(tool);
  }
}

export async function registerMcpCapabilityTools(
  registry: ToolRegistry = globalToolRegistry,
): Promise<void> {
  for (const capability of ALIAS_CAPABILITIES) {
    const resolved = findTool(capability.serverId, capability.rawToolName);
    if (!resolved) continue;
    registerToolIfMissing(
      registry,
      buildAliasToolSpec({
        server: resolved.server,
        tool: resolved.tool,
        capability,
      }),
    );
  }

  const docsLookupTool = buildDocsLookupTool();
  if (docsLookupTool) {
    registerToolIfMissing(registry, docsLookupTool);
  }
}
