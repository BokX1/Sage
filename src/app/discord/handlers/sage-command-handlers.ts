import { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import pkg from '../../../../package.json';
import { logger } from '../../../platform/logging/logger';
import { config as appConfig } from '../../../platform/config/env';
import { sendCommandReply } from '../utils/interaction-reply';
import { isAdminFromMember } from '../../../platform/discord/admin-permissions';

/**
 * Check if a user is an admin based on Discord permissions.
 */
export function isAdmin(
  interaction: Pick<ChatInputCommandInteraction | ButtonInteraction, 'member' | 'inGuild'>,
): boolean {
  if (!interaction.inGuild()) {
    return false;
  }
  return isAdminFromMember(interaction.member);
}

export async function handleAdminStats(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    await sendCommandReply(interaction, { content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await sendCommandReply(interaction, {
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { logAdminAction, computeParamsHash } =
      await import('../../../features/relationships/adminAuditRepo');
    const { queryTopSocialGraphEdges } = await import('../../../features/social-graph/socialGraphQuery');

    const edges = await queryTopSocialGraphEdges(guildId, 1000);
    const edgeCount = edges.length;

    await logAdminAction({
      guildId,
      adminId: interaction.user.id,
      command: 'sage_admin_stats',
      paramsHash: computeParamsHash({ guildId }),
    });

    const uptime = process.uptime();
    const memUsage = process.memoryUsage();
    const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
    const rssMB = (memUsage.rss / 1024 / 1024).toFixed(2);

    const formatTime = (seconds: number) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      return `${h}h ${m}m ${s}s`;
    };

    const stats = [
      `**Bot Statistics**`,
      `- **Uptime**: ${formatTime(uptime)}`,
      `- **Memory**: ${heapUsedMB} MB Heap / ${rssMB} MB RSS`,
      `- **Relationship Edges**: ${edgeCount}`,
      `- **Environment**: ${appConfig.NODE_ENV}`,
      `- **Version**: ${pkg.version}`,
    ];

    await interaction.editReply(stats.join('\n'));
  } catch (error) {
    logger.error({ error, guildId }, 'handleAdminStats error');
    await interaction.editReply('Failed to retrieve statistics.');
  }
}
