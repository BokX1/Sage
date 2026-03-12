function cleanDraftText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .split('\0')
    .join('')
    .replace(/\r\n/g, '\n')
    .trim();
  return normalized.length > 0 ? normalized : null;
}

const OPERATIONAL_REPLY_BLOCK_REGEXES = [
  /```(?:json|txt|text)?\s*[\s\S]*?(?:"approvalRequestId"|"approvalMessageId"|"expiresAtIso"|"action"\s*:|"request"\s*:|\[OK\] Tool|\[ERROR\] Tool|<untrusted_external_data)[\s\S]*?```/gi,
];

const OPERATIONAL_REPLY_LINE_REGEXES = [
  /^\s*\[(?:SYSTEM|OK|ERROR)\]\b/i,
  /^\s*<(?:untrusted_external_data|tool_results?)\b/i,
  /^\s*(?:Suggestion|Hint)\s*:/i,
  /^\s*(?:I|I'll|I will|Let me|First,? I'll|First,? I will|Next,? I'll|Next,? I will)\s+(?:call|use|invoke|run)\b/i,
  /^\s*(?:Calling|Using|Invoking|Running)\b.+\b(?:tool|discord_admin|discord_messages|discord_server|discord_context|discord_files|discord_voice|web|github|workflow|system_time|image_generate)\b/i,
  /\b(?:tool protocol|tool payload|approval payload|approval command|approvalRequestId|approvalMessageId|expiresAtIso)\b/i,
];

export function scrubFinalReplyText(params: {
  replyText: string | null | undefined;
}): string {
  let cleaned = cleanDraftText(params.replyText) ?? '';

  for (const pattern of OPERATIONAL_REPLY_BLOCK_REGEXES) {
    cleaned = cleaned.replace(pattern, '\n');
  }

  cleaned = cleaned
    .split('\n')
    .filter((line) => !OPERATIONAL_REPLY_LINE_REGEXES.some((pattern) => pattern.test(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  cleaned = cleaned
    .replace(/^\s*\{[\s\S]*"action"\s*:[\s\S]*\}\s*$/i, '')
    .trim();

  return cleaned;
}
