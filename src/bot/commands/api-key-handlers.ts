import { ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../core/utils/logger';
import { isAdmin } from '../handlers/sage-command-handlers';
import { getGuildApiKey, upsertGuildApiKey } from '../../core/settings/guildSettingsRepo';

interface PollinationsProfile {
  id?: string;
  username?: string;
  credits?: number;
}

/**
 * Validate a Pollinations API key by requesting the authenticated profile.
 */
async function fetchPollinationsProfile(apiKey: string): Promise<PollinationsProfile | null> {
  try {
    const res = await fetch('https://gen.pollinations.ai/account/profile', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as PollinationsProfile;
  } catch (e) {
    logger.warn({ error: e }, 'Failed to fetch Pollinations profile');
    return null;
  }
}

export async function handleKeyLogin(interaction: ChatInputCommandInteraction) {
  const authUrl = `https://enter.pollinations.ai/authorize?redirect_url=https://pollinations.ai/&permissions=profile,balance,usage`;

  const lines = [
    '**Bring Your Own Pollen (BYOP)**',
    '',
    'To use your own credits (unlimited/free usage):',
    '',
    `1. [**Click here to Login**](${authUrl})`,
    '2. After logging in, you will be redirected to the Pollinations homepage.',
    '3. Look at your **browser address bar**. It will look like: "https://pollinations.ai/#api_key=sk_..."',
    '4. Copy the text after "#api_key=" (the part starting with "sk_").',
    '5. Return to Discord and run: `/sage key set <your_key>`',
  ];

  await interaction.reply({
    content: lines.join('\n'),
    ephemeral: true
  });
}

export async function handleKeySet(interaction: ChatInputCommandInteraction) {
  const apiKey = interaction.options.getString('api_key', true);
  const guildId = interaction.guildId;

  if (!apiKey.startsWith('sk_')) {
    await interaction.reply({ content: '⚠️ Invalid key format. It should start with `sk_`.', ephemeral: true });
    return;
  }

  if (!guildId) {
    await interaction.reply({ content: '❌ Keys can only be set inside a server.', ephemeral: true });
    return;
  }

  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Only server admins can set the API key.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const profile = await fetchPollinationsProfile(apiKey);
  if (!profile) {
    await interaction.editReply('❌ **Invalid API Key.** Could not verify this key with Pollinations. Please try logging in again.');
    return;
  }

  try {
    await upsertGuildApiKey(guildId, apiKey);
    const balanceInfo = profile.credits != null ? ` (Balance: ${profile.credits} pollen)` : '';
    await interaction.editReply(
      `✅ **Server-wide API Key saved!**\n` +
      `User: ${profile.username || 'Unknown'}${balanceInfo}\n` +
      'Sage will now use this key for **all members** in this server.',
    );
  } catch (error) {
    logger.error({ error, guildId }, 'Failed to set API key');
    await interaction.editReply('❌ Failed to save API key (Database error).');
  }
}

export async function handleKeyCheck(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({ content: '❌ Keys can only be checked inside a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const apiKey = (await getGuildApiKey(guildId)) || null;

    if (apiKey) {
      const masked = apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : 'sk_...';

      const liveProfile = await fetchPollinationsProfile(apiKey);

      if (liveProfile) {
        const balance = liveProfile.credits ?? 'Unknown';
        await interaction.editReply(
          `✅ **Active (Server-wide)**\n` +
          `- **Key**: ${masked}\n` +
          `- **Account**: ${liveProfile.username || 'Unknown'}\n` +
          `- **Balance**: ${balance} pollen`,
        );
      } else {
        await interaction.editReply(
          `⚠️ **Active (Unverified)**\n` +
          `- **Key**: ${masked}\n` +
          '- **Status**: Key saved, but could not connect to Pollinations to verify balance.',
        );
      }
    } else {
      await interaction.editReply(`ℹ️ **No server key set.** Sage is running on the bot's shared quota.`);
    }
  } catch (error) {
    logger.error({ error, guildId }, 'Failed to check API key');
    await interaction.editReply('❌ Failed to check status.');
  }
}

export async function handleKeyClear(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({ content: '❌ Keys can only be cleared inside a server.', ephemeral: true });
    return;
  }

  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Only server admins can clear the API key.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    await upsertGuildApiKey(guildId, null);
    await interaction.editReply('🗑️ **Server-wide API Key removed.** Sage will fall back to the bot\'s shared quota.');
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2025') {
      await interaction.editReply('ℹ️ You didn\'t have a key set.');
    } else {
      logger.error({ error, guildId }, 'Failed to clear API key');
      await interaction.editReply('❌ Failed to clear key.');
    }
  }
}
