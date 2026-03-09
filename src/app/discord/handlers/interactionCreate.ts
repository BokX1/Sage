import { Events, Interaction } from 'discord.js';
import { client } from '../../../platform/discord/client';
import { logger } from '../../../platform/logging/logger';
import {
  handleAdminActionButtonInteraction,
  handleAdminActionRejectModalSubmit,
} from '../../../features/admin/adminActionService';
import {
  handleGuildApiKeyBootstrapButtonInteraction,
  handleGuildApiKeyBootstrapModalSubmit,
} from '../../../features/discord/byopBootstrap';
import {
  handleInteractiveButtonSession,
  handleInteractiveModalSession,
  sendCommandlessNotice,
} from './interactiveSage';

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
 * Registers a single interaction handler instance for Sage-authored component and modal flows.
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
        const handled =
          (await handleAdminActionButtonInteraction(interaction)) ||
          (await handleGuildApiKeyBootstrapButtonInteraction(interaction)) ||
          (await handleInteractiveButtonSession(interaction));
        if (handled) {
          return;
        }
      }

      if (
        'isModalSubmit' in interaction &&
        typeof interaction.isModalSubmit === 'function' &&
        interaction.isModalSubmit()
      ) {
        const handled =
          (await handleAdminActionRejectModalSubmit(interaction)) ||
          (await handleGuildApiKeyBootstrapModalSubmit(interaction)) ||
          (await handleInteractiveModalSession(interaction));
        if (handled) {
          return;
        }
      }

      if (!interaction.isChatInputCommand()) {
        return;
      }

      await sendCommandlessNotice(interaction);
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
