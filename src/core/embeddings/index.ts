export { embedText, embedTexts, cosineSimilarity, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from './embeddingEngine';
export { chunkText, type TextChunk } from './textChunker';
export { ingestAttachmentText, searchAttachments, deleteAttachmentChunks, type SearchResult } from './attachmentRAG';
export {
  getChannelMessageHistoryStats,
  getChannelMessageWindowById,
  queueChannelMessageEmbedding,
  searchChannelMessagesLexical,
  searchChannelMessagesRegex,
  searchChannelMessagesSemantic,
  supportsChannelMessageSemanticSearch,
  type ChannelMessageHistoryStats,
  type ChannelMessageSearchResult,
  type ChannelMessageSearchMode,
} from './channelMessageRAG';
