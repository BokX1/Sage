import { ChatInputCommandInteraction } from 'discord.js';
import pkg from '../../../package.json';
import { logger } from '../../utils/logger';
import { config as appConfig } from '../../config';

/**
 * Check if a user is an admin based on config.
 */
export function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  const adminRoleIds = appConfig.ADMIN_ROLE_IDS.split(',').filter(Boolean);
  const adminUserIds = appConfig.ADMIN_USER_IDS.split(',').filter(Boolean);

  // If no admins configured, deny all admin commands
  if (adminRoleIds.length === 0 && adminUserIds.length === 0) {
    return false;
  }

  // Check user ID
  if (adminUserIds.includes(interaction.user.id)) return true;

  // Check roles (if in guild)
  const member = interaction.member;
  if (member && 'roles' in member) {
    const memberRoles = Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()];
    return adminRoleIds.some((r) => memberRoles.includes(r));
  }

  return false;
}

export async function handleWhoiswho(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser('user');
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { getEdgesForUser } = await import('../../core/relationships/relationshipGraph');
    const userId = targetUser?.id ?? interaction.user.id;
    const edges = await getEdgesForUser({ guildId, userId, limit: 10 });

    if (edges.length === 0) {
      await interaction.editReply(`No relationship data found for <@${userId}>.`);
      return;
    }

    const lines = [`**Relationships for <@${userId}>** (probabilistic):`];
    for (const edge of edges) {
      const otherId = edge.userA === userId ? edge.userB : edge.userA;
      const f = edge.featuresJson;
      const evidenceParts: string[] = [];
      if (f.mentions.count > 0) evidenceParts.push(`${f.mentions.count}m`);
      if (f.replies.count > 0) evidenceParts.push(`${f.replies.count}r`);
      if (f.voice.overlapMs > 0) {
        const mins = Math.round(f.voice.overlapMs / 60000);
        if (mins > 0) evidenceParts.push(`${mins}min voice`);
      }
      const evidence = evidenceParts.join(', ') || 'no activity';
      lines.push(`- <@${otherId}>: ${(edge.weight * 100).toFixed(0)}% (${evidence})`);
    }

    await interaction.editReply(lines.join('\n'));
  } catch (error) {
    logger.error({ error, guildId }, 'handleWhoiswho error');
    await interaction.editReply('Failed to retrieve relationship data.');
  }
}

export async function handleRelationshipSet(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const userA = interaction.options.getUser('user_a', true);
  const userB = interaction.options.getUser('user_b', true);
  const level = interaction.options.getNumber('level', true);
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { setManualRelationship } = await import('../../core/relationships/relationshipGraph');
    const { logAdminAction, computeParamsHash } =
      await import('../../core/relationships/adminAuditRepo');

    await setManualRelationship({
      guildId,
      user1: userA.id,
      user2: userB.id,
      level0to1: level,
      adminId: interaction.user.id,
    });

    await logAdminAction({
      guildId,
      adminId: interaction.user.id,
      command: 'sage_relationship_set',
      paramsHash: computeParamsHash({ userA: userA.id, userB: userB.id, level }),
    });

    await interaction.editReply(
      `✅ Set relationship level between <@${userA.id}> and <@${userB.id}> to ${(level * 100).toFixed(0)}%.`,
    );
  } catch (error) {
    logger.error({ error, guildId }, 'handleRelationshipSet error');
    await interaction.editReply('Failed to set relationship level.');
  }
}

export async function handleAdminStats(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { logAdminAction, computeParamsHash } =
      await import('../../core/relationships/adminAuditRepo');
    const { getTopEdges } = await import('../../core/relationships/relationshipGraph');

    const edges = await getTopEdges({ guildId, limit: 1000 });
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
      `- **Environment**: ${process.env.NODE_ENV}`,
      `- **Version**: ${pkg.version}`,
    ];

    await interaction.editReply(stats.join('\n'));
  } catch (error) {
    logger.error({ error, guildId }, 'handleAdminStats error');
    await interaction.editReply('Failed to retrieve statistics.');
  }
}

