/**
 * Register, validate, and expose runtime tool specifications.
 */
import { z } from 'zod';
import { buildToolErrorDetails, extractToolErrorDetails, type ToolErrorDetails } from './toolErrors';
import type { CurrentTurnContext, ReplyTargetContext } from './continuityContext';
import { isToolControlSignal, type ApprovalInterruptPayload } from './toolControlSignals';
import { sanitizeJsonSchemaForProvider, validateJsonSchema } from '../../shared/validation/json-schema';
import type { DiscordAuthorityTier } from '../../platform/discord/admin-permissions';

const MAX_ARGS_SIZE = 256 * 1024;

function formatZodIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) return '(root)';
  return path.map((part) => String(part)).join('.');
}

function formatZodIssues(issues: z.ZodIssue[], maxIssues = 10): { text: string; truncated: boolean } {
  const formatted: string[] = [];
  const seen = new Set<string>();
  let truncated = false;

  const push = (path: PropertyKey[], message: string): void => {
    if (formatted.length >= maxIssues) {
      truncated = true;
      return;
    }
    const normalized = message.trim();
    if (!normalized) return;
    const line = `${formatZodIssuePath(path)}: ${normalized}`;
    if (seen.has(line)) return;
    seen.add(line);
    formatted.push(line);
  };

  const visit = (issue: z.ZodIssue): void => {
    if (formatted.length >= maxIssues) {
      truncated = true;
      return;
    }

    const unionErrors = (issue as unknown as { unionErrors?: Array<{ issues?: z.ZodIssue[] }> }).unionErrors;
    if (Array.isArray(unionErrors) && unionErrors.length > 0) {
      for (const unionError of unionErrors) {
        const nestedIssues = Array.isArray(unionError?.issues) ? unionError.issues : [];
        for (const nestedIssue of nestedIssues) {
          visit(nestedIssue);
          if (formatted.length >= maxIssues) {
            truncated = true;
            return;
          }
        }
      }
      return;
    }

    push(issue.path, issue.message);
  };

  for (const issue of issues) {
    visit(issue);
    if (formatted.length >= maxIssues) {
      truncated = true;
      break;
    }
  }

  if (formatted.length === 0) {
    return { text: 'Invalid input.', truncated: false };
  }

  return { text: formatted.join('; '), truncated };
}

function toJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const exported = z.toJSONSchema(schema);
  const sanitize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry) => sanitize(entry));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === '$schema') continue;
      out[key] = sanitize(nested);
    }
    return out;
  };
  return sanitize(exported) as Record<string, unknown>;
}

function hasTopLevelUnionKeyword(schema: Record<string, unknown>): string | null {
  for (const key of ['oneOf', 'anyOf', 'allOf', 'not']) {
    if (key in schema) {
      return key;
    }
  }
  return null;
}

function assertProviderSafeInputSchema(toolName: string, schema: Record<string, unknown>): void {
  if (schema.type !== 'object') {
    throw new Error(`Tool "${toolName}" must expose inputSchema with top-level type="object".`);
  }
  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    throw new Error(`Tool "${toolName}" must expose top-level inputSchema.properties.`);
  }
  const forbidden = hasTopLevelUnionKeyword(schema);
  if (forbidden) {
    throw new Error(
      `Tool "${toolName}" uses unsupported top-level schema keyword "${forbidden}". Split it into granular tools instead.`,
    );
  }
  if ('required' in schema && !Array.isArray(schema.required)) {
    throw new Error(`Tool "${toolName}" must declare "required" as an array when provided.`);
  }
}

function buildValidationErrorDetails(spec: ToolSpecV2<unknown>, issues?: ToolErrorDetails): ToolErrorDetails {
  return buildToolErrorDetails({
    category: 'validation',
    hint: issues?.hint ?? spec.validationHint,
    retryable: false,
  });
}

function normalizeArtifacts(value: unknown): ToolArtifact[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const artifacts: ToolArtifact[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const kind = typeof record.kind === 'string' ? record.kind : null;
    if (kind !== 'file' && kind !== 'discord_artifact' && kind !== 'governance_only') {
      continue;
    }
    const artifact: ToolArtifact = { kind };
    if (typeof record.name === 'string') artifact.name = record.name.trim();
    if (typeof record.filename === 'string') artifact.filename = record.filename.trim();
    if (typeof record.mimetype === 'string') artifact.mimetype = record.mimetype.trim();
    if (Buffer.isBuffer(record.data)) artifact.data = record.data;
    if (typeof record.visibleSummary === 'string') artifact.visibleSummary = record.visibleSummary.trim();
    if ('payload' in record) artifact.payload = record.payload;
    artifacts.push(artifact);
  }
  return artifacts.length > 0 ? artifacts : undefined;
}

