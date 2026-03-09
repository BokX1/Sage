import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  INGESTION_ENABLED: true,
  INGESTION_MODE: 'all' as 'all' | 'allowlist',
  INGESTION_ALLOWLIST_CHANNEL_IDS_CSV: '',
  INGESTION_BLOCKLIST_CHANNEL_IDS_CSV: '',
  PROACTIVE_POSTING_ENABLED: false,
}));

vi.mock('@/platform/config/env', () => ({
  config: mockConfig,
}));

import {
  clearAllOverrides,
  isLoggingEnabled,
  isProactiveEnabled,
  setLoggingEnabled,
  setProactiveEnabled,
} from '@/features/settings/guildChannelSettings';

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

    expect({
      blockedChannel: isLoggingEnabled('guild-1', 'channel-1'),
      unaffectedChannel: isLoggingEnabled('guild-1', 'channel-2'),
    }).toEqual({
      blockedChannel: false,
      unaffectedChannel: true,
    });
  });

  it('blocklist wins over explicit channel override', () => {
    setLoggingEnabled('guild-1', 'channel-1', true);
    mockConfig.INGESTION_BLOCKLIST_CHANNEL_IDS_CSV = 'channel-1';

    expect(isLoggingEnabled('guild-1', 'channel-1')).toEqual(false);
  });

  it('allowlist mode only allows listed channels', () => {
    mockConfig.INGESTION_MODE = 'allowlist';
    mockConfig.INGESTION_ALLOWLIST_CHANNEL_IDS_CSV = ' channel-2, channel-3,  ';

    expect({
      allowlisted: isLoggingEnabled('guild-1', 'channel-2'),
      notListed: isLoggingEnabled('guild-1', 'channel-9'),
    }).toEqual({
      allowlisted: true,
      notListed: false,
    });
  });

  it('ignores empty allowlist entries after CSV parsing', () => {
    mockConfig.INGESTION_MODE = 'allowlist';
    mockConfig.INGESTION_BLOCKLIST_CHANNEL_IDS_CSV = 'channel-z';
    mockConfig.INGESTION_ALLOWLIST_CHANNEL_IDS_CSV = ' , channel-1,   ,';

    expect({
      realChannel: isLoggingEnabled('guild-1', 'channel-1'),
      emptyChannel: isLoggingEnabled('guild-1', ''),
    }).toEqual({
      realChannel: true,
      emptyChannel: false,
    });
  });

  it('reuses parsed blocklist when config value is unchanged', () => {
    mockConfig.INGESTION_MODE = 'all';
    mockConfig.INGESTION_BLOCKLIST_CHANNEL_IDS_CSV = 'channel-1';
    const splitSpy = vi.spyOn(String.prototype, 'split');

    isLoggingEnabled('guild-1', 'channel-2');
    splitSpy.mockClear();
    isLoggingEnabled('guild-1', 'channel-3');

    expect(splitSpy).not.toHaveBeenCalled();
    splitSpy.mockRestore();
  });

  it('reuses parsed allowlist when config value is unchanged', () => {
    mockConfig.INGESTION_MODE = 'allowlist';
    mockConfig.INGESTION_BLOCKLIST_CHANNEL_IDS_CSV = 'channel-z';
    mockConfig.INGESTION_ALLOWLIST_CHANNEL_IDS_CSV = 'channel-1';
    const splitSpy = vi.spyOn(String.prototype, 'split');

    isLoggingEnabled('guild-1', 'channel-1');
    splitSpy.mockClear();
    isLoggingEnabled('guild-1', 'channel-1');

    expect(splitSpy).not.toHaveBeenCalled();
    splitSpy.mockRestore();
  });

  it('refreshes blocklist cache when config changes', () => {
    mockConfig.INGESTION_BLOCKLIST_CHANNEL_IDS_CSV = 'channel-1';
    expect(isLoggingEnabled('guild-1', 'channel-1')).toEqual(false);

    mockConfig.INGESTION_BLOCKLIST_CHANNEL_IDS_CSV = 'channel-2';
    expect({
      channelOne: isLoggingEnabled('guild-1', 'channel-1'),
      channelTwo: isLoggingEnabled('guild-1', 'channel-2'),
    }).toEqual({
      channelOne: true,
      channelTwo: false,
    });
  });

  it('refreshes allowlist cache when config changes', () => {
    mockConfig.INGESTION_MODE = 'allowlist';
    mockConfig.INGESTION_ALLOWLIST_CHANNEL_IDS_CSV = 'channel-1';
    expect(isLoggingEnabled('guild-1', 'channel-1')).toEqual(true);
    expect(isLoggingEnabled('guild-1', 'channel-2')).toEqual(false);

    mockConfig.INGESTION_ALLOWLIST_CHANNEL_IDS_CSV = 'channel-2';
    expect(isLoggingEnabled('guild-1', 'channel-1')).toEqual(false);
    expect(isLoggingEnabled('guild-1', 'channel-2')).toEqual(true);
  });

  it('disables logging globally when ingestion is off', () => {
    setLoggingEnabled('guild-1', 'channel-1', true);
    mockConfig.INGESTION_ENABLED = false;

    expect({
      channelOne: isLoggingEnabled('guild-1', 'channel-1'),
      channelTwo: isLoggingEnabled('guild-1', 'channel-2'),
    }).toEqual({
      channelOne: false,
      channelTwo: false,
    });
  });

  it('applies explicit true logging override when channel is otherwise allowed', () => {
    setLoggingEnabled('guild-1', 'channel-7', true);
    expect(isLoggingEnabled('guild-1', 'channel-7')).toEqual(true);
  });

  it('respects explicit logging override for allowed channels', () => {
    setLoggingEnabled('guild-1', 'channel-1', false);

    expect({
      overriddenChannel: isLoggingEnabled('guild-1', 'channel-1'),
      untouchedChannel: isLoggingEnabled('guild-1', 'channel-2'),
    }).toEqual({
      overriddenChannel: false,
      untouchedChannel: true,
    });
  });

  it('applies proactive overrides and clears them', () => {
    mockConfig.PROACTIVE_POSTING_ENABLED = false;
    setProactiveEnabled('guild-1', 'channel-1', true);

    expect(isProactiveEnabled('guild-1', 'channel-1')).toEqual(true);

    clearAllOverrides();
    expect(isProactiveEnabled('guild-1', 'channel-1')).toEqual(false);

    mockConfig.PROACTIVE_POSTING_ENABLED = true;
    expect(isProactiveEnabled('guild-1', 'channel-9')).toEqual(true);
  });
});
