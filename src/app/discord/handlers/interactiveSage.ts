import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  MessageFlags,
  ModalSubmitInteraction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
} from 'discord.js';
import { generateChatReply } from '../../../features/chat/chat-engine';
import { buildGuildApiKeyMissingResponse } from '../../../features/discord/byopBootstrap';
import {
  buildModalForInteractiveSession,
  buildPromptFromInteractiveModalSubmission,
  getActiveInteractiveSession,
  parseInteractiveModalCustomId,
  parseInteractiveSessionCustomId,
} from '../../../features/discord/interactiveComponentService';
import { generateTraceId } from '../../../shared/observability/trace-id-generator';
import { smartSplit } from '../../../shared/text/message-splitter';
import { isAdminFromMember } from '../../../platform/discord/admin-permissions';
import { client } from '../../../platform/discord/client';

type RepliableInteraction = ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction;

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
  if (params.result.meta?.kind === 'missing_api_key' && params.interaction.guildId) {
    const missing = buildGuildApiKeyMissingResponse({ isAdmin: params.isAdmin });
    await sendInteractionReply(params.interaction, {
      content: missing.content,
      components: missing.components,
      ephemeral: params.ephemeral,
    });
    return;
  }

  if (params.result.delivery === 'approval_governance_only') {
    await sendInteractionReply(params.interaction, {
      content: params.ephemeral ? 'Approval review posted.' : '\u200b',
      files: params.result.files,
    });
    return;
  }

  const chunks = smartSplit(params.result.replyText || '', 2_000);
  const [firstChunk, ...rest] = chunks;
  await sendInteractionReply(params.interaction, {
    content: firstChunk || '\u200b',
    files: params.result.files,
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
    await interaction.reply({ content: 'This Sage interaction has expired. Ask Sage again for a fresh one.', ephemeral: true });
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
    await interaction.reply({ content: 'This Sage form has expired. Ask Sage again for a fresh one.', ephemeral: true });
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

export async function sendCommandlessNotice(interaction: RepliableInteraction): Promise<void> {
  await sendInteractionReply(interaction, {
    content: 'Sage is chat-first now. Mention me, reply to me, or start with `Sage` instead of using slash commands.',
    ephemeral: true,
  });
}
