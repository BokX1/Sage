// ============================================
// Recursive Text Chunker for RAG Pipeline
// ============================================
// Splits text into semantically meaningful chunks using
// recursive character splitting (paragraph → sentence → word).
// Best practice: 256–512 tokens with 10-15% overlap.

const DEFAULT_CHUNK_SIZE = 512; // tokens (approx 4 chars/token)
const DEFAULT_CHUNK_OVERLAP = 50; // ~10% overlap in tokens
const CHARS_PER_TOKEN = 4; // rough estimate for English text

/**
 * Recursive separators ordered by priority.
 * We try to split at the highest semantic boundary first.
 */
const SEPARATORS = [
    '\n\n',   // paragraph break
    '\n',     // line break
    '. ',     // sentence boundary
    '? ',     // question boundary
    '! ',     // exclamation boundary
    '; ',     // semicolon
    ', ',     // comma
    ' ',      // word boundary
];

export interface TextChunk {
    content: string;
    index: number;
    tokenCount: number;
}

/**
 * Estimate token count from character length.
 * This is a rough heuristic; for exact counts use a tokenizer.
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Split text recursively using the separator hierarchy.
 * Falls back to increasingly granular separators when chunks are too large.
 */
function recursiveSplit(
    text: string,
    separators: string[],
    maxChars: number,
): string[] {
    if (text.length <= maxChars) {
        return [text];
    }

    // Try each separator in priority order
    for (let i = 0; i < separators.length; i++) {
        const sep = separators[i];
        const parts = text.split(sep);

        if (parts.length <= 1) continue;

        // Rejoin parts that are under the max size
        const result: string[] = [];
        let current = '';

        for (const part of parts) {
            const candidate = current ? current + sep + part : part;

            if (candidate.length <= maxChars) {
                current = candidate;
            } else {
                if (current) result.push(current);

                // If this single part is still too large, recurse with finer separators
                if (part.length > maxChars) {
                    const subChunks = recursiveSplit(part, separators.slice(i + 1), maxChars);
                    result.push(...subChunks);
                    current = '';
                } else {
                    current = part;
                }
            }
        }

        if (current) result.push(current);

        if (result.length > 0) return result;
    }

    // Final fallback: hard split by character count
    const result: string[] = [];
    for (let i = 0; i < text.length; i += maxChars) {
        result.push(text.slice(i, i + maxChars));
    }
    return result;
}

/**
 * Chunk text into overlapping segments for RAG ingestion.
 *
 * @param text - The full text to chunk
 * @param chunkSize - Target chunk size in tokens (default: 512)
 * @param overlap - Overlap in tokens (default: 50)
 * @returns Array of TextChunks with content, index, and token count
 */
export function chunkText(
    text: string,
    chunkSize: number = DEFAULT_CHUNK_SIZE,
    overlap: number = DEFAULT_CHUNK_OVERLAP,
): TextChunk[] {
    if (!text || text.trim().length === 0) {
        return [];
    }

    const maxChars = chunkSize * CHARS_PER_TOKEN;
    const overlapChars = overlap * CHARS_PER_TOKEN;

    // Step 1: Recursive split into raw segments
    const rawSegments = recursiveSplit(text.trim(), SEPARATORS, maxChars);

    // Step 2: Apply overlap by prepending tail of previous chunk
    const chunks: TextChunk[] = [];
    let previousTail = '';

    for (let i = 0; i < rawSegments.length; i++) {
        let content = rawSegments[i].trim();

        // Prepend overlap from previous segment
        if (i > 0 && previousTail) {
            content = previousTail + ' ' + content;
        }

        if (content.length === 0) continue;

        // Store tail for next chunk's overlap
        previousTail = content.length > overlapChars
            ? content.slice(-overlapChars).trim()
            : content;

        chunks.push({
            content,
            index: chunks.length,
            tokenCount: estimateTokens(content),
        });
    }

    return chunks;
}
