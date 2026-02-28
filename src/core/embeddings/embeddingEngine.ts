import { logger } from '../utils/logger';
import { config } from '../../shared/config/env';

// ============================================
// Local Embedding Engine — Nomic-Embed-Text v1.5
// ============================================
// Runs locally via @huggingface/transformers (ONNX runtime).
// No external API calls, no Python dependency.
// Matryoshka dims: 768, 512, 256, 128, 64

const MODEL_ID = config.EMBEDDING_MODEL;
const TARGET_DIMENSIONS = config.EMBEDDING_DIMENSIONS;

if (TARGET_DIMENSIONS !== 256) {
  throw new Error(
    `EMBEDDING_DIMENSIONS=${TARGET_DIMENSIONS} is not supported by AttachmentChunk.embedding vector(256). Set EMBEDDING_DIMENSIONS=256.`,
  );
}

type EmbeddingPipeline = (
    text: string | string[],
    options?: { pooling?: string; normalize?: boolean }
) => Promise<{ tolist: () => number[][] }>;

let pipelineInstance: EmbeddingPipeline | null = null;
let loadingPromise: Promise<EmbeddingPipeline> | null = null;

/**
 * Lazily loads the Nomic embedding pipeline.
 * Uses dynamic import because @huggingface/transformers is ESM-only.
 */
async function getEmbeddingPipeline(): Promise<EmbeddingPipeline> {
    if (pipelineInstance) return pipelineInstance;

    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        try {
            logger.info({ model: MODEL_ID }, 'Loading local embedding model...');
            const { pipeline } = await import('@huggingface/transformers');
            const pipe = await pipeline('feature-extraction', MODEL_ID, {
                dtype: 'fp32',
            });
            pipelineInstance = pipe as unknown as EmbeddingPipeline;
            logger.info({ model: MODEL_ID }, 'Embedding model loaded successfully');
            return pipelineInstance;
        } catch (error) {
            loadingPromise = null;
            logger.error({ error, model: MODEL_ID }, 'Failed to load embedding model');
            throw error;
        }
    })();

    return loadingPromise;
}

/**
 * Generate embeddings for one or more text strings.
 * Uses Nomic's required prefix convention:
 * - "search_document: " for documents to be stored
 * - "search_query: " for queries at retrieval time
 */
export async function embedTexts(
  texts: string[],
  type: 'document' | 'query' = 'document',
): Promise<number[][]> {
  const pipe = await getEmbeddingPipeline();
  const prefix = type === 'query' ? 'search_query: ' : 'search_document: ';
  const prefixedTexts = texts.map((t) => prefix + t);

  const results: number[][] = [];
  for (const text of prefixedTexts) {
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    const fullVector = output.tolist()[0];
    if (!Array.isArray(fullVector) || fullVector.length === 0) {
      throw new Error('Embedding model returned an empty vector');
    }
    if (fullVector.length < TARGET_DIMENSIONS) {
      throw new Error(
        `Embedding model returned ${fullVector.length} dimensions; expected at least ${TARGET_DIMENSIONS}.`,
      );
    }
    results.push(fullVector.slice(0, TARGET_DIMENSIONS));
  }

  return results;
}

/**
 * Generate a single embedding vector.
 */
export async function embedText(
  text: string,
  type: 'document' | 'query' = 'document',
): Promise<number[]> {
  const results = await embedTexts([text], type);
  return results[0];
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export const EMBEDDING_DIMENSIONS = TARGET_DIMENSIONS;
export const EMBEDDING_MODEL = MODEL_ID;
