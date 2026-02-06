import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  INGESTION_ENABLED: true,
  INGESTION_MODE: 'all' as const,
  INGESTION_ALLOWLIST_CHANNEL_IDS_CSV: '',
  INGESTION_BLOCKLIST_CHANNEL_IDS_CSV: '',
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
    mockConfig.INGESTION_ENABLED = true;
    mockConfig.INGESTION_MODE = 'all';
    mockConfig.INGESTION_ALLOWLIST_CHANNEL_IDS_CSV = '';
    mockConfig.INGESTION_BLOCKLIST_CHANNEL_IDS_CSV = '';
  });

  it('blocks channels on the blocklist', () => {
    mockConfig.INGESTION_BLOCKLIST_CHANNEL_IDS_CSV = 'channel-1';

    const allowed = isLoggingEnabled('guild-1', 'channel-1');

    expect(allowed).toBe(false);
  });

  it('allowlist mode only allows listed channels', () => {
    mockConfig.INGESTION_MODE = 'allowlist';
    mockConfig.INGESTION_ALLOWLIST_CHANNEL_IDS_CSV = 'channel-2,channel-3';

    expect(isLoggingEnabled('guild-1', 'channel-2')).toBe(true);
    expect(isLoggingEnabled('guild-1', 'channel-9')).toBe(false);
  });
});
