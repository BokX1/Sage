import { describe, expect, it } from 'vitest';

import type { ToolExecutionContext } from '@/features/agent-runtime/toolRegistry';
import { ToolRegistry } from '@/features/agent-runtime/toolRegistry';
import { registerDefaultAgenticTools } from '@/features/agent-runtime/defaultTools';

describe('discord artifact staging tool surface', () => {
  const removedAttachmentResendToolName = ['discord', 'files', 'send', 'attachment'].join('_');

  it('removes the legacy cached resend tool and keeps artifact staging on the registry', async () => {
    const registry = new ToolRegistry();
    await registerDefaultAgenticTools(registry);

    const ctx: ToolExecutionContext = {
      traceId: 'trace',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokedBy: 'mention',
      invokerIsAdmin: false,
    };

    const legacyResult = await registry.executeValidated(
      {
        name: removedAttachmentResendToolName,
        args: {},
      },
      ctx,
    );

    expect(legacyResult.success).toBe(false);
    if (legacyResult.success) return;
    expect(legacyResult.error).toContain('Unknown tool');

    const artifactResult = await registry.executeValidated(
      {
        name: 'discord_artifact_stage_attachment',
        args: {},
      },
      ctx,
    );

    expect(artifactResult.success).toBe(false);
    if (artifactResult.success) return;
    expect(artifactResult.errorType).toBe('validation');
    expect(artifactResult.error).toContain('Invalid arguments');
  });
});
