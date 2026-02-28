import type { ChatInputCommandInteraction } from 'discord.js';

interface CommandReplyPayload {
  content: string;
  ephemeral?: boolean;
}

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