function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function truncateSummary(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1)}…`;
}

function observationPolicyMaxChars(policy: ToolObservationPolicy): number {
  switch (policy) {
    case 'tiny':
      return 1_200;
    case 'default':
      return 4_000;
    case 'streaming':
      return 8_000;
    case 'large':
      return 24_000;
    case 'artifact-only':
      return 600;
  }
}

function projectStructuredContentForObservation(schema: unknown, value: unknown, depth = 0): unknown {
  if (depth >= 5 || !schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return value;
  }

  if (Array.isArray(value)) {
    const itemSchema = 'items' in schema ? (schema as { items?: unknown }).items : undefined;
    return value.map((entry) => projectStructuredContentForObservation(itemSchema, entry, depth + 1));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const schemaRecord = schema as Record<string, unknown>;
  const properties =
    schemaRecord.properties && typeof schemaRecord.properties === 'object' && !Array.isArray(schemaRecord.properties)
      ? (schemaRecord.properties as Record<string, unknown>)
      : null;

  if (!properties) {
    return value;
  }

  const projected: Record<string, unknown> = {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in (value as Record<string, unknown>))) {
      continue;
    }
    projected[key] = projectStructuredContentForObservation(
      propertySchema,
      (value as Record<string, unknown>)[key],
      depth + 1,
    );
  }
  return Object.keys(projected).length > 0 ? projected : value;
}

function buildArtifactObservationSummary(artifacts: ToolArtifact[] | undefined): string | undefined {
  if (!artifacts?.length) {
    return undefined;
  }

  const lines = artifacts
    .map((artifact) => artifact.visibleSummary?.trim())
    .filter((line): line is string => Boolean(line));

  if (lines.length > 0) {
    return lines.join('\n');
  }

  if (artifacts.some((artifact) => artifact.kind === 'file')) {
    return 'Created a file artifact.';
  }
  if (artifacts.some((artifact) => artifact.kind === 'discord_artifact')) {
    return 'Created a Discord artifact.';
  }
  if (artifacts.some((artifact) => artifact.kind === 'governance_only')) {
    return 'Updated a governance artifact.';
  }
  return undefined;
}

function buildObservationSummary(params: {
  normalized: ToolSuccessOutput<unknown>;
  definition: RegisteredToolSpec<unknown>;
}): string | undefined {
  const policy = params.definition.runtime.observationPolicy ?? 'default';
  const maxChars = observationPolicyMaxChars(policy);

  if (policy === 'artifact-only') {
    const artifactSummary = buildArtifactObservationSummary(params.normalized.artifacts);
    return artifactSummary ? truncateSummary(artifactSummary, maxChars) : undefined;
  }

  const explicitSummary = params.normalized.modelSummary?.trim();
  if (explicitSummary) {
    return truncateSummary(explicitSummary, maxChars);
  }

  const artifactSummary = buildArtifactObservationSummary(params.normalized.artifacts);
  if (artifactSummary && params.normalized.structuredContent === undefined) {
    return truncateSummary(artifactSummary, maxChars);
  }

  const projected = params.definition.outputSchema
    ? projectStructuredContentForObservation(params.definition.outputSchema, params.normalized.structuredContent)
    : params.normalized.structuredContent;
  const serialized = safeJsonStringify(projected);
  if (serialized) {
    return truncateSummary(serialized, maxChars);
  }

  if (projected === undefined) {
    return artifactSummary ? truncateSummary(artifactSummary, maxChars) : undefined;
  }

  return truncateSummary(String(projected), maxChars);
}

/** Carry immutable context passed into every tool execution. */
export interface ToolExecutionContext {
  traceId: string;
  graphThreadId?: string;
  graphRunKind?: 'turn' | 'approval_resume';
  graphStep?: number;
  approvalRequestId?: string | null;
  approvalResume?: {
    requestId: string;
    decision: 'approved' | 'rejected' | 'expired';
    reviewerId?: string | null;
    decisionReasonText?: string | null;
    resumeTraceId?: string | null;
  } | null;
  userId: string;
  channelId: string;
  guildId?: string | null;
  apiKey?: string;
  invokerAuthority?: DiscordAuthorityTier;
  invokerIsAdmin?: boolean;
  invokerCanModerate?: boolean;
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';
  activeToolNames?: string[];
  routeKind?: string;
  currentTurn?: CurrentTurnContext;
  replyTarget?: ReplyTargetContext | null;
  signal?: AbortSignal;
}

export type ToolActionMutability = 'read' | 'write';
export type ToolClass = 'query' | 'mutation' | 'artifact' | 'runtime';
export type ToolAccessTier = 'public' | 'moderator' | 'admin' | 'owner';
export type ToolObservationPolicy = 'tiny' | 'default' | 'large' | 'streaming' | 'artifact-only';

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  parallelSafe?: boolean;
}

export interface ToolActionPolicy<TArgs = unknown> {
  mutability: ToolActionMutability;
  approvalMode?: 'none' | 'required';
  approvalGroupKey?: string;
  timeoutMs?: number;
  retryClass?: 'none' | 'default' | 'safe-idempotent';
  resultBudget?: 'default' | 'large';
  idempotencyKey?: string | ((args: TArgs, ctx: ToolExecutionContext) => string | null | undefined);
  prepareApproval?: (args: TArgs, ctx: ToolExecutionContext) => Promise<ApprovalInterruptPayload>;
}

export interface ToolPromptGuidance {
  summary?: string;
  whenToUse?: string[];
  whenNotToUse?: string[];
  argumentNotes?: string[];
}

export interface ToolSmokeSpec {
  mode: 'required' | 'optional' | 'skip';
  args?: Record<string, unknown>;
  reason?: string;
}

export interface ToolRuntimeMetadata<TArgs = unknown> {
  class: ToolClass;
  access?: ToolAccessTier;
  observationPolicy?: ToolObservationPolicy;
  readOnly?: boolean;
  readOnlyPredicate?: (args: TArgs, ctx: ToolExecutionContext) => boolean;
  actionPolicy?: (
    args: TArgs,
    ctx: ToolExecutionContext,
  ) => ToolActionPolicy<TArgs> | Promise<ToolActionPolicy<TArgs>>;
  capabilityTags?: string[];
}

export interface ToolMetadata<TArgs = unknown> {
  readOnly?: boolean;
  readOnlyPredicate?: (args: TArgs, ctx: ToolExecutionContext) => boolean;
  access?: ToolAccessTier;
  actionPolicy?: (
    args: TArgs,
    ctx: ToolExecutionContext,
  ) => ToolActionPolicy<TArgs> | Promise<ToolActionPolicy<TArgs>>;
}

export interface ToolArtifact {
  kind: 'file' | 'discord_artifact' | 'governance_only';
  name?: string;
  filename?: string;
  mimetype?: string;
  data?: Buffer;
  visibleSummary?: string;
  payload?: unknown;
}

export interface ToolSuccessOutput<TStructured = unknown> {
  structuredContent?: TStructured;
  modelSummary?: string;
  artifacts?: ToolArtifact[];
}

export interface ToolSpecV2<TArgs = unknown, TStructured = unknown> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  inputValidator?: z.ZodType<TArgs>;
  schema?: z.ZodType<TArgs>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  runtime?: ToolRuntimeMetadata<TArgs>;
  metadata?: ToolMetadata<TArgs>;
  prompt?: ToolPromptGuidance;
  smoke?: ToolSmokeSpec;
  validationHint?: string;
  execute: (args: TArgs, ctx: ToolExecutionContext) => Promise<ToolSuccessOutput<TStructured> | unknown>;
}

export type RegisteredToolSpec<TArgs = unknown, TStructured = unknown> = ToolSpecV2<TArgs, TStructured> & {
  inputSchema: Record<string, unknown>;
  inputValidator: z.ZodType<TArgs>;
  runtime: ToolRuntimeMetadata<TArgs>;
  metadata: ToolMetadata<TArgs>;
};

export interface ResolvedToolActionPolicy<TArgs = unknown> {
  tool: RegisteredToolSpec<TArgs>;
  args: TArgs;
  policy: ToolActionPolicy<TArgs>;
}

export type ToolDefinition<TArgs = unknown, TStructured = unknown> = RegisteredToolSpec<TArgs, TStructured>;

export type ToolValidationResult<TArgs = unknown> =
  | { success: true; args: TArgs }
  | { success: false; error: string; errorDetails?: ToolErrorDetails };

export type ToolExecutionResult =
  | { success: true; result: unknown }
  | {
      success: false;
      error: string;
      errorType: 'validation' | 'execution';
      errorDetails?: ToolErrorDetails;
    };

export function normalizeToolSuccessResult(
  definition: RegisteredToolSpec<unknown>,
  result: unknown,
): ToolSuccessOutput<unknown> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    const normalized = {
      structuredContent: result,
      modelSummary: safeJsonStringify(result) ?? String(result),
    };
    return {
      ...normalized,
      modelSummary: buildObservationSummary({ normalized, definition }),
    };
  }

  const record = result as Record<string, unknown>;
  const explicitStructured = 'structuredContent' in record;
  const explicitSummary = typeof record.modelSummary === 'string' ? record.modelSummary.trim() : '';
  const explicitArtifacts = normalizeArtifacts(record.artifacts);

  if (explicitStructured || explicitSummary || explicitArtifacts) {
    const normalized = {
      structuredContent: explicitStructured ? record.structuredContent : undefined,
      modelSummary: explicitSummary || undefined,
      artifacts: explicitArtifacts,
    };
    return {
      ...normalized,
      modelSummary: buildObservationSummary({ normalized, definition }),
    };
  }

  const normalized = {
    structuredContent: { ...record },
    modelSummary: safeJsonStringify(record) ?? '[unserializable tool result]',
  };
  return {
    ...normalized,
    modelSummary: buildObservationSummary({ normalized, definition }),
  };
}

function validateNormalizedToolSuccessResult(
  definition: RegisteredToolSpec<unknown>,
  normalized: ToolSuccessOutput<unknown>,
): { valid: true } | { valid: false; error: string; errorDetails: ToolErrorDetails } {
  if (!definition.outputSchema) {
    return { valid: true };
  }

  const validation = validateJsonSchema(definition.outputSchema, normalized.structuredContent);
  if (validation.valid) {
    return { valid: true };
  }

  const summary = validation.errors.slice(0, 3).join('; ');
  return {
    valid: false,
    error: `Tool "${definition.name}" returned data that did not match its output schema: ${summary}`,
    errorDetails: buildToolErrorDetails({
      category: 'validation',
      hint: 'The tool returned an unexpected result shape. Check the tool implementation and output schema.',
      retryable: false,
    }),
  };
}

export function defineToolSpecV2<TArgs, TStructured = unknown>(params: {
  name: string;
  title?: string;
  description: string;
  input: z.ZodType<TArgs>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  runtime: ToolRuntimeMetadata<TArgs>;
  prompt?: ToolPromptGuidance;
  smoke?: ToolSmokeSpec;
  validationHint?: string;
  execute: (args: TArgs, ctx: ToolExecutionContext) => Promise<ToolSuccessOutput<TStructured> | unknown>;
}): ToolSpecV2<TArgs, TStructured> {
  const inputSchema = toJsonSchema(params.input);
  assertProviderSafeInputSchema(params.name, inputSchema);
  const outputSchema =
    params.outputSchema !== undefined
      ? sanitizeJsonSchemaForProvider(params.outputSchema)
      : undefined;

  return {
    name: params.name,
    title: params.title,
    description: params.description,
    inputSchema,
    inputValidator: params.input,
    schema: params.input,
    outputSchema,
    annotations: params.annotations,
    runtime: {
      access: 'public',
      observationPolicy: 'default',
      ...params.runtime,
    },
    metadata: {
      readOnly: params.runtime.readOnly,
      readOnlyPredicate: params.runtime.readOnlyPredicate,
      access: params.runtime.access ?? 'public',
      actionPolicy: params.runtime.actionPolicy,
    },
    prompt: params.prompt,
    smoke: params.smoke,
    validationHint: params.validationHint,
    execute: params.execute,
  };
}

export class ToolRegistry {
  private tools: Map<string, RegisteredToolSpec<unknown>> = new Map();

  register<TArgs>(tool: ToolSpecV2<TArgs>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    const inputValidator = tool.inputValidator ?? tool.schema;
    if (!inputValidator) {
      throw new Error(`Tool "${tool.name}" must provide an input validator.`);
    }
    const normalized: RegisteredToolSpec<TArgs> = {
      ...tool,
      inputValidator,
      inputSchema: tool.inputSchema ?? toJsonSchema(inputValidator),
      runtime: {
        class: tool.runtime?.class ?? (tool.metadata?.readOnly === true ? 'query' : 'mutation'),
        access: tool.runtime?.access ?? tool.metadata?.access ?? 'public',
        observationPolicy: tool.runtime?.observationPolicy ?? 'default',
        readOnly: tool.runtime?.readOnly ?? tool.metadata?.readOnly,
        readOnlyPredicate: tool.runtime?.readOnlyPredicate ?? tool.metadata?.readOnlyPredicate,
        actionPolicy: tool.runtime?.actionPolicy ?? tool.metadata?.actionPolicy,
        capabilityTags: tool.runtime?.capabilityTags ?? [],
      },
      metadata: {
        readOnly: tool.metadata?.readOnly ?? tool.runtime?.readOnly,
        readOnlyPredicate: tool.metadata?.readOnlyPredicate ?? tool.runtime?.readOnlyPredicate,
        access: tool.metadata?.access ?? tool.runtime?.access ?? 'public',
        actionPolicy: tool.metadata?.actionPolicy ?? tool.runtime?.actionPolicy,
      },
    };
    assertProviderSafeInputSchema(tool.name, normalized.inputSchema as Record<string, unknown>);
    this.tools.set(tool.name, normalized as RegisteredToolSpec<unknown>);
  }

  get(name: string): RegisteredToolSpec<unknown> | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  listSpecs(): RegisteredToolSpec<unknown>[] {
    return Array.from(this.tools.values());
  }

  validateToolCall<TArgs = unknown>(call: { name: string; args: unknown }): ToolValidationResult<TArgs> {
    const { name, args } = call;
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: "${name}". Allowed tools: ${this.listNames().join(', ') || 'none'}`,
      };
    }

    let argsJson: string | undefined;
    try {
      argsJson = JSON.stringify(args);
    } catch {
      return {
        success: false,
        error: `Tool arguments for "${name}" must be JSON-serializable`,
      };
    }

    if (typeof argsJson !== 'string') {
      return {
        success: false,
        error: `Tool arguments for "${name}" must be JSON-serializable`,
      };
    }

    if (argsJson.length > MAX_ARGS_SIZE) {
      return {
        success: false,
        error: `Tool arguments exceed maximum size (${argsJson.length} > ${MAX_ARGS_SIZE} bytes)`,
      };
    }

    const parseResult = (tool.inputValidator ?? tool.schema)?.safeParse(args);
    if (!parseResult) {
      return {
        success: false,
        error: `Tool "${name}" is missing a runtime validator.`,
      };
    }
    if (!parseResult.success) {
      const formatted = formatZodIssues(parseResult.error.issues);
      const issues = formatted.truncated ? `${formatted.text}; (+more)` : formatted.text;
      return {
        success: false,
        error: `Invalid arguments for tool "${name}": ${issues}`,
        errorDetails: buildValidationErrorDetails(tool),
      };
    }

    return {
      success: true,
      args: parseResult.data as TArgs,
    };
  }

  async resolveActionPolicy<TArgs = unknown>(
    call: { name: string; args: unknown },
    ctx: ToolExecutionContext,
  ): Promise<ResolvedToolActionPolicy<TArgs> | null> {
    const validation = this.validateToolCall<TArgs>(call);
    if (!validation.success) {
      return null;
    }

    const tool = this.tools.get(call.name) as RegisteredToolSpec<TArgs> | undefined;
    if (!tool) {
      return null;
    }

    const readOnlyPredicate = tool.runtime.readOnlyPredicate;
    let mutability: ToolActionMutability = tool.runtime.readOnly === true ? 'read' : 'write';
    if (typeof readOnlyPredicate === 'function') {
      try {
        mutability = readOnlyPredicate(validation.args, ctx) ? 'read' : 'write';
      } catch {
        mutability = 'write';
      }
    }

    const resolved = tool.runtime.actionPolicy
      ? ((await tool.runtime.actionPolicy(validation.args, ctx)) as ToolActionPolicy<TArgs>)
      : null;

    return {
      tool,
      args: validation.args,
      policy:
        resolved ?? {
          mutability,
          approvalMode: 'none',
        },
    };
  }

  async executeValidated<TArgs = unknown>(
    call: { name: string; args: unknown },
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const validation = this.validateToolCall<TArgs>(call);
    if (!validation.success) {
      const error = 'error' in validation ? validation.error : 'Validation failed';
      return {
        success: false,
        error,
        errorType: 'validation',
        errorDetails: validation.errorDetails,
      };
    }

    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: "${call.name}"`,
        errorType: 'validation',
      };
    }

    try {
      const rawResult = await tool.execute(validation.args, ctx);
      const normalizedResult = normalizeToolSuccessResult(tool, rawResult);
      const outputValidation = validateNormalizedToolSuccessResult(tool, normalizedResult);
      if (!outputValidation.valid) {
        return {
          success: false,
          error: outputValidation.error,
          errorType: 'execution',
          errorDetails: outputValidation.errorDetails,
        };
      }
      return { success: true, result: normalizedResult };
    } catch (err) {
      if (isToolControlSignal(err)) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      const errorDetails = extractToolErrorDetails(err) ?? undefined;
      return {
        success: false,
        error: `Tool execution failed: ${message}`,
        errorType: 'execution',
        errorDetails,
      };
    }
  }
}

export const globalToolRegistry = new ToolRegistry();
