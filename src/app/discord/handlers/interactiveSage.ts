import {
  ButtonInteraction,
  MessageFlags,
  ModalSubmitInteraction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
} from 'discord.js';
import { generateChatReply } from '../../../features/chat/chat-engine';
import { retryFailedChatTurn } from '../../../features/agent-runtime/agentRuntime';
import { buildGuildApiKeyMissingResponse } from '../../../features/discord/byopBootstrap';
import {
  buildModalForInteractiveSession,
  consumeActiveInteractiveSession,
  buildPromptFromInteractiveModalSubmission,
  createInteractiveButtonSession,
  getActiveInteractiveSession,
  parseInteractiveModalCustomId,
  parseInteractiveSessionCustomId,
} from '../../../features/discord/interactiveComponentService';
import { logger } from '../../../platform/logging/logger';
import { generateTraceId } from '../../../shared/observability/trace-id-generator';
import { smartSplit } from '../../../shared/text/message-splitter';
import { isAdminFromMember, isModeratorFromMember } from '../../../platform/discord/admin-permissions';
import { client } from '../../../platform/discord/client';
import {
  buildConsumedInteractionText,
  buildExpiredInteractionText,
  buildRetryButtonLabel,
  buildRetryChannelMismatchText,
  buildRetryOwnerMismatchText,
} from '../../../features/discord/userFacingCopy';
import { buildRuntimeResponseCardPayload } from '../../../features/discord/runtimeResponseCards';

type RepliableInteraction = ButtonInteraction | ModalSubmitInteraction;
type InteractionPublishMode = 'reply' | 'update_source';

function resolveInteractionDisplayName(interaction: RepliableInteraction): string {
  const member = interaction.member;
  if (member && typeof member === 'object' && 'displayName' in member && typeof member.displayName === 'string') {
    return member.displayName;
  }
  return interaction.user.globalName ?? interaction.user.username;
}

async function sendInteractionReply(
  interaction: RepliableInteraction,
  payload: InteractionReplyOptions | InteractionEditReplyOptions,
): Promise<void> {
  const normalizedPayload =
    'components' in payload && payload.components
      ? ({
          ...payload,
          withComponents: true,
        } as InteractionReplyOptions | InteractionEditReplyOptions)
      : payload;
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(normalizedPayload as InteractionEditReplyOptions);
    return;
  }
  await interaction.reply(normalizedPayload as InteractionReplyOptions);
}

