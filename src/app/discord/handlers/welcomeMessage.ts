import { EmbedBuilder } from 'discord.js';

/**
 * Formats a consistent and visually appealing welcome message for Sage.
 * Used for both proactive greetings and missing-key fallback warnings.
 */
export function getWelcomeMessage(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor('#4a7c23')
    .setTitle("👋 I'm Sage")
    .setDescription(
      "Sage is a chat-first AI teammate for active Discord communities. I help members and admins research, summarize context, work with files, and keep decisions moving without command menus.",
    )
    .addFields(
      {
        name: '✨ Best For',
        value:
          'Communities that want one assistant for everyday questions, structured updates, lightweight ops help, and approval-gated admin actions.',
      },
      {
        name: '🚀 Get Live',
        value:
          '**Hosted Sage**: invite the hosted bot, trigger me once, and let a server admin set the server key.\n**Self-hosted Sage**: run `npm run onboard`, invite your own bot, and optionally use a host-level provider key instead of the server-key flow.',
      },
      {
        name: '💬 How To Talk To Me',
        value:
          'Mention me anywhere, reply to one of my messages, or start a message with `Sage`.\nExamples: `@Sage summarize the last thread`, `Sage, join my voice channel`, `Sage, review this file`.',
      },
    );
}
