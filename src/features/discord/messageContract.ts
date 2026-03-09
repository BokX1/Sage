import { z } from 'zod';
import {
  interactiveButtonActionSchema,
  interactiveModalFieldSchema,
} from './interactiveComponentService';

export const discordMessageFileSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('url'),
    url: z.string().trim().url().max(2_048),
  }),
  z.object({
    type: z.literal('text'),
    text: z.string().max(20_000),
  }),
  z.object({
    type: z.literal('base64'),
    base64: z.string().max(50_000),
  }),
]);

export const discordMessageFileInputSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200).optional(),
  source: discordMessageFileSourceSchema,
});

export const discordMessageLinkButtonSchema = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(2_048),
}).strict();

export const discordInteractiveActionButtonSchema = z.object({
  label: z.string().trim().min(1).max(80),
  style: z.enum(['primary', 'secondary', 'success', 'danger']).optional(),
  interaction: interactiveButtonActionSchema,
}).strict();

export const discordComponentsV2MediaRefSchema = z.object({
  url: z.string().trim().url().max(2_048).optional(),
  attachmentName: z.string().trim().min(1).max(255).optional(),
}).superRefine((value, ctx) => {
  const count = Number(value.url !== undefined) + Number(value.attachmentName !== undefined);
  if (count !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide exactly one of url or attachmentName.',
    });
  }
});

const discordComponentsV2ThumbnailAccessorySchema = z.object({
  type: z.literal('thumbnail'),
  media: discordComponentsV2MediaRefSchema,
  description: z.string().trim().max(1_024).optional(),
  spoiler: z.boolean().optional(),
});

const discordComponentsV2LinkButtonAccessorySchema = z.object({
  type: z.literal('link_button'),
  button: discordMessageLinkButtonSchema,
});

const discordComponentsV2TextBlockSchema = z.object({
  type: z.literal('text'),
  content: z.string().trim().min(1).max(4_000),
});

const discordComponentsV2SectionBlockSchema = z.object({
  type: z.literal('section'),
  texts: z.array(z.string().trim().min(1).max(2_000)).min(1).max(3),
  accessory: z.union([
    discordComponentsV2ThumbnailAccessorySchema,
    discordComponentsV2LinkButtonAccessorySchema,
  ]),
});

const discordComponentsV2MediaGalleryBlockSchema = z.object({
  type: z.literal('media_gallery'),
  items: z.array(z.object({
    media: discordComponentsV2MediaRefSchema,
    description: z.string().trim().max(1_024).optional(),
    spoiler: z.boolean().optional(),
  })).min(1).max(10),
});

const discordComponentsV2FileBlockSchema = z.object({
  type: z.literal('file'),
  attachmentName: z.string().trim().min(1).max(255),
  spoiler: z.boolean().optional(),
});

const discordComponentsV2SeparatorBlockSchema = z.object({
  type: z.literal('separator'),
  divider: z.boolean().optional(),
  spacing: z.enum(['small', 'large']).optional(),
});

const discordComponentsV2ActionRowBlockSchema = z.object({
  type: z.literal('action_row'),
  buttons: z.array(z.union([discordMessageLinkButtonSchema, discordInteractiveActionButtonSchema])).min(1).max(5),
});

export const discordComponentsV2BlockSchema = z.discriminatedUnion('type', [
  discordComponentsV2TextBlockSchema,
  discordComponentsV2SectionBlockSchema,
  discordComponentsV2MediaGalleryBlockSchema,
  discordComponentsV2FileBlockSchema,
  discordComponentsV2SeparatorBlockSchema,
  discordComponentsV2ActionRowBlockSchema,
]);

export const discordMessagePresentationSchema = z.enum(['plain', 'components_v2']);

export const discordComponentsV2MessageSchema = z.object({
  accentColorHex: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
  spoiler: z.boolean().optional(),
  blocks: z.array(discordComponentsV2BlockSchema).min(1).max(10),
});

export type DiscordComponentsV2Message = z.infer<typeof discordComponentsV2MessageSchema>;
export type DiscordMessageFileInput = z.infer<typeof discordMessageFileInputSchema>;
export type DiscordMessagePresentation = z.infer<typeof discordMessagePresentationSchema>;
export type DiscordInteractiveActionButton = z.infer<typeof discordInteractiveActionButtonSchema>;
export type DiscordInteractiveModalField = z.infer<typeof interactiveModalFieldSchema>;

export function validateDiscordSendMessagePayload(
  value: {
    presentation?: DiscordMessagePresentation;
    content?: string;
    files?: Array<Pick<DiscordMessageFileInput, 'filename'>>;
    componentsV2?: DiscordComponentsV2Message;
  },
  ctx: z.RefinementCtx,
  options: { actionLabel: string },
): void {
  const presentation = value.presentation ?? 'plain';
  const hasContent = value.content !== undefined;
  const hasFiles = Boolean(value.files?.length);
  const attachmentNames = new Set((value.files ?? []).map((file) => file.filename));

  if (presentation === 'plain') {
    if (!hasContent && !hasFiles) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${options.actionLabel} requires content or files.`,
      });
    }
    if (value.componentsV2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'componentsV2 is only valid when presentation=components_v2.',
        path: ['componentsV2'],
      });
    }
    return;
  }

  if (hasContent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${options.actionLabel} with presentation=components_v2 must not include content.`,
      path: ['content'],
    });
  }
  if (!value.componentsV2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${options.actionLabel} with presentation=components_v2 requires componentsV2.`,
      path: ['componentsV2'],
    });
    return;
  }

  for (const [blockIndex, block] of value.componentsV2.blocks.entries()) {
    if (block.type === 'file' && !attachmentNames.has(block.attachmentName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `componentsV2 file block references unknown attachment "${block.attachmentName}".`,
        path: ['componentsV2', 'blocks', blockIndex, 'attachmentName'],
      });
    }
    if (block.type === 'section' && block.accessory?.type === 'thumbnail') {
      const attachmentName = block.accessory.media.attachmentName;
      if (attachmentName && !attachmentNames.has(attachmentName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `componentsV2 section thumbnail references unknown attachment "${attachmentName}".`,
          path: ['componentsV2', 'blocks', blockIndex, 'accessory', 'media', 'attachmentName'],
        });
      }
    }
    if (block.type === 'media_gallery') {
      for (const [itemIndex, item] of block.items.entries()) {
        const attachmentName = item.media.attachmentName;
        if (attachmentName && !attachmentNames.has(attachmentName)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `componentsV2 media gallery item references unknown attachment "${attachmentName}".`,
            path: ['componentsV2', 'blocks', blockIndex, 'items', itemIndex, 'media', 'attachmentName'],
          });
        }
      }
    }
  }
}
