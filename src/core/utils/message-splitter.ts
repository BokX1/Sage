function findSplitIndex(text: string, limit: number): number {
  if (text.length <= limit) return text.length;
  let splitIndex = text.lastIndexOf('\n', limit);
  if (splitIndex === -1) splitIndex = text.lastIndexOf(' ', limit);
  if (splitIndex <= 0) splitIndex = limit;
  return splitIndex;
}

function hardSplit(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.slice(i, i + maxLength));
  }
  return chunks;
}

export function smartSplit(text: string, maxLength = 2000): string[] {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError('maxLength must be a positive integer');
  }

  if (text.length <= maxLength) return [text];

  const parts: string[] = [];
  let remaining = text;
  let iterations = 0;
  const maxIterations = Math.max(32, Math.ceil(text.length / maxLength) * 8);

  while (remaining.length > 0) {
    iterations += 1;
    if (iterations > maxIterations) {
      // Safety fallback: never spin indefinitely on pathological fence/input combinations.
      parts.push(...hardSplit(remaining, maxLength));
      break;
    }

    if (remaining.length <= maxLength) {
      if (remaining.trim().length) parts.push(remaining);
      break;
    }

    const splitIndex = findSplitIndex(remaining, maxLength);
    let chunk = remaining.substring(0, splitIndex);
    let nextChunk = remaining.substring(splitIndex).trimStart();

    const codeBlockMatches = chunk.match(/```/g);
    const isCodeBlockOpen = Boolean(codeBlockMatches && codeBlockMatches.length % 2 !== 0);

    if (isCodeBlockOpen) {
      const closeFence = '\n```';
      if (chunk.length + closeFence.length > maxLength) {
        const keepChars = Math.max(1, maxLength - closeFence.length);
        const overflow = chunk.slice(keepChars);
        chunk = chunk.slice(0, keepChars);
        nextChunk = `${overflow}${nextChunk}`.trimStart();
      }

      const adjustedFenceCount = chunk.match(/```/g)?.length ?? 0;
      const stillOpen = adjustedFenceCount % 2 !== 0;
      if (stillOpen && chunk.length + closeFence.length <= maxLength) {
        const lastOpenBlock = chunk.lastIndexOf('```');
        const langMatch = chunk.substring(lastOpenBlock + 3).match(/^(\w+)/);
        const lang = langMatch ? langMatch[1] : '';
        chunk += closeFence;
        nextChunk = `\`\`\`${lang}\n${nextChunk}`;
      }
    }

    if (chunk.length > maxLength) {
      const overflow = chunk.slice(maxLength);
      chunk = chunk.slice(0, maxLength);
      nextChunk = `${overflow}${nextChunk}`.trimStart();
    }

    if (chunk.trim().length) parts.push(chunk);
    if (nextChunk.length >= remaining.length) {
      // Progress guard: force consume to avoid infinite loops.
      const forcedChunk = remaining.slice(0, maxLength);
      const forcedRemainder = remaining.slice(maxLength).trimStart();
      if (forcedChunk.trim().length) parts.push(forcedChunk);
      remaining = forcedRemainder;
    } else {
      remaining = nextChunk;
    }
  }

  return parts
    .flatMap((part) => hardSplit(part, maxLength))
    .filter((part) => part.trim().length > 0);
}
