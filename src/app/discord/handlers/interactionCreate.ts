import { Events, Interaction, type InteractionEditReplyOptions, type InteractionReplyOptions } from 'discord.js';
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
} from './interactiveSage';
import { buildInteractionFailureText } from '../../../features/discord/userFacingCopy';
import { buildRuntimeResponseCardPayload } from '../../../features/discord/runtimeResponseCards';

const registrationKey = Symbol.for('sage.handlers.interactionCreate.registered');

async function sendInteractionReply(
  interaction: Interaction,
  payload: InteractionReplyOptions | InteractionEditReplyOptions,
): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }

  const normalizedPayload =
    'components' in payload && payload.components
      ? ({
          ...payload,
          withComponents: true,
        } as InteractionReplyOptions | InteractionEditReplyOptions)
      : payload;

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(normalizedPayload as InteractionEditReplyOptions);
    return;
  }

  await interaction.reply(normalizedPayload as InteractionReplyOptions);
}

async function sendInteractionFailure(interaction: Interaction): Promise<void> {
  try {
    await sendInteractionReply(
      interaction,
      buildRuntimeResponseCardPayload({
        text: buildInteractionFailureText(),
        tone: 'error',
        ephemeral: true,
      }) as InteractionReplyOptions,
    );
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
