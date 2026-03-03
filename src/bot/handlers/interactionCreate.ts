/**
 * @module src/bot/handlers/interactionCreate
 * @description Defines the interaction create module.
 */
import { Events, Interaction } from 'discord.js';
import { client } from '../client';
import { logger } from '../../core/utils/logger';
import {
  handleAdminStats,
} from './sage-command-handlers';
import { handleKeyCheck, handleKeyClear, handleKeyLogin, handleKeySet } from '../commands/api-key-handlers';
import { handleJoinCommand, handleLeaveCommand } from '../commands/voice-channel-handlers';
import { handleAdminActionButtonInteraction } from '../admin/adminActionService';


const registrationKey = Symbol.for('sage.handlers.interactionCreate.registered');

async function sendInteractionReply(
  interaction: Interaction,
  payload: { content: string; ephemeral: boolean },
): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: payload.content });
    return;
  }

  await interaction.reply(payload);
}

async function sendInteractionFailure(interaction: Interaction): Promise<void> {
  try {
    await sendInteractionReply(interaction, { content: 'Something went wrong.', ephemeral: true });
  } catch (replyError) {
    logger.warn({ error: replyError }, 'Failed to send interaction error response');
  }
}

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
      if ('isButton' in interaction && typeof interaction.isButton === 'function' && interaction.isButton()) {
        const handled = await handleAdminActionButtonInteraction(interaction);
        if (handled) {
          return;
        }
      }

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

      if (interaction.commandName === 'sage') {
        const subcommandGroup = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();

        // Route to handlers
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

        await sendInteractionReply(interaction, { content: 'Unknown subcommand.', ephemeral: true });
        return;
      }

      await sendInteractionReply(interaction, { content: 'Unknown command.', ephemeral: true });
    } catch (err) {
      logger.error({ err }, 'Interaction handler error');
      await sendInteractionFailure(interaction);
    }
  });

  logger.info(
    { count: client.listenerCount(Events.InteractionCreate) },
    'InteractionCreate handler registered',
  );
}
