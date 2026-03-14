import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  POLLINATIONS_AUTHORIZE_URL,
  buildGuildApiKeyLoginInstructions,
  buildGuildApiKeySetupGuidance,
  clearGuildApiKey,
  getGuildApiKeyStatus,
  getKeySetVerificationFailureMessage,
  saveVerifiedGuildApiKey,
} from '../settings/guildApiKeyService';
import { isAdminInteraction } from '../../platform/discord/admin-permissions';
import { buildMissingGuildActivationText } from './userFacingCopy';

const GUILD_API_KEY_SET_CUSTOM_ID = 'sage:bootstrap:key:set';
const GUILD_API_KEY_CHECK_CUSTOM_ID = 'sage:bootstrap:key:check';
const GUILD_API_KEY_CLEAR_CUSTOM_ID = 'sage:bootstrap:key:clear';
const GUILD_API_KEY_SET_MODAL_CUSTOM_ID = 'sage:bootstrap:key:set_modal';
const GUILD_API_KEY_MODAL_FIELD_ID = 'guild_api_key';

type BootstrapButtonId =
  | typeof GUILD_API_KEY_SET_CUSTOM_ID
  | typeof GUILD_API_KEY_CHECK_CUSTOM_ID
  | typeof GUILD_API_KEY_CLEAR_CUSTOM_ID;

function makeBootstrapRows(disableAdminActions: boolean) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel('Get Pollinations Key').setStyle(ButtonStyle.Link).setURL(POLLINATIONS_AUTHORIZE_URL),
      new ButtonBuilder()
        .setCustomId(GUILD_API_KEY_SET_CUSTOM_ID)
        .setLabel('Set Server Key')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disableAdminActions),
      new ButtonBuilder()
        .setCustomId(GUILD_API_KEY_CHECK_CUSTOM_ID)
        .setLabel('Check Key')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disableAdminActions),
      new ButtonBuilder()
        .setCustomId(GUILD_API_KEY_CLEAR_CUSTOM_ID)
        .setLabel('Clear Key')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disableAdminActions),
    ),
  ];
}

function buildGuildApiKeyModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(GUILD_API_KEY_SET_MODAL_CUSTOM_ID)
    .setTitle('Set Server API Key')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(GUILD_API_KEY_MODAL_FIELD_ID)
          .setLabel('Pollinations Secret Key')
          .setPlaceholder('sk_...')
          .setRequired(true)
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(256),
      ),
    );
}

export function buildGuildApiKeyMissingResponse(params: { isAdmin: boolean }): {
  content: string;
  components: ReturnType<typeof makeBootstrapRows>;
} {
  return {
    content: buildMissingGuildActivationText(params),
    components: makeBootstrapRows(!params.isAdmin),
  };
}

export function buildGuildApiKeyWelcomeActions() {
  return makeBootstrapRows(false);
}

export function buildGuildApiKeySetupCardContent(): string {
  return [
    '**Activate Hosted Sage For This Server**',
    '',
    'Hosted Sage is chat-first. Use the controls below to get a Pollinations key, submit it securely, check status, or clear it.',
  ].join('\n');
}

function buildKeyStatusText(
  status: Awaited<ReturnType<typeof getGuildApiKeyStatus>>,
): string {
  if (!status.configured) {
    return `ℹ️ **No server key set.** ${buildGuildApiKeySetupGuidance()}`;
  }

  if (status.verification.ok) {
    return [
      '✅ **Active (Server-wide)**',
      `- **Key**: ${status.maskedKey}`,
      `- **Account**: ${status.verification.account}`,
      `- **Balance**: ${status.verification.balance}`,
    ].join('\n');
  }

  return [
    '⚠️ **Active (Unverified)**',
    `- **Key**: ${status.maskedKey}`,
    '- **Status**: Key saved, but verification failed.',
    `- **Reason**: ${status.verification.reason}`,
  ].join('\n');
}

function isBootstrapButtonId(value: string): value is BootstrapButtonId {
  return (
    value === GUILD_API_KEY_SET_CUSTOM_ID ||
    value === GUILD_API_KEY_CHECK_CUSTOM_ID ||
    value === GUILD_API_KEY_CLEAR_CUSTOM_ID
  );
}

export async function handleGuildApiKeyBootstrapButtonInteraction(
  interaction: ButtonInteraction,
): Promise<boolean> {
  if (!isBootstrapButtonId(interaction.customId)) {
    return false;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Server key setup is guild-only.', ephemeral: true });
    return true;
  }

  if (!isAdminInteraction(interaction)) {
    await interaction.reply({ content: '❌ Only server admins can manage the server key.', ephemeral: true });
    return true;
  }

  if (interaction.customId === GUILD_API_KEY_SET_CUSTOM_ID) {
    await interaction.showModal(buildGuildApiKeyModal());
    return true;
  }

  if (!interaction.guildId) {
    await interaction.reply({ content: 'This action requires a guild context.', ephemeral: true });
    return true;
  }

  if (interaction.customId === GUILD_API_KEY_CHECK_CUSTOM_ID) {
    await interaction.deferReply({ ephemeral: true });
    const status = await getGuildApiKeyStatus(interaction.guildId);
    await interaction.editReply(buildKeyStatusText(status));
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  await clearGuildApiKey(interaction.guildId);
  await interaction.editReply(
    'Hosted Sage was deactivated for this server. Next: use Get Pollinations Key and Set Server Key to activate it again.',
  );
  return true;
}

export async function handleGuildApiKeyBootstrapModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  if (interaction.customId !== GUILD_API_KEY_SET_MODAL_CUSTOM_ID) {
    return false;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Server key setup is guild-only.', ephemeral: true });
    return true;
  }

  if (!isAdminInteraction(interaction)) {
    await interaction.reply({ content: '❌ Only server admins can set the server key.', ephemeral: true });
    return true;
  }

  if (!interaction.guildId) {
    await interaction.reply({ content: 'This action requires a guild context.', ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  const rawApiKey = interaction.fields.getTextInputValue(GUILD_API_KEY_MODAL_FIELD_ID);
  const result = await saveVerifiedGuildApiKey({
    guildId: interaction.guildId,
    rawApiKey,
  });

  if (!result.ok) {
    if (result.reason === 'invalid_format') {
      await interaction.editReply(
        'That key format does not look right. Why: Pollinations keys should start with `sk_`. Next: copy the full key again and retry.',
      );
      return true;
    }
    await interaction.editReply(getKeySetVerificationFailureMessage(result.reason));
    return true;
  }

  const balanceInfo = result.balanceText ? ` (Balance: ${result.balanceText})` : '';
  await interaction.editReply(
    `Hosted Sage is active for this server.\nAccount: ${result.accountLabel}${balanceInfo}\nNext: talk to Sage normally with a mention, reply, or a message that starts with \`Sage\`.`,
  );
  return true;
}

export function buildGuildApiKeyLoginMessage(): string {
  return buildGuildApiKeyLoginInstructions().join('\n');
}
