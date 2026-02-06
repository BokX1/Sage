export function smartSplit(text: string, maxLength = 2000): string[] {
  if (text.length <= maxLength) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      if (remaining.trim().length) parts.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf(' ', maxLength);
    if (splitIndex === -1 || splitIndex === 0) splitIndex = maxLength;

    let chunk = remaining.substring(0, splitIndex);
    let nextChunk = remaining.substring(splitIndex).trimStart();

    const codeBlockMatches = chunk.match(/```/g);
    const isCodeBlockOpen = codeBlockMatches && codeBlockMatches.length % 2 !== 0;

    if (isCodeBlockOpen) {
      const lastOpenBlock = chunk.lastIndexOf('```');
      const langMatch = chunk.substring(lastOpenBlock + 3).match(/^(\w+)/);
      const lang = langMatch ? langMatch[1] : '';

      chunk += '\n```';
      nextChunk = '```' + lang + '\n' + nextChunk;
    }

    if (chunk.trim().length) parts.push(chunk);
    remaining = nextChunk;
  }

  return parts;
}
