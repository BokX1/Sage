import { MessageFlags } from 'discord.js';
import { ComponentType } from 'discord-api-types/payloads/v10';
import { describe, expect, it } from 'vitest';

import {
  buildGuildApiKeyMissingResponse,
  buildGuildApiKeySetupCardMessage,
  buildGuildApiKeyWelcomeMessage,
} from '@/features/discord/byopBootstrap';

describe('byopBootstrap activation cards', () => {
  it('builds a Components V2 hosted-activation card for admin recovery', () => {
    const payload = buildGuildApiKeyMissingResponse({ isAdmin: true });

    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.components[0]?.type).toBe(ComponentType.Container);
    const container = payload.components[0] as {
      components: Array<{ type: number; content?: string; components?: Array<{ label?: string; disabled?: boolean }> }>;
    };
    expect(container.components.some((component) => component.content?.includes('Hosted Sage Needs A Server Key'))).toBe(true);
    const actionRow = container.components.find((component) => component.type === ComponentType.ActionRow);
    expect(actionRow?.components?.map((button) => button.label)).toEqual([
      'Get Pollinations Key',
      'Set Server Key',
      'Check Key',
      'Clear Key',
    ]);
    expect(actionRow?.components?.slice(1).every((button) => button.disabled !== true)).toBe(true);
  });

  it('disables admin-only activation actions for non-admin recovery cards', () => {
    const payload = buildGuildApiKeyMissingResponse({ isAdmin: false });
    const container = payload.components[0] as {
      components: Array<{ type: number; components?: Array<{ label?: string; disabled?: boolean }> }>;
    };
    const actionRow = container.components.find((component) => component.type === ComponentType.ActionRow);

    expect(actionRow?.components?.[0]?.disabled).not.toBe(true);
    expect(actionRow?.components?.slice(1).every((button) => button.disabled === true)).toBe(true);
  });

  it('builds the explicit setup-card tool payload as Components V2', () => {
    const payload = buildGuildApiKeySetupCardMessage();

    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.components[0]?.type).toBe(ComponentType.Container);
    const container = payload.components[0] as {
      components: Array<{ content?: string }>;
    };
    expect(container.components.some((component) => component.content?.includes('Activate Hosted Sage For This Server'))).toBe(true);
  });

  it('builds the proactive welcome message as a Components V2 card', () => {
    const payload = buildGuildApiKeyWelcomeMessage();

    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.components[0]?.type).toBe(ComponentType.Container);
    const container = payload.components[0] as {
      components: Array<{ type: number; content?: string; components?: Array<{ label?: string }> }>;
    };

    expect(container.components.some((component) => component.content?.includes('Welcome To Sage'))).toBe(true);
    expect(container.components.some((component) => component.content?.includes('**Get Live**'))).toBe(true);
    const actionRow = container.components.find((component) => component.type === ComponentType.ActionRow);
    expect(actionRow?.components?.map((button) => button.label)).toEqual([
      'Get Pollinations Key',
      'Set Server Key',
      'Check Key',
      'Clear Key',
    ]);
  });
});
