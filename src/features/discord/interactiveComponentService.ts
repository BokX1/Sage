import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIButtonComponent,
  type ModalActionRowComponentBuilder,
} from 'discord.js';
import { z } from 'zod';
import { createDiscordInteractionSession, getDiscordInteractionSessionById } from './interactionSessionRepo';

export const DISCORD_UI_SESSION_CUSTOM_ID_PREFIX = 'sage:ui:';
export const DISCORD_UI_MODAL_CUSTOM_ID_PREFIX = 'sage:ui_modal:';
export const DISCORD_UI_SESSION_TTL_MS = 24 * 60 * 60_000;

export const interactiveButtonVisibilitySchema = z.enum(['public', 'ephemeral']);

export const interactiveModalFieldSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(45),
  style: z.enum(['short', 'paragraph']).optional(),
  placeholder: z.string().trim().max(100).optional(),
  value: z.string().trim().max(4_000).optional(),
  required: z.boolean().optional(),
  minLength: z.number().int().min(0).max(4_000).optional(),
  maxLength: z.number().int().min(1).max(4_000).optional(),
});

export const interactivePromptActionSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string().trim().min(1).max(2_000),
  visibility: interactiveButtonVisibilitySchema.optional(),
});

export const interactiveModalPromptActionSchema = z.object({
  type: z.literal('modal_prompt'),
  modalTitle: z.string().trim().min(1).max(45),
  promptTemplate: z.string().trim().min(1).max(4_000),
  fields: z.array(interactiveModalFieldSchema).min(1).max(5),
  visibility: interactiveButtonVisibilitySchema.optional(),
});

export const interactiveGraphContinueActionSchema = z.object({
  type: z.literal('graph_continue'),
  continuationId: z.string().trim().min(1).max(64),
  visibility: interactiveButtonVisibilitySchema.optional(),
});

export const interactiveButtonActionSchema = z.discriminatedUnion('type', [
  interactivePromptActionSchema,
  interactiveModalPromptActionSchema,
  interactiveGraphContinueActionSchema,
]);

export type InteractiveButtonAction = z.infer<typeof interactiveButtonActionSchema>;
export type InteractiveModalField = z.infer<typeof interactiveModalFieldSchema>;

type StoredInteractiveSessionPayload =
  | {
      kind: 'prompt_button';
      visibility: 'public' | 'ephemeral';
      prompt: string;
    }
  | {
      kind: 'modal_prompt_button';
      visibility: 'public' | 'ephemeral';
      modalTitle: string;
      promptTemplate: string;
      fields: InteractiveModalField[];
    }
  | {
      kind: 'graph_continue_button';
      visibility: 'public' | 'ephemeral';
      continuationId: string;
    };

export type ActiveInteractiveSession = StoredInteractiveSessionPayload & {
  guildId: string;
  channelId: string;
  createdByUserId: string;
  expiresAt: Date;
};

export function buildInteractiveSessionCustomId(sessionId: string): string {
  return `${DISCORD_UI_SESSION_CUSTOM_ID_PREFIX}${sessionId}`;
}

export function buildInteractiveModalCustomId(sessionId: string): string {
  return `${DISCORD_UI_MODAL_CUSTOM_ID_PREFIX}${sessionId}`;
}

export function parseInteractiveSessionCustomId(customId: string): string | null {
  if (!customId.startsWith(DISCORD_UI_SESSION_CUSTOM_ID_PREFIX)) {
    return null;
  }
  const sessionId = customId.slice(DISCORD_UI_SESSION_CUSTOM_ID_PREFIX.length).trim();
  return sessionId.length > 0 ? sessionId : null;
}

export function parseInteractiveModalCustomId(customId: string): string | null {
  if (!customId.startsWith(DISCORD_UI_MODAL_CUSTOM_ID_PREFIX)) {
    return null;
  }
  const sessionId = customId.slice(DISCORD_UI_MODAL_CUSTOM_ID_PREFIX.length).trim();
  return sessionId.length > 0 ? sessionId : null;
}

