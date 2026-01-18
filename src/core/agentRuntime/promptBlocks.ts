/**
 * PromptBlock - a composable unit for building system prompts.
 * Enables stable, deterministic prompt ordering.
 */
export interface PromptBlock {
  /** Section title (used for ordering and as section header) */
  title: string;
  /** Section content */
  content: string;
  /** Priority for ordering (higher = earlier). Default: 0 */
  priority?: number;
}

/**
 * Render prompt blocks into a single system prompt string.
 * Ordering: higher priority first, then alphabetical by title for stability.
 */
export function renderPromptBlocks(blocks: PromptBlock[]): string {
  if (blocks.length === 0) return '';

  // Sort by priority desc, then title asc for determinism
  const sorted = [...blocks].sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    if (priorityB !== priorityA) return priorityB - priorityA;
    return a.title.localeCompare(b.title);
  });

  // Render with section separators
  return sorted
    .map((block) => {
      // Single block with no title = just content
      if (sorted.length === 1 && !block.title.trim()) {
        return block.content.trim();
      }
      // Named section with separator
      if (block.title.trim()) {
        return `## ${block.title}\n${block.content.trim()}`;
      }
      return block.content.trim();
    })
    .filter(Boolean)
    .join('\n\n');
}
