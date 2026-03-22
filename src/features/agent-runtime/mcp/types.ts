export type McpServerTrustLevel = 'trusted' | 'untrusted';
export type McpTransportKind = 'stdio' | 'streamable_http';

export interface McpStdioTransportConfig {
  kind: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  stderr?: 'inherit' | 'pipe' | 'ignore';
}

export interface McpStreamableHttpTransportConfig {
  kind: 'streamable_http';
  url: string;
  headers?: Record<string, string>;
}

export type McpTransportConfig = McpStdioTransportConfig | McpStreamableHttpTransportConfig;

export interface McpAllowLists {
  tools?: string[];
  resources?: string[];
  prompts?: string[];
}

export interface McpRefreshPolicy {
  discoverOnInit?: boolean;
}

export interface McpServerConfig {
  id: string;
  enabled: boolean;
  trustLevel: McpServerTrustLevel;
  source?: 'preset' | 'custom';
  presetId?: string;
  transport: McpTransportConfig;
  allow?: McpAllowLists;
  refresh?: McpRefreshPolicy;
}

export interface McpServerDescriptor extends McpServerConfig {
  sanitizedId: string;
}

export interface McpPromptDescriptor {
  name: string;
  description?: string;
}

export interface McpResourceDescriptor {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceTemplateDescriptor {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  title?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpToolExposureResult {
  serverId: string;
  rawToolName: string;
  exposed: boolean;
  boundToolName: string | null;
  disableReason?: string;
}

export interface McpDiscoverySnapshot {
  server: McpServerDescriptor;
  connected: boolean;
  discoveredAtIso: string | null;
  tools: McpToolDescriptor[];
  resources: McpResourceDescriptor[];
  resourceTemplates: McpResourceTemplateDescriptor[];
  prompts: McpPromptDescriptor[];
  exposure: McpToolExposureResult[];
  errorText?: string;
}

export interface McpToolBinding {
  toolName: string;
  serverId: string;
  rawToolName: string;
}

export interface CapabilityHealth {
  capabilityName: string;
  serverId: string;
  rawToolName: string;
  available: boolean;
  disableReason?: string;
}

export interface McpToolExecutionResult {
  structuredContent?: unknown;
  modelSummary?: string;
}

export type McpServerDiagnosticStatus = 'healthy' | 'partial' | 'unavailable';
export type McpProbeStatus = 'pass' | 'fail' | 'skip';

export interface McpPresetDiagnostic {
  kind: 'preset_capability';
  presetId: string;
  serverId: string;
  status: McpServerDiagnosticStatus;
  probes: Record<string, McpProbeStatus>;
  summary: string;
  details: string[];
}

export type McpServerDiagnostic = McpPresetDiagnostic;
