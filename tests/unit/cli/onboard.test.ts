import { describe, expect, it } from 'vitest';

import {
  applyProviderSetupModeDefaults,
  applySharedAgentModelDefaults,
  buildOnboardingSummary,
  inferProviderSetupMode,
  shouldSeedSharedAgentModels,
} from '@/cli/onboard';

describe('onboard helpers', () => {
  it('infers provider setup mode from available API key inputs', () => {
    expect(
      inferProviderSetupMode({
        argsApiKey: 'sk-host',
      }),
    ).toBe('host_key_now');

    expect(
      inferProviderSetupMode({
        existingApiKey: 'sk-existing',
      }),
    ).toBe('both');

    expect(inferProviderSetupMode({})).toBe('server_key_later');
  });

  it('defaults profile and summary models to the main model when missing', () => {
    const values = new Map<string, string>([['AI_PROVIDER_MAIN_AGENT_MODEL', 'gpt-main']]);

    applySharedAgentModelDefaults(values, 'gpt-main');

    expect(values.get('AI_PROVIDER_PROFILE_AGENT_MODEL')).toBe('gpt-main');
    expect(values.get('AI_PROVIDER_SUMMARY_AGENT_MODEL')).toBe('gpt-main');
  });

  it('preserves explicitly configured profile and summary models', () => {
    const values = new Map<string, string>([
      ['AI_PROVIDER_MAIN_AGENT_MODEL', 'gpt-main'],
      ['AI_PROVIDER_PROFILE_AGENT_MODEL', 'gpt-profile'],
      ['AI_PROVIDER_SUMMARY_AGENT_MODEL', 'gpt-summary'],
    ]);

    applySharedAgentModelDefaults(values, 'gpt-main');

    expect(values.get('AI_PROVIDER_PROFILE_AGENT_MODEL')).toBe('gpt-profile');
    expect(values.get('AI_PROVIDER_SUMMARY_AGENT_MODEL')).toBe('gpt-summary');
  });

  it('overwrites existing split-model values when shared defaults are chosen explicitly', () => {
    const values = new Map<string, string>([
      ['AI_PROVIDER_MAIN_AGENT_MODEL', 'gpt-main'],
      ['AI_PROVIDER_PROFILE_AGENT_MODEL', 'gpt-profile'],
      ['AI_PROVIDER_SUMMARY_AGENT_MODEL', 'gpt-summary'],
    ]);

    applySharedAgentModelDefaults(values, 'gpt-main', { overwriteExisting: true });

    expect(values.get('AI_PROVIDER_PROFILE_AGENT_MODEL')).toBe('gpt-main');
    expect(values.get('AI_PROVIDER_SUMMARY_AGENT_MODEL')).toBe('gpt-main');
  });

  it('preserves existing split-model values during automatic shared-model seeding', () => {
    const values = new Map<string, string>([
      ['AI_PROVIDER_MAIN_AGENT_MODEL', 'gpt-main'],
      ['AI_PROVIDER_PROFILE_AGENT_MODEL', 'gpt-profile'],
      ['AI_PROVIDER_SUMMARY_AGENT_MODEL', 'gpt-summary'],
    ]);

    if (
      shouldSeedSharedAgentModels({
        mode: 'host_key_now',
        interactive: true,
        nonInteractive: false,
      })
    ) {
      applySharedAgentModelDefaults(values, 'gpt-main');
    }

    expect(values.get('AI_PROVIDER_PROFILE_AGENT_MODEL')).toBe('gpt-profile');
    expect(values.get('AI_PROVIDER_SUMMARY_AGENT_MODEL')).toBe('gpt-summary');
  });

  it('clears any saved host API key when server-key activation is selected', () => {
    const values = new Map<string, string>([['AI_PROVIDER_API_KEY', 'sk-existing']]);

    applyProviderSetupModeDefaults(values, 'server_key_later');

    expect(values.get('AI_PROVIDER_API_KEY')).toBe('');
  });

  it('only forces shared models automatically outside the explicit split-model prompt path', () => {
    expect(
      shouldSeedSharedAgentModels({
        mode: 'host_key_now',
        interactive: true,
        nonInteractive: false,
      }),
    ).toBe(true);

    expect(
      shouldSeedSharedAgentModels({
        mode: 'both',
        interactive: true,
        nonInteractive: false,
      }),
    ).toBe(false);
  });

  it('builds a grouped onboarding summary with the chosen setup mode', () => {
    const values = new Map<string, string>([
      ['DISCORD_APP_ID', '123'],
      ['DISCORD_TOKEN', 'abc'],
      ['DATABASE_URL', 'postgres://local'],
      ['AI_PROVIDER_BASE_URL', 'https://example.com/v1'],
      ['AI_PROVIDER_API_KEY', 'sk-test'],
      ['AI_PROVIDER_MAIN_AGENT_MODEL', 'gpt-main'],
      ['AI_PROVIDER_PROFILE_AGENT_MODEL', 'gpt-main'],
      ['AI_PROVIDER_SUMMARY_AGENT_MODEL', 'gpt-main'],
    ]);

    const summary = buildOnboardingSummary({
      envPath: '.env',
      values,
      mode: 'both',
      inviteUrl: 'https://discord.com/oauth2/authorize?...',
    });

    expect(summary).toContain('Discord');
    expect(summary).toContain('AI provider');
    expect(summary).toContain('Setup mode: both');
    expect(summary).toContain('Shared model defaults: yes');
    expect(summary).toContain('Invite Sage: https://discord.com/oauth2/authorize?...');
  });
});
