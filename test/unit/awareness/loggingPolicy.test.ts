import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  LOGGING_ENABLED: true,
  LOGGING_MODE: 'all' as const,
  LOGGING_ALLOWLIST_CHANNEL_IDS: '',
  LOGGING_BLOCKLIST_CHANNEL_IDS: '',
}));

vi.mock('../../../src/config', () => ({
  config: mockConfig,
}));

import {
  clearAllOverrides,
  isLoggingEnabled,
} from '../../../src/core/settings/guildChannelSettings';

describe('logging policy', () => {
  beforeEach(() => {
    clearAllOverrides();
    mockConfig.LOGGING_ENABLED = true;
    mockConfig.LOGGING_MODE = 'all';
    mockConfig.LOGGING_ALLOWLIST_CHANNEL_IDS = '';
    mockConfig.LOGGING_BLOCKLIST_CHANNEL_IDS = '';
  });

  it('blocks channels on the blocklist', () => {
    mockConfig.LOGGING_BLOCKLIST_CHANNEL_IDS = 'channel-1';

    const allowed = isLoggingEnabled('guild-1', 'channel-1');

    expect(allowed).toBe(false);
  });

  it('allowlist mode only allows listed channels', () => {
    mockConfig.LOGGING_MODE = 'allowlist';
    mockConfig.LOGGING_ALLOWLIST_CHANNEL_IDS = 'channel-2,channel-3';

    expect(isLoggingEnabled('guild-1', 'channel-2')).toBe(true);
    expect(isLoggingEnabled('guild-1', 'channel-9')).toBe(false);
  });
});