export async function createInteractiveButtonSession(params: {
  guildId: string;
  channelId: string;
  createdByUserId: string;
  action: InteractiveButtonAction;
}): Promise<string> {
  const payload: StoredInteractiveSessionPayload =
    params.action.type === 'prompt'
      ? {
          kind: 'prompt_button',
          visibility: params.action.visibility ?? 'public',
          prompt: params.action.prompt,
        }
      : params.action.type === 'modal_prompt'
        ? {
          kind: 'modal_prompt_button',
          visibility: params.action.visibility ?? 'public',
          modalTitle: params.action.modalTitle,
          promptTemplate: params.action.promptTemplate,
          fields: params.action.fields,
        }
        : {
            kind: 'graph_continue_button',
            visibility: params.action.visibility ?? 'public',
            continuationId: params.action.continuationId,
          };

  const session = await createDiscordInteractionSession({
    guildId: params.guildId,
    channelId: params.channelId,
    createdByUserId: params.createdByUserId,
    kind: payload.kind,
    payloadJson: payload,
    expiresAt: new Date(Date.now() + DISCORD_UI_SESSION_TTL_MS),
  });

  return buildInteractiveSessionCustomId(session.id);
}

export async function getActiveInteractiveSession(sessionId: string): Promise<ActiveInteractiveSession | null> {
  const record = await getDiscordInteractionSessionById(sessionId);
  if (!record || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const parsed = z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('prompt_button'),
        visibility: interactiveButtonVisibilitySchema,
        prompt: z.string().trim().min(1).max(2_000),
      }),
      z.object({
        kind: z.literal('modal_prompt_button'),
        visibility: interactiveButtonVisibilitySchema,
        modalTitle: z.string().trim().min(1).max(45),
        promptTemplate: z.string().trim().min(1).max(4_000),
        fields: z.array(interactiveModalFieldSchema).min(1).max(5),
      }),
      z.object({
        kind: z.literal('graph_continue_button'),
        visibility: interactiveButtonVisibilitySchema,
        continuationId: z.string().trim().min(1).max(64),
      }),
    ])
    .safeParse(record.payloadJson);

  if (!parsed.success) {
    return null;
  }

  return {
    ...parsed.data,
    guildId: record.guildId,
    channelId: record.channelId,
    createdByUserId: record.createdByUserId,
    expiresAt: record.expiresAt,
  };
}

export function buildModalForInteractiveSession(params: {
  sessionId: string;
  session: Extract<StoredInteractiveSessionPayload, { kind: 'modal_prompt_button' }>;
}): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildInteractiveModalCustomId(params.sessionId))
    .setTitle(params.session.modalTitle);

  const rows = params.session.fields.map((field) => {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required ?? true);

    if (field.placeholder) input.setPlaceholder(field.placeholder);
    if (field.value) input.setValue(field.value);
    if (typeof field.minLength === 'number') input.setMinLength(field.minLength);
    if (typeof field.maxLength === 'number') input.setMaxLength(field.maxLength);

    return new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  });

  modal.addComponents(...rows);
  return modal;
}

export function buildPromptFromInteractiveModalSubmission(params: {
  session: Extract<StoredInteractiveSessionPayload, { kind: 'modal_prompt_button' }>;
  valuesByFieldId: Record<string, string>;
}): string {
  let output = params.session.promptTemplate;

  for (const field of params.session.fields) {
    const value = params.valuesByFieldId[field.id] ?? '';
    output = output.replaceAll(`{{${field.id}}}`, value);
  }

  return output.trim();
}

export function buildActionButtonComponent(params: {
  customId: string;
  label: string;
  style?: 'primary' | 'secondary' | 'success' | 'danger';
}): APIButtonComponent {
  return {
    type: 2,
    style:
      params.style === 'success'
        ? 3
        : params.style === 'danger'
          ? 4
          : params.style === 'secondary'
            ? 2
            : 1,
    label: params.label,
    custom_id: params.customId,
  };
}
