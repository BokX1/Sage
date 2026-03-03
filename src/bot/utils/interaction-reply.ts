/**
 * @module src/bot/utils/interaction-reply
 * @description Defines the interaction reply module.
 */
import type { ChatInputCommandInteraction } from 'discord.js';

interface CommandReplyPayload {
  content: string;
  ephemeral?: boolean;
}

/**
 * Runs sendCommandReply.
 *
 * @param interaction - Describes the interaction input.
 * @param payload - Describes the payload input.
 * @returns Returns the function result.
 */
export async function sendCommandReply(
  interaction: ChatInputCommandInteraction,
  payload: CommandReplyPayload,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: payload.content });
    return;
  }

  await interaction.reply({
    content: payload.content,
    ephemeral: payload.ephemeral ?? false,
  });
}
