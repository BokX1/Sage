import { describe, expect, it } from 'vitest';
import {
  buildDiscordComponentsV2MessagePayload,
  discordInteractionRequestSchema,
} from '@/features/admin/adminActionService';
import { MessageFlags } from 'discord.js';
import { ComponentType } from 'discord-api-types/payloads/v10';

describe('adminActionService interaction schemas', () => {
  it('accepts send_message interaction requests', () => {
    const parsed = discordInteractionRequestSchema.parse({
      action: 'send_message',
      channelId: '<#1234567890>',
      content: '  hello world  ',
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        action: 'send_message',
        channelId: '<#1234567890>',
        content: 'hello world',
      }),
    );
  });

  it('accepts send_message with files and optional content', () => {
    const parsed = discordInteractionRequestSchema.parse({
      action: 'send_message',
      channelId: '<#1234567890>',
      files: [
        {
          filename: 'demo.txt',
          source: { type: 'text', text: 'hello' },
        },
      ],
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        action: 'send_message',
        channelId: '<#1234567890>',
        files: [
          expect.objectContaining({
            filename: 'demo.txt',
          }),
        ],
      }),
    );
  });

  it('rejects send_message when neither content nor files are provided', () => {
    expect(() =>
      discordInteractionRequestSchema.parse({
        action: 'send_message',
        channelId: '<#1234567890>',
      }),
    ).toThrow('requires content or files');
  });

  it('accepts legacy interactive send_message payloads', () => {
    const parsed = discordInteractionRequestSchema.parse({
      action: 'send_message',
      channelId: '<#1234567890>',
      presentation: 'legacy_components',
      content: 'Pick one',
      legacyComponents: {
        buttons: [{ label: 'Open docs', url: 'https://example.com/docs' }],
      },
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        presentation: 'legacy_components',
        legacyComponents: {
          buttons: [{ label: 'Open docs', url: 'https://example.com/docs' }],
        },
      }),
    );
  });

  it('accepts components_v2 send_message payloads with attachment-backed media', () => {
    const parsed = discordInteractionRequestSchema.parse({
      action: 'send_message',
      channelId: '<#1234567890>',
      presentation: 'components_v2',
      files: [
        {
          filename: 'report.png',
          source: { type: 'text', text: 'image-bytes-placeholder' },
        },
      ],
      componentsV2: {
        accentColorHex: '#4a7c23',
        blocks: [
          { type: 'text', content: '**Build report**' },
          {
            type: 'section',
            texts: ['Latest deploy passed.'],
            accessory: {
              type: 'thumbnail',
              media: { attachmentName: 'report.png' },
            },
          },
          {
            type: 'file',
            attachmentName: 'report.png',
          },
        ],
      },
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        presentation: 'components_v2',
        componentsV2: expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({ type: 'text' }),
            expect.objectContaining({ type: 'section' }),
            expect.objectContaining({ type: 'file', attachmentName: 'report.png' }),
          ]),
        }),
      }),
    );
  });

  it('rejects components_v2 send_message payloads that reference unknown attachments', () => {
    expect(() =>
      discordInteractionRequestSchema.parse({
        action: 'send_message',
        channelId: '<#1234567890>',
        presentation: 'components_v2',
        files: [
          {
            filename: 'known.png',
            source: { type: 'text', text: 'hello' },
          },
        ],
        componentsV2: {
          blocks: [
            {
              type: 'file',
              attachmentName: 'missing.png',
            },
          ],
        },
      }),
    ).toThrow('unknown attachment');
  });

  it('builds Components V2 payloads with the required flag and component structure', () => {
    const payload = buildDiscordComponentsV2MessagePayload({
      message: {
        accentColorHex: '#4a7c23',
        blocks: [
          { type: 'text', content: '**Summary**' },
          {
            type: 'section',
            texts: ['Open the report'],
            accessory: {
              type: 'link_button',
              button: { label: 'View', url: 'https://example.com/report' },
            },
          },
        ],
      },
    });

    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.components).toHaveLength(1);
    expect(payload.components[0]?.type).toBe(ComponentType.Container);
  });
});
