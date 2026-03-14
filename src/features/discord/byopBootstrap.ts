import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  ButtonStyle as ApiButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIButtonComponentWithCustomId,
  type APIButtonComponentWithURL,
  type APIContainerComponent,
  type APIMessageTopLevelComponent,
  type APISeparatorComponent,
  SeparatorSpacingSize,
  type APITextDisplayComponent,
} from 'discord-api-types/payloads/v10';
import {
  POLLINATIONS_AUTHORIZE_URL,
  buildGuildApiKeySetupGuidance,
  clearGuildApiKey,
  getGuildApiKeyStatus,
  getKeySetVerificationFailureMessage,
  saveVerifiedGuildApiKey,
} from '../settings/guildApiKeyService';
import { isAdminInteraction } from '../../platform/discord/admin-permissions';

const GUILD_API_KEY_SET_CUSTOM_ID = 'sage:bootstrap:key:set';
const GUILD_API_KEY_CHECK_CUSTOM_ID = 'sage:bootstrap:key:check';
const GUILD_API_KEY_CLEAR_CUSTOM_ID = 'sage:bootstrap:key:clear';
const GUILD_API_KEY_SET_MODAL_CUSTOM_ID = 'sage:bootstrap:key:set_modal';
const GUILD_API_KEY_MODAL_FIELD_ID = 'guild_api_key';

type BootstrapButtonId =
  | typeof GUILD_API_KEY_SET_CUSTOM_ID
  | typeof GUILD_API_KEY_CHECK_CUSTOM_ID
  | typeof GUILD_API_KEY_CLEAR_CUSTOM_ID;

type GuildApiKeySetupCardPayload = {
  flags: MessageFlags.IsComponentsV2;
  components: APIMessageTopLevelComponent[];
};

function textBlock(content: string): APITextDisplayComponent {
  return {
    type: ComponentType.TextDisplay,
    content,
  };
}

function separator(): APISeparatorComponent {
  return {
    type: ComponentType.Separator,
    divider: true,
    spacing: SeparatorSpacingSize.Small,
  };
}

function linkButton(params: {
  label: string;
  url: string;
}): APIButtonComponentWithURL {
  return {
    type: ComponentType.Button,
    label: params.label,
    style: ApiButtonStyle.Link,
    url: params.url,
  };
}

function actionButton(params: {
  label: string;
  style: ApiButtonStyle.Primary | ApiButtonStyle.Secondary | ApiButtonStyle.Danger;
  customId: string;
  disabled?: boolean;
}): APIButtonComponentWithCustomId {
  return {
    type: ComponentType.Button,
    label: params.label,
    style: params.style,
    custom_id: params.customId,
    ...(params.disabled ? { disabled: true } : {}),
  };
}

function buildBootstrapActionRow(disableAdminActions: boolean): APIActionRowComponent<APIButtonComponent> {
  return {
    type: ComponentType.ActionRow,
    components: [
      linkButton({
        label: 'Get Pollinations Key',
        url: POLLINATIONS_AUTHORIZE_URL,
      }),
      actionButton({
        label: 'Set Server Key',
        style: ApiButtonStyle.Primary,
        customId: GUILD_API_KEY_SET_CUSTOM_ID,
        disabled: disableAdminActions,
      }),
      actionButton({
        label: 'Check Key',
        style: ApiButtonStyle.Secondary,
        customId: GUILD_API_KEY_CHECK_CUSTOM_ID,
        disabled: disableAdminActions,
      }),
      actionButton({
        label: 'Clear Key',
        style: ApiButtonStyle.Danger,
        customId: GUILD_API_KEY_CLEAR_CUSTOM_ID,
        disabled: disableAdminActions,
      }),
    ],
  };
}

function buildCardPayload(params: {
  accentColor: number;
  blocks: APIContainerComponent['components'];
}): GuildApiKeySetupCardPayload {
  const container: APIContainerComponent = {
    type: ComponentType.Container,
    accent_color: params.accentColor,
    components: params.blocks,
  };

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

function buildGuildApiKeySetupCardPayload(params: {
  isAdmin: boolean;
  variant: 'missing' | 'setup';
}): GuildApiKeySetupCardPayload {
  const heading =
    params.variant === 'setup'
      ? '**Activate Hosted Sage For This Server**'
      : params.isAdmin
        ? '**Hosted Sage Needs A Server Key**'
        : '**Hosted Sage Is Waiting For Server Activation**';
  const summary =
    params.variant === 'setup'
      ? 'Hosted Sage is chat-first. Use the controls below to connect a Pollinations server key for this guild.'
      : params.isAdmin
        ? 'Hosted Sage is not active here yet because no server key is saved for this guild.'
        : 'Hosted Sage cannot answer here yet because this guild does not have a server key saved.';
  const nextSteps = params.isAdmin
    ? [
        'Next:',
        '- Use **Get Pollinations Key** to open Pollinations.',
        '- Use **Set Server Key** to save the key securely for this server.',
        '- Use **Check Key** any time to confirm the current server status.',
      ].join('\n')
    : [
        'Next:',
        '- Ask a server admin to use **Get Pollinations Key** and **Set Server Key**.',
        '- You can try Sage again as soon as activation is complete.',
      ].join('\n');

  return buildCardPayload({
    accentColor: params.isAdmin ? 0x4a7c23 : 0x5865f2,
    blocks: [
      textBlock(heading),
      separator(),
      textBlock(summary),
      textBlock(nextSteps),
      separator(),
      buildBootstrapActionRow(!params.isAdmin),
    ],
  });
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
  flags: MessageFlags.IsComponentsV2;
  components: APIMessageTopLevelComponent[];
} {
  return buildGuildApiKeySetupCardPayload({
    isAdmin: params.isAdmin,
    variant: 'missing',
  });
}

export function buildGuildApiKeySetupCardMessage(): GuildApiKeySetupCardPayload {
  return buildGuildApiKeySetupCardPayload({
    isAdmin: true,
    variant: 'setup',
  });
}

export function buildGuildApiKeyWelcomeMessage(): GuildApiKeySetupCardPayload {
  return buildCardPayload({
    accentColor: 0x4a7c23,
    blocks: [
      textBlock('**Welcome To Sage**'),
      separator(),
      textBlock(
        'Sage is a chat-first AI teammate for active Discord communities. I help members and admins research, summarize context, work with files, and keep decisions moving without command menus.',
      ),
      textBlock(
        [
          '**Best For**',
          'Communities that want one assistant for everyday questions, structured updates, lightweight ops help, and approval-gated admin actions.',
        ].join('\n'),
      ),
      textBlock(
        [
          '**Get Live**',
          '- **Hosted Sage**: trigger me once, then let a server admin connect the server key below.',
          '- **Self-hosted Sage**: run `npm run onboard`, invite your own bot, and optionally use a host-level provider key instead.',
        ].join('\n'),
      ),
      textBlock(
        [
          '**How To Talk To Sage**',
          '- Mention me anywhere.',
          '- Reply to one of my messages.',
          '- Start a message with `Sage`.',
        ].join('\n'),
      ),
      separator(),
      buildBootstrapActionRow(false),
    ],
  });
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
