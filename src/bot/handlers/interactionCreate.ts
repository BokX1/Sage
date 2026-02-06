import { Events, Interaction } from 'discord.js';
import { client } from '../client';
import { logger } from '../../core/utils/logger';
import { getLLMClient } from '../../core/llm';
import { config } from '../../core/config/legacy-config-adapter';
import {
  handleAdminRelationshipGraph,
  handleAdminStats,
  handleAdminSummarize,
  handleAdminTrace,
  handleRelationshipSet,
  isAdmin,
  handleWhoiswho,
} from './sage-command-handlers';
import { handleKeyCheck, handleKeyClear, handleKeyLogin, handleKeySet } from '../commands/api-key-handlers';
import { handleJoinCommand, handleLeaveCommand } from '../commands/voice-channel-handlers';


const registrationKey = Symbol.for('sage.handlers.interactionCreate.registered');

/**
 * Registers a single interaction handler instance for slash command routing.
 */
export function registerInteractionCreateHandler() {
  const g = globalThis as unknown as { [key: symbol]: boolean };
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

      if (interaction.commandName === 'join') {
        await handleJoinCommand(interaction);
        return;
      }

      if (interaction.commandName === 'leave') {
        await handleLeaveCommand(interaction);
        return;
      }

      if (interaction.commandName === 'llm_ping') {
        if (!isAdmin(interaction)) {
          await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
          return;
        }

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
            `✅ **LLM Connection Established!**\n` +
            `**Response**: "${response.content.trim()}"\n` +
            `**Latency**: ${duration}ms\n` +
            `**Provider**: ${config.llmProvider}`,
          );
        } catch (e) {
          logger.warn({ err: e }, 'LLM ping failed');
          await interaction.editReply(
            `❌ **LLM Connection Failed**.\n` +
            `**Status**: Check server logs for details.`,
          );
        }
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

        if (subcommandGroup === 'key') {
          if (subcommand === 'login') {
            await handleKeyLogin(interaction);
            return;
          }
          if (subcommand === 'set') {
            await handleKeySet(interaction);
            return;
          }
          if (subcommand === 'check') {
            await handleKeyCheck(interaction);
            return;
          }
          if (subcommand === 'clear') {
            await handleKeyClear(interaction);
            return;
          }
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
        if (interaction.deferred || interaction.replied) await interaction.editReply(reply);
        else await interaction.reply(reply);
      }
    }
  });

  logger.info(
    { count: client.listenerCount(Events.InteractionCreate) },
    'InteractionCreate handler registered',
  );
}