async function publishChatResultToInteraction(params: {
  interaction: RepliableInteraction;
  result: Awaited<ReturnType<typeof generateChatReply>>;
  isAdmin: boolean;
  ephemeral: boolean;
  mode: InteractionPublishMode;
}): Promise<void> {
  if (
    params.result.meta?.kind === 'missing_api_key' &&
    params.interaction.guildId &&
    params.result.meta.missingApiKey?.recovery === 'server_key_activation'
  ) {
    const missing = buildGuildApiKeyMissingResponse({ isAdmin: params.isAdmin });
    await sendInteractionReply(params.interaction, {
      flags: missing.flags,
      components: missing.components,
    });
    return;
  }

  const retry = params.result.meta?.retry;
  let actionButtonId: string | null = null;
  let actionButtonLabel: string | null = null;
  if (retry && params.interaction.guildId && params.interaction.channelId) {
    try {
      actionButtonId = await createInteractiveButtonSession({
        guildId: params.interaction.guildId,
        channelId: params.interaction.channelId,
        createdByUserId: params.interaction.user.id,
        action: {
          type: 'graph_retry',
          threadId: retry.threadId,
          retryKind: retry.retryKind,
          visibility: params.ephemeral ? 'ephemeral' : 'public',
        },
      });
      actionButtonLabel = buildRetryButtonLabel();
    } catch (err) {
      logger.warn(
        {
          err,
          retryThreadId: retry.threadId,
          channelId: params.interaction.channelId,
          interactionId: 'id' in params.interaction ? params.interaction.id : undefined,
        },
        'Failed to create retry button session; sending retry text without button',
      );
    }
  }

  const chunks = smartSplit(params.result.replyText || '', 2_000);
  const [firstChunk, ...rest] = chunks;
  const actionButton =
    actionButtonId
      ? {
          customId: actionButtonId,
          label: actionButtonLabel ?? buildRetryButtonLabel(),
          style: 'primary' as const,
        }
      : null;
  const shouldUseRuntimeCard = params.mode === 'update_source' || !!actionButton;
  const primaryText = firstChunk || '\u200b';
  const primaryPayload = shouldUseRuntimeCard
    ? buildRuntimeResponseCardPayload({
        text: primaryText,
        tone: retry ? 'retry' : 'notice',
        button: actionButton,
        files: params.result.files,
      })
    : {
        content: primaryText,
        files: params.result.files,
      };

  await sendInteractionReply(params.interaction, primaryPayload as InteractionReplyOptions | InteractionEditReplyOptions);

  for (const chunk of rest) {
    await params.interaction.followUp({
      content: chunk,
      flags: params.ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }
}

async function runInteractivePrompt(params: {
  interaction: RepliableInteraction;
  prompt: string;
  ephemeral: boolean;
}): Promise<void> {
  const channelId = params.interaction.channelId;
  if (!channelId) {
    throw new Error('Interactive Sage actions require a channel context.');
  }

  await params.interaction.deferReply({ ephemeral: params.ephemeral });
  const invokerDisplayName = resolveInteractionDisplayName(params.interaction);
  const invokerIsAdmin = isAdminFromMember(params.interaction.member);
  const invokerCanModerate = isModeratorFromMember(params.interaction.member);
  const result = await generateChatReply({
    traceId: generateTraceId(),
    userId: params.interaction.user.id,
    channelId,
    guildId: params.interaction.guildId,
    messageId: params.interaction.id,
    userText: params.prompt,
    userContent: params.prompt,
    currentTurn: {
      invokerUserId: params.interaction.user.id,
      invokerDisplayName,
      messageId: params.interaction.id,
      guildId: params.interaction.guildId,
      channelId,
      invokedBy: 'component',
      mentionedUserIds: [],
      isDirectReply: false,
      replyTargetMessageId: null,
      replyTargetAuthorId: null,
      botUserId: client.user?.id ?? null,
    },
    replyTarget: null,
    invokedBy: 'component',
    isVoiceActive: false,
    voiceChannelId: null,
    isAdmin: invokerIsAdmin,
    canModerate: invokerCanModerate,
  });

  await publishChatResultToInteraction({
    interaction: params.interaction,
    result,
    isAdmin: invokerIsAdmin,
    ephemeral: params.ephemeral,
    mode: 'reply',
  });
}

async function claimSingleUseButtonSession(params: {
  interaction: ButtonInteraction;
  sessionId: string;
  session: Awaited<ReturnType<typeof getActiveInteractiveSession>>;
}): Promise<boolean> {
  if (!params.session) {
    return false;
  }

  const claimed = await consumeActiveInteractiveSession(params.sessionId, params.session);
  if (claimed) {
    return true;
  }

  await params.interaction.reply({
    content: buildConsumedInteractionText('button'),
    ephemeral: true,
  });
  return false;
}

export async function handleInteractiveButtonSession(
  interaction: ButtonInteraction,
): Promise<boolean> {
  const sessionId = parseInteractiveSessionCustomId(interaction.customId);
  if (!sessionId) {
    return false;
  }

  const session = await getActiveInteractiveSession(sessionId);
  if (!session) {
    await interaction.reply({ content: buildExpiredInteractionText('button'), ephemeral: true });
    return true;
  }

  if (session.kind === 'prompt_button') {
    await runInteractivePrompt({
      interaction,
      prompt: session.prompt,
      ephemeral: session.visibility === 'ephemeral',
    });
    return true;
  }

  if (session.kind === 'graph_retry_button') {
    if (session.createdByUserId !== interaction.user.id) {
      await interaction.reply({
        content: buildRetryOwnerMismatchText(),
        ephemeral: true,
      });
      return true;
    }
    if (session.guildId !== interaction.guildId || session.channelId !== interaction.channelId) {
      await interaction.reply({
        content: buildRetryChannelMismatchText(session.channelId),
        ephemeral: true,
      });
      return true;
    }
    if (!(await claimSingleUseButtonSession({ interaction, sessionId, session }))) {
      return true;
    }
    await interaction.deferUpdate();
    const invokerIsAdmin = isAdminFromMember(interaction.member);
    const invokerCanModerate = isModeratorFromMember(interaction.member);
    const result = await retryFailedChatTurn({
      traceId: generateTraceId(),
      threadId: session.threadId,
      userId: interaction.user.id,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      retryKind: session.retryKind,
      isAdmin: invokerIsAdmin,
      canModerate: invokerCanModerate,
    });
    await publishChatResultToInteraction({
      interaction,
      result,
      isAdmin: invokerIsAdmin,
      ephemeral: session.visibility === 'ephemeral',
      mode: 'update_source',
    });
    return true;
  }

  await interaction.showModal(
    buildModalForInteractiveSession({
      sessionId,
      session,
    }),
  );
  return true;
}

export async function handleInteractiveModalSession(
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  const sessionId = parseInteractiveModalCustomId(interaction.customId);
  if (!sessionId) {
    return false;
  }

  const session = await getActiveInteractiveSession(sessionId);
  if (!session || session.kind !== 'modal_prompt_button') {
    await interaction.reply({ content: buildExpiredInteractionText('form'), ephemeral: true });
    return true;
  }

  const valuesByFieldId = Object.fromEntries(
    session.fields.map((field) => [field.id, interaction.fields.getTextInputValue(field.id)]),
  );
  const prompt = buildPromptFromInteractiveModalSubmission({
    session,
    valuesByFieldId,
  });

  await runInteractivePrompt({
    interaction,
    prompt,
    ephemeral: session.visibility === 'ephemeral',
  });
  return true;
}
