import { Events, Interaction, ChatInputCommandInteraction } from 'discord.js';
import pkg from '../../../package.json';
import { client } from '../client';
import { logger } from '../../utils/logger';
import { getLLMClient } from '../../core/llm';
import { config } from '../../core/config/env';
import { config as appConfig } from '../../config';

const registrationKey = Symbol.for('sage.handlers.interactionCreate.registered');

/**
 * Check if a user is an admin based on config.
 */
function isAdmin(interaction: ChatInputCommandInteraction): boolean {
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

export function registerInteractionCreateHandler() {
  const g = globalThis as any;
  if (g[registrationKey]) {
    return;
  }
  g[registrationKey] = true;

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === 'ping') {
        await interaction.reply('Pong!');
        return;
      }

      if (interaction.commandName === 'llm_ping') {
        await interaction.deferReply({ ephemeral: true });
        const start = Date.now();

        try {
          const llm = getLLMClient();
          const response = await llm.chat({
            messages: [{ role: 'user', content: 'Say OK' }],
            maxTokens: 5,
            temperature: 0.1,
          });
          const duration = Date.now() - start;
          await interaction.editReply(
            `✅ **LLM Connection Established!**\\n` +
            `**Response**: "${response.content.trim()}"\\n` +
            `**Latency**: ${duration}ms\\n` +
            `**Provider**: ${config.llmProvider}`,
          );
        } catch (e: any) {
          await interaction.editReply(
            `❌ **LLM Connection Failed**.\\n` +
            `**Error**: ${e.message}\\n` +
            `**Status**: Check server logs for details.`,
          );
        }
        return;
      }

      if (interaction.commandName === 'models') {
        await handleModels(interaction);
        return;
      }

      if (interaction.commandName === 'setmodel') {
        await handleSetModel(interaction);
        return;
      }

      if (interaction.commandName === 'resetmodel') {
        await handleResetModel(interaction);
        return;
      }

      if (interaction.commandName === 'refreshmodels') {
        await handleRefreshModels(interaction);
        return;
      }

      if (interaction.commandName === 'sage') {
        const subcommandGroup = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();

        // Route to handlers
        if (subcommandGroup === null && subcommand === 'whoiswho') {
          await handleWhoiswho(interaction);
          return;
        }

        if (subcommandGroup === 'relationship' && subcommand === 'set') {
          await handleRelationshipSet(interaction);
          return;
        }

        if (subcommandGroup === 'admin' && subcommand === 'stats') {
          await handleAdminStats(interaction);
          return;
        }

        if (subcommandGroup === 'admin' && subcommand === 'relationship_graph') {
          await handleAdminRelationshipGraph(interaction);
          return;
        }

        if (subcommandGroup === 'admin' && subcommand === 'trace') {
          await handleAdminTrace(interaction);
          return;
        }

        if (subcommandGroup === 'admin' && subcommand === 'summarize') {
          await handleAdminSummarize(interaction);
          return;
        }

        await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
        return;
      }
    } catch (err) {
      logger.error({ err }, 'Interaction handler error');
      if (interaction.isRepliable()) {
        const reply = { content: 'Something went wrong.', ephemeral: true };
        if (interaction.deferred) await interaction.editReply(reply);
        else await interaction.reply(reply);
      }
    }
  });

  logger.info(
    { count: client.listenerCount(Events.InteractionCreate) },
    'InteractionCreate handler registered',
  );
}

// ===== Command Handlers =====

async function handleWhoiswho(interaction: ChatInputCommandInteraction) {
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

    await interaction.editReply(lines.join('\\n'));
  } catch (error) {
    logger.error({ error, guildId }, 'handleWhoiswho error');
    await interaction.editReply('Failed to retrieve relationship data.');
  }
}

async function handleRelationshipSet(interaction: ChatInputCommandInteraction) {
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

async function handleAdminStats(interaction: ChatInputCommandInteraction) {
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

async function handleAdminRelationshipGraph(interaction: ChatInputCommandInteraction) {
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

    await interaction.editReply(lines.join('\\n'));
  } catch (error) {
    logger.error({ error, guildId }, 'handleAdminRelationshipGraph error');
    await interaction.editReply('Failed to retrieve relationship graph.');
  }
}

async function handleAdminTrace(interaction: ChatInputCommandInteraction) {
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

async function handleAdminSummarize(interaction: ChatInputCommandInteraction) {
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

async function handleModels(interaction: ChatInputCommandInteraction) {
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
    ];

    for (const entry of entries) {
      const visionCapable =
        entry.caps.vision === true ||
        entry.inputModalities?.map((item) => item.toLowerCase()).includes('image');
      lines.push(`- ${entry.id}${visionCapable ? ' (vision)' : ''}`);
    }

    lines.push(
      '',
      'Note: If an image is sent and your selected model lacks vision, Sage will auto-fallback to default for that message.',
    );

    await interaction.editReply(lines.join('\n'));
  } catch (error) {
    logger.error({ error, guildId }, 'handleModels error');
    await interaction.editReply('Failed to load model catalog.');
  }
}

async function handleSetModel(interaction: ChatInputCommandInteraction) {
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

  const modelId = interaction.options.getString('model_id', true);
  const normalized = modelId.trim().toLowerCase();

  await interaction.deferReply({ ephemeral: true });

  try {
    const { loadModelCatalog } = await import('../../core/llm/modelCatalog');
    const { setGuildModel } = await import('../../core/settings/guildModelSettings');

    const catalog = await loadModelCatalog();
    if (!catalog[normalized]) {
      await interaction.editReply(
        `❌ Unknown model: ${modelId}. Use /models to view available options.`,
      );
      return;
    }

    await setGuildModel(guildId, normalized);
    await interaction.editReply(`✅ Set guild model to **${normalized}**.`);
  } catch (error) {
    logger.error({ error, guildId }, 'handleSetModel error');
    await interaction.editReply('Failed to set guild model.');
  }
}

async function handleResetModel(interaction: ChatInputCommandInteraction) {
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

async function handleRefreshModels(interaction: ChatInputCommandInteraction) {
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
