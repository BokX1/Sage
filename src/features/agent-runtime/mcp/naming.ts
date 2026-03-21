import crypto from 'node:crypto';

function sanitizeSegment(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  return sanitized.length > 0 ? sanitized : 'unknown';
}

function shortHash(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 8);
}

export function sanitizeMcpServerId(serverId: string): string {
  return sanitizeSegment(serverId);
}

export function buildStableMcpToolName(params: {
  serverId: string;
  rawToolName: string;
  existingNames?: Set<string>;
}): string {
  const server = sanitizeMcpServerId(params.serverId);
  const rawTool = sanitizeSegment(params.rawToolName);
  const base = `mcp__${server}__${rawTool}`;
  if (!params.existingNames?.has(base)) {
    return base;
  }
  return `${base}__${shortHash(`${params.serverId}::${params.rawToolName}`)}`;
}
