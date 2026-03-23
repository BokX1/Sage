import { describe, expect, it } from 'vitest';

import { discordTools } from '@/features/agent-runtime/discordDomainTools';

function byName<T extends { name: string }>(tools: readonly T[], name: string): T {
  const found = tools.find((tool) => tool.name === name);
  if (!found) {
    throw new Error(`Missing tool ${name}`);
  }
  return found;
}

describe('discord moderation policy schema', () => {
  it('requires notifyChannelId when the main policy action alerts moderators', () => {
    const tool = byName(discordTools, 'discord_moderation_upsert_policy');
    const parsed = tool.inputValidator?.safeParse({
      policyId: 'policy-1',
      name: 'Alert Mods',
      mode: 'enforce',
      spec: {
        family: 'content_filter',
        trigger: {
          kind: 'keyword_filter',
          keywords: ['spoiler'],
        },
        action: {
          type: 'alert_mods',
        },
      },
    });

    expect(parsed?.success).toBe(false);
    if (parsed?.success !== false) {
      throw new Error('Expected moderation policy schema validation to fail.');
    }
    expect(parsed.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['spec', 'notifyChannelId'],
        }),
      ]),
    );
  });

  it('requires notifyChannelId when an escalation opens a review case', () => {
    const tool = byName(discordTools, 'discord_moderation_upsert_policy');
    const parsed = tool.inputValidator?.safeParse({
      name: 'Escalated Review',
      mode: 'enforce',
      spec: {
        family: 'spam_filter',
        trigger: {
          kind: 'duplicate_messages',
          maxDuplicates: 3,
          windowSeconds: 60,
        },
        action: {
          type: 'log_only',
        },
        escalation: {
          threshold: 2,
          windowMinutes: 10,
          action: {
            type: 'open_review_case',
          },
        },
      },
    });

    expect(parsed?.success).toBe(false);
    if (parsed?.success !== false) {
      throw new Error('Expected moderation policy escalation validation to fail.');
    }
    expect(parsed.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['spec', 'notifyChannelId'],
        }),
      ]),
    );
  });

  it('accepts review-capable moderation policies when notifyChannelId is provided', () => {
    const tool = byName(discordTools, 'discord_moderation_upsert_policy');
    const parsed = tool.inputValidator?.safeParse({
      name: 'Escalated Review',
      mode: 'enforce',
      spec: {
        family: 'spam_filter',
        trigger: {
          kind: 'duplicate_messages',
          maxDuplicates: 3,
          windowSeconds: 60,
        },
        action: {
          type: 'log_only',
        },
        escalation: {
          threshold: 2,
          windowMinutes: 10,
          action: {
            type: 'open_review_case',
          },
        },
        notifyChannelId: 'channel-1',
      },
    });

    expect(parsed?.success).toBe(true);
    if (parsed?.success !== true) {
      throw new Error('Expected moderation policy schema validation to succeed.');
    }
    const data = parsed.data as {
      spec: {
        notifyChannelId?: string;
        escalation?: {
          action: {
            type: string;
          };
        } | null;
      };
    };
    expect(data.spec.notifyChannelId).toBe('channel-1');
    expect(data.spec.escalation?.action.type).toBe('open_review_case');
  });
});