export async function handleAdminRelationshipGraph(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const targetUser = interaction.options.getUser('user');
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { logAdminAction, computeParamsHash } =
      await import('../../core/relationships/adminAuditRepo');
    const { getTopEdges, getEdgesForUser } =
      await import('../../core/relationships/relationshipGraph');

    const edges = targetUser
      ? await getEdgesForUser({ guildId, userId: targetUser.id, limit: 15 })
      : await getTopEdges({ guildId, limit: 15 });

    await logAdminAction({
      guildId,
      adminId: interaction.user.id,
      command: 'sage_admin_relationship_graph',
      paramsHash: computeParamsHash({ guildId, userId: targetUser?.id }),
    });

    if (edges.length === 0) {
      await interaction.editReply('No relationship edges found.');
      return;
    }

    const lines = [
      targetUser
        ? `**Relationship graph for <@${targetUser.id}>** (admin view):`
        : '**Top relationship edges** (admin view):',
    ];

    for (const edge of edges) {
      const f = edge.featuresJson;
      const evidenceParts: string[] = [];
      if (f.mentions.count > 0) evidenceParts.push(`${f.mentions.count} mentions`);
      if (f.replies.count > 0) evidenceParts.push(`${f.replies.count} replies`);
      if (f.voice.overlapMs > 0) {
        const mins = Math.round(f.voice.overlapMs / 60000);
        if (mins > 0) evidenceParts.push(`${mins}m voice`);
      }
      const evidence = evidenceParts.join(', ') || 'no activity';
      const override = edge.manualOverride !== null ? ' [manual]' : '';
      lines.push(
        `- <@${edge.userA}> ↔ <@${edge.userB}>: ${(edge.weight * 100).toFixed(0)}% (${evidence})${override}`,
      );
    }

    await interaction.editReply(lines.join('\n'));
  } catch (error) {
    logger.error({ error, guildId }, 'handleAdminRelationshipGraph error');
    await interaction.editReply('Failed to retrieve relationship graph.');
  }
}

export async function handleAdminTrace(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const traceId = interaction.options.getString('trace_id');
  const limit = interaction.options.getInteger('limit') ?? 5;
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { getTraceById, listRecentTraces } = await import('../../core/trace/agentTraceRepo');
    const { logAdminAction, computeParamsHash } =
      await import('../../core/relationships/adminAuditRepo');

    if (traceId) {
      // Show single trace
      const trace = await getTraceById(traceId);

      if (!trace) {
        await interaction.editReply(`No trace found with ID: ${traceId}`);
        return;
      }

      const router = trace.routerJson as any;
      const _experts = trace.expertsJson as any;

      const lines = [
        `**Trace: \`${trace.id}\`**`,
        `**Route**: ${trace.routeKind}`,
        `**Temp**: ${router.temperature ?? 'N/A'}`,
        `**Experts**: ${router.experts?.join(', ') ?? 'none'}`,
        `**Created**: ${trace.createdAt.toISOString()}`,
      ];

      await logAdminAction({
        guildId,
        adminId: interaction.user.id,
        command: 'sage_admin_trace',
        paramsHash: computeParamsHash({ traceId }),
      });

      await interaction.editReply(lines.join('\n'));
    } else {
      // Show recent traces
      const traces = await listRecentTraces({ guildId, limit });

      if (traces.length === 0) {
        await interaction.editReply('No traces found for this guild.');
        return;
      }

      const lines = [`**Recent Traces (last ${limit})**:`];
      for (const trace of traces) {
        const _router = trace.routerJson as any;
        lines.push(
          `- \`${trace.id.slice(0, 8)}...\`: ${trace.routeKind} (${new Date(trace.createdAt).toLocaleString()})`,
        );
      }

      await logAdminAction({
        guildId,
        adminId: interaction.user.id,
        command: 'sage_admin_trace',
        paramsHash: computeParamsHash({ guildId, limit }),
      });

      await interaction.editReply(lines.join('\n'));
    }
  } catch (error) {
    logger.error({ error, guildId }, 'handleAdminTrace error');
    await interaction.editReply('Failed to retrieve trace data.');
  }
}

export async function handleAdminSummarize(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }

  const targetChannel = interaction.options.getChannel('channel') ?? interaction.channel;
  if (!targetChannel) {
    await interaction.reply({ content: 'Could not determine channel.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { getChannelSummaryScheduler } =
      await import('../../core/summary/channelSummaryScheduler');
    const scheduler = getChannelSummaryScheduler();

    if (!scheduler) {
      await interaction.editReply('❌ Scheduler is not running.');
      return;
    }

    // Use 24-hour lookback (1440 minutes) for forced admin summaries to ensure data is found
    const summary = await scheduler.forceSummarize(guildId, targetChannel.id, 1440);

    if (!summary) {
      await interaction.editReply(
        `⚠️ No summary generated for <#${targetChannel.id}>. (Logging might be disabled or no sufficient messages)`,
      );
      return;
    }

    await interaction.editReply(
      `✅ **Summary generated for <#${targetChannel.id}>**\n` +
      `**Window**: ${summary.windowStart.toLocaleString()} - ${summary.windowEnd.toLocaleString()}\n` +
      `**Summary**: ${summary.summaryText}`,
    );
  } catch (error) {
    logger.error({ error, guildId, channelId: targetChannel.id }, 'handleAdminSummarize error');
    await interaction.editReply('❌ Failed to generate summary.');
  }
}

export async function handleModels(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { loadModelCatalog, getDefaultModelId, getModelCatalogState } = await import(
      '../../core/llm/modelCatalog'
    );
    const { getGuildModel } = await import('../../core/settings/guildModelSettings');

    const [catalog, preferred] = await Promise.all([loadModelCatalog(), getGuildModel(guildId)]);
    const defaultModel = getDefaultModelId();
    const state = getModelCatalogState();

    const entries = Object.values(catalog).sort((a, b) => a.id.localeCompare(b.id));

    const lines = [
      `**Default model**: ${defaultModel}`,
      `**Guild preference**: ${preferred ?? 'default'}`,
      `**Catalog source**: ${state.source}`,
      '**Models**:',
      ...entries.map((entry) => formatModelLine(entry)),
      '',
      'Use `/model select <name>` (or `/setmodel <name>`) to change the guild model.',
      'This selection only affects chat responses; summaries and profile models are configured separately.',
      'Note: If an image is sent and your selected model lacks vision, Sage will auto-fallback to default for that message.',
    ];

    await interaction.editReply(lines.join('\n'));
  } catch (error) {
    logger.error({ error, guildId }, 'handleModels error');
    await interaction.editReply('Failed to load model catalog.');
  }
}

