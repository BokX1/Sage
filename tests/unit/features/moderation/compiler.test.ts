import { describe, expect, it } from 'vitest';

import { compileModerationPolicy } from '../../../../src/features/moderation/compiler';
import type { ModerationPolicySpec } from '../../../../src/features/moderation/types';

describe('compileModerationPolicy', () => {
  it('uses hybrid execution for dry-run keyword filters so Sage can preview while staying AutoMod-compatible', () => {
    const spec: ModerationPolicySpec = {
      family: 'content_filter',
      trigger: {
        kind: 'keyword_filter',
        keywords: ['spoiler'],
      },
      action: {
        type: 'alert_mods',
      },
      notifyChannelId: 'channel-1',
    };

    const compiled = compileModerationPolicy({
      name: 'Spoiler Preview',
      spec,
      mode: 'dry_run',
    });

    expect(compiled.backend).toBe('hybrid');
    expect(compiled.nativeRule).toMatchObject({
      triggerKind: 'keyword',
      keywordFilter: ['spoiler'],
      alertChannelId: 'channel-1',
      blockMessage: false,
    });
    expect(compiled.runtimeRule).toMatchObject({
      kind: 'keyword_filter',
    });
  });

  it('stays runtime-only for member safety rules that Discord AutoMod cannot enforce directly', () => {
    const spec: ModerationPolicySpec = {
      family: 'member_safety',
      trigger: {
        kind: 'join_velocity',
        maxJoins: 5,
        windowSeconds: 60,
      },
      action: {
        type: 'open_review_case',
      },
    };

    const compiled = compileModerationPolicy({
      name: 'Raid Guard',
      spec,
      mode: 'enforce',
    });

    expect(compiled.backend).toBe('sage_runtime');
    expect(compiled.nativeRule).toBeNull();
    expect(compiled.runtimeRule).toMatchObject({
      kind: 'join_velocity',
      config: {
        maxJoins: 5,
        windowSeconds: 60,
      },
    });
  });

  it('keeps blocked-domain enforcement native-only in enforce mode so Sage does not double-enforce the same message', () => {
    const spec: ModerationPolicySpec = {
      family: 'content_filter',
      trigger: {
        kind: 'blocked_domains',
        domains: ['example.com'],
      },
      action: {
        type: 'delete_or_block_message',
      },
      notifyChannelId: 'channel-1',
    };

    const compiled = compileModerationPolicy({
      name: 'Block Example',
      spec,
      mode: 'enforce',
    });

    expect(compiled.backend).toBe('native_discord_automod');
    expect(compiled.nativeRule).toMatchObject({
      triggerKind: 'keyword',
      regexPatterns: ['(?:https?:\\/\\/)?(?:[\\w-]+\\.)*example\\.com\\b'],
      blockMessage: true,
    });
    expect(compiled.runtimeRule).toBeNull();
  });
});
