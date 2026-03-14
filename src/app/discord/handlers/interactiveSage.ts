import {
  ButtonInteraction,
  MessageFlags,
  ModalSubmitInteraction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
} from 'discord.js';
import { generateChatReply } from '../../../features/chat/chat-engine';
import { resumeContinuationChatTurn } from '../../../features/agent-runtime/agentRuntime';
import { buildGuildApiKeyMissingResponse } from '../../../features/discord/byopBootstrap';
import {
  buildActionButtonComponent,
  buildModalForInteractiveSession,
  buildPromptFromInteractiveModalSubmission,
  createInteractiveButtonSession,
  getActiveInteractiveSession,
  parseInteractiveModalCustomId,
  parseInteractiveSessionCustomId,
} from '../../../features/discord/interactiveComponentService';
import { logger } from '../../../platform/logging/logger';
import { generateTraceId } from '../../../shared/observability/trace-id-generator';
import { smartSplit } from '../../../shared/text/message-splitter';
import { isAdminFromMember } from '../../../platform/discord/admin-permissions';
import { client } from '../../../platform/discord/client';
import {
  buildApprovalReviewPostedText,
  buildContinueChannelMismatchText,
  buildContinueOwnerMismatchText,
  buildContinuationButtonLabel,
  buildExpiredInteractionText,
} from '../../../features/discord/userFacingCopy';

type RepliableInteraction = ButtonInteraction | ModalSubmitInteraction;

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
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload as InteractionEditReplyOptions);
    return;
  }
  await interaction.reply(payload as InteractionReplyOptions);
}

async function publishChatResultToInteraction(params: {
  interaction: RepliableInteraction;
  result: Awaited<ReturnType<typeof generateChatReply>>;
  isAdmin: boolean;
  ephemeral: boolean;
}): Promise<void> {
  if (
    params.result.meta?.kind === 'missing_api_key' &&
    params.interaction.guildId &&
    params.result.meta.missingApiKey?.recovery === 'server_key_activation'
  ) {
    const missing = buildGuildApiKeyMissingResponse({ isAdmin: params.isAdmin });
    await sendInteractionReply(params.interaction, {
      content: missing.content,
      components: missing.components,
      ephemeral: params.ephemeral,
    });
    return;
  }

  if (params.result.delivery === 'approval_governance_only') {
    const reviewMeta = params.result.meta?.approvalReview;
    await sendInteractionReply(params.interaction, {
      content: buildApprovalReviewPostedText(reviewMeta),
      files: params.result.files,
    });
    return;
  }

  const continuation = params.result.meta?.continuation;
  let continuationButtonId: string | null = null;
  if (
    params.result.delivery === 'chat_reply_with_continue' &&
    continuation &&
    params.interaction.guildId &&
    params.interaction.channelId
  ) {
    try {
      continuationButtonId = await createInteractiveButtonSession({
        guildId: params.interaction.guildId,
        channelId: params.interaction.channelId,
        createdByUserId: params.interaction.user.id,
        action: {
          type: 'graph_continue',
          continuationId: continuation.id,
          visibility: params.ephemeral ? 'ephemeral' : 'public',
        },
      });
    } catch (err) {
      logger.warn(
        {
          err,
          continuationId: continuation.id,
          channelId: params.interaction.channelId,
          interactionId: 'id' in params.interaction ? params.interaction.id : undefined,
        },
        'Failed to create continuation button session; sending summary without button',
      );
    }
  }

  const chunks = smartSplit(params.result.replyText || '', 2_000);
  const [firstChunk, ...rest] = chunks;
  await sendInteractionReply(params.interaction, {
    content: firstChunk || '\u200b',
    files: params.result.files,
    components:
      continuationButtonId
        ? [
            {
              type: 1,
              components: [
                buildActionButtonComponent({
                  customId: continuationButtonId,
                  label: buildContinuationButtonLabel(params.result.meta?.continuation),
                  style: 'primary',
                }),
              ],
            },
          ]
        : undefined,
  });

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
    isAdmin: isAdminFromMember(params.interaction.member),
  });

  await publishChatResultToInteraction({
    interaction: params.interaction,
    result,
    isAdmin: isAdminFromMember(params.interaction.member),
    ephemeral: params.ephemeral,
  });
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

  if (session.kind === 'graph_continue_button') {
    if (session.createdByUserId !== interaction.user.id) {
      await interaction.reply({
        content: buildContinueOwnerMismatchText(),
        ephemeral: true,
      });
      return true;
    }
    if (session.guildId !== interaction.guildId || session.channelId !== interaction.channelId) {
      await interaction.reply({
        content: buildContinueChannelMismatchText(session.channelId),
        ephemeral: true,
      });
      return true;
    }
    await interaction.deferReply({ ephemeral: session.visibility === 'ephemeral' });
    const result = await resumeContinuationChatTurn({
      traceId: generateTraceId(),
      userId: interaction.user.id,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      continuationId: session.continuationId,
      isAdmin: isAdminFromMember(interaction.member),
    });
    await publishChatResultToInteraction({
      interaction,
      result,
      isAdmin: isAdminFromMember(interaction.member),
      ephemeral: session.visibility === 'ephemeral',
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
