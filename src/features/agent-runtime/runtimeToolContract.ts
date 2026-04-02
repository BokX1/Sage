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

export interface RuntimeToolSpec<TArgs = unknown, TStructured = unknown> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  inputValidator?: z.ZodType<TArgs>;
  schema?: z.ZodType<TArgs>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  runtime: ToolRuntimeMetadata<TArgs>;
  prompt?: ToolPromptGuidance;
  smoke?: ToolSmokeSpec;
  validationHint?: string;
  execute: (args: TArgs, ctx: ToolExecutionContext) => Promise<ToolSuccessOutput<TStructured> | unknown>;
}

export type RegisteredRuntimeToolSpec<TArgs = unknown, TStructured = unknown> = RuntimeToolSpec<TArgs, TStructured> & {
  inputSchema: Record<string, unknown>;
  inputValidator: z.ZodType<TArgs>;
};

export type ToolDefinition<TArgs = unknown, TStructured = unknown> = RegisteredRuntimeToolSpec<TArgs, TStructured>;

export type ToolValidationResult<TArgs = unknown> =
  | { success: true; args: TArgs }
  | { success: false; error: string; errorDetails?: ToolErrorDetails };

export type ToolExecutionResult =
  | { success: true; result: ToolSuccessOutput<unknown> }
  | { success: false; error: string; errorType: 'validation' | 'execution'; errorDetails?: ToolErrorDetails };

export function defineRuntimeToolSpec<TArgs, TStructured = unknown>(params: {
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
}): RegisteredRuntimeToolSpec<TArgs, TStructured> {
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
    prompt: params.prompt,
    smoke: params.smoke,
    validationHint: params.validationHint,
    execute: params.execute,
  };
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

function buildObservationSummary<TArgs>(params: {
  normalized: ToolSuccessOutput<unknown>;
  definition: RegisteredRuntimeToolSpec<TArgs>;
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
  if (artifactSummary && policy !== 'streaming') {
    return truncateSummary(artifactSummary, maxChars);
  }

  const projected = projectStructuredContentForObservation(
    params.definition.outputSchema,
    params.normalized.structuredContent,
  );
  const serialized = safeJsonStringify(projected);
  if (!serialized) {
    return artifactSummary ? truncateSummary(artifactSummary, maxChars) : undefined;
  }

  return truncateSummary(serialized, maxChars);
}

export function normalizeToolSuccessResult<TArgs>(
  definition: RegisteredRuntimeToolSpec<TArgs>,
  rawResult: ToolSuccessOutput<unknown> | unknown,
): ToolSuccessOutput<unknown> {
  if (rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)) {
    const record = rawResult as Record<string, unknown>;
    const hasEnvelope =
      'structuredContent' in record || 'modelSummary' in record || 'artifacts' in record;
    if (hasEnvelope) {
      const normalized: ToolSuccessOutput<unknown> = {
        structuredContent: 'structuredContent' in record ? record.structuredContent : undefined,
        modelSummary: typeof record.modelSummary === 'string' ? record.modelSummary : undefined,
        artifacts: normalizeArtifacts(record.artifacts),
      };
      if (normalized.modelSummary === undefined) {
        normalized.modelSummary = buildObservationSummary({ normalized, definition });
      }
      return normalized;
    }
  }

  const normalized: ToolSuccessOutput<unknown> = {
    structuredContent: rawResult,
    modelSummary: undefined,
    artifacts: undefined,
  };
  normalized.modelSummary = buildObservationSummary({ normalized, definition });
  return normalized;
}

function buildValidationErrorDetails<TArgs>(
  spec: RegisteredRuntimeToolSpec<TArgs>,
  issues?: ToolErrorDetails,
): ToolErrorDetails {
  return buildToolErrorDetails({
    category: 'validation',
    hint: issues?.hint ?? spec.validationHint,
    retryable: false,
  });
}

function validateNormalizedToolSuccessResult<TArgs>(
  definition: RegisteredRuntimeToolSpec<TArgs>,
  normalized: ToolSuccessOutput<unknown>,
): { valid: true } | { valid: false; error: string; errorDetails?: ToolErrorDetails } {
  if (definition.outputSchema) {
    const validation = validateJsonSchema(definition.outputSchema, normalized.structuredContent);
    if (!validation.valid) {
      return {
        valid: false,
        error: `Tool "${definition.name}" returned output that does not match its output schema: ${validation.errors.join('; ')}`,
        errorDetails: buildValidationErrorDetails(definition),
      };
    }
  }

  return { valid: true };
}

export function validateRuntimeToolCall<TArgs = unknown>(
  definition: RegisteredRuntimeToolSpec<TArgs>,
  call: { name: string; args: unknown },
): ToolValidationResult<TArgs> {
  if (call.name !== definition.name) {
    return {
      success: false,
      error: `Unknown runtime surface capability "${call.name}". Allowed capability: ${definition.name}`,
    };
  }

  let argsJson: string | undefined;
  try {
    argsJson = JSON.stringify(call.args);
  } catch {
    return {
      success: false,
      error: `Arguments for "${call.name}" must be JSON-serializable`,
    };
  }

  if (typeof argsJson !== 'string') {
    return {
      success: false,
      error: `Arguments for "${call.name}" must be JSON-serializable`,
    };
  }

  if (argsJson.length > MAX_ARGS_SIZE) {
    return {
      success: false,
      error: `Arguments exceed maximum size (${argsJson.length} > ${MAX_ARGS_SIZE} bytes)`,
    };
  }

  const parseResult = definition.inputValidator.safeParse(call.args);
  if (!parseResult.success) {
    const formatted = formatZodIssues(parseResult.error.issues);
    const issues = formatted.truncated ? `${formatted.text}; (+more)` : formatted.text;
    return {
      success: false,
      error: `Invalid arguments for "${call.name}": ${issues}`,
      errorDetails: buildValidationErrorDetails(definition),
    };
  }

  return {
    success: true,
    args: parseResult.data,
  };
}

export async function executeValidatedRuntimeTool<TArgs = unknown>(
  definition: RegisteredRuntimeToolSpec<TArgs>,
  call: { name: string; args: unknown },
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const validation = validateRuntimeToolCall(definition, call);
  if (!validation.success) {
    const error = 'error' in validation ? validation.error : 'Validation failed';
    return {
      success: false,
      error,
      errorType: 'validation',
      errorDetails: validation.errorDetails,
    };
  }

  try {
    const rawResult = await definition.execute(validation.args, ctx);
    const normalizedResult = normalizeToolSuccessResult(definition, rawResult);
    const outputValidation = validateNormalizedToolSuccessResult(definition, normalizedResult);
    if (!outputValidation.valid) {
      return {
        success: false,
        error: outputValidation.error,
        errorType: 'execution',
        errorDetails: outputValidation.errorDetails,
      };
    }
    return { success: true, result: normalizedResult };
  } catch (error) {
    if (isToolControlSignal(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const errorDetails = extractToolErrorDetails(error) ?? undefined;
    return {
      success: false,
      error: `Execution failed: ${message}`,
      errorType: 'execution',
      errorDetails,
    };
  }
}