export async function handleSetModel(interaction: ChatInputCommandInteraction) {
  return handleSelectModel(interaction, 'model_id');
}

export async function handleModelSelect(interaction: ChatInputCommandInteraction) {
  return handleSelectModel(interaction, 'model');
}

async function handleSelectModel(
  interaction: ChatInputCommandInteraction,
  optionName: string,
) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }

  const modelId = interaction.options.getString(optionName, true);
  const normalized = modelId.trim().toLowerCase();

  await interaction.deferReply({ ephemeral: true });

  try {
    const { findModelInCatalog, suggestModelIds } = await import('../../core/llm/modelCatalog');
    const { setGuildModel } = await import('../../core/settings/guildModelSettings');

    const { model, catalog, refreshed } = await findModelInCatalog(normalized, {
      refreshIfMissing: true,
    });

    if (!model) {
      const suggestions = suggestModelIds(normalized, catalog);
      const suggestionText =
        suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
      await interaction.editReply(
        `❌ Unknown model: ${modelId}.${suggestionText} Use /model list to view available options.`,
      );
      return;
    }

    await setGuildModel(guildId, model.id);
    const refreshedNote = refreshed ? ' (catalog refreshed)' : '';
    await interaction.editReply(`✅ Set guild model to **${model.id}**.${refreshedNote}`);
  } catch (error) {
    logger.error({ error, guildId }, 'handleSelectModel error');
    await interaction.editReply('Failed to set guild model.');
  }
}

export async function handleResetModel(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { clearGuildModel } = await import('../../core/settings/guildModelSettings');
    const { getDefaultModelId } = await import('../../core/llm/modelCatalog');

    await clearGuildModel(guildId);
    await interaction.editReply(
      `✅ Cleared guild model preference. Default (${getDefaultModelId()}) will be used.`,
    );
  } catch (error) {
    logger.error({ error, guildId }, 'handleResetModel error');
    await interaction.editReply('Failed to reset guild model.');
  }
}

function formatModelLine(entry: {
  id: string;
  displayName?: string;
  caps: { vision?: boolean; tools?: boolean; search?: boolean; audioIn?: boolean; audioOut?: boolean };
  inputModalities?: string[];
  raw?: unknown;
}): string {
  const provider = 'pollinations';
  const display = entry.displayName ? ` — ${entry.displayName}` : '';
  const description =
    typeof (entry.raw as { description?: unknown })?.description === 'string'
      ? ` (${(entry.raw as { description: string }).description})`
      : '';
  const availability = formatAvailability(entry);
  return `- ${entry.id} [${provider}]${display}${description}${availability ? ` — ${availability}` : ''}`;
}

function formatAvailability(entry: {
  caps: { vision?: boolean; tools?: boolean; search?: boolean; audioIn?: boolean; audioOut?: boolean };
  inputModalities?: string[];
}): string {
  const capabilities: string[] = [];
  const hasVision =
    entry.caps.vision === true ||
    entry.inputModalities?.map((item) => item.toLowerCase()).includes('image');
  if (hasVision) capabilities.push('vision');
  if (entry.caps.tools) capabilities.push('tools');
  if (entry.caps.search) capabilities.push('search');
  if (entry.caps.audioIn) capabilities.push('audio-in');
  if (entry.caps.audioOut) capabilities.push('audio-out');

  return capabilities.length > 0 ? capabilities.join(', ') : 'standard';
}

export async function handleRefreshModels(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { refreshModelCatalog, getModelCatalogState } = await import(
      '../../core/llm/modelCatalog'
    );
    const catalog = await refreshModelCatalog();
    const state = getModelCatalogState();

    await interaction.editReply(
      `✅ Model catalog refreshed (${Object.keys(catalog).length} models, source: ${state.source}).`,
    );
  } catch (error) {
    logger.error({ error, guildId }, 'handleRefreshModels error');
    await interaction.editReply('Failed to refresh model catalog.');
  }
}
