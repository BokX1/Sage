/**
 * @module src/bot/handlers/welcomeMessage
 * @description Defines the welcome message module.
 */
import { EmbedBuilder } from 'discord.js';

/**
 * Formats a consistent and visually appealing welcome message for Sage.
 * Used for both proactive greetings and missing-key fallback warnings.
 */
export function getWelcomeMessage(): EmbedBuilder {
    return new EmbedBuilder()
        .setColor('#4a7c23')
        .setTitle("👋 Hello! I'm Sage, your Fully Agentic AI Companion.")
        .setDescription("I'm designed to be a friendly member of your community. I don't just respond; I listen and evolve alongside you.")
        .addFields(
            {
                name: "✨ What I Can Do",
                value: "🧠 **Deep Memory**: I maintain perfect context of our conversations and server lore using my hybrid memory graph.\n🌐 **Live Web Search**: I can research real-time data, documentation, and news to answer complex questions.\n🎨 **Generative Content**: I can render custom images and brainstorm creative worlds on command.\n⚡ **Autonomous Tools**: I dynamically select tools (like ingesting attachments or formatting data) based on your intent.\n🎤 **Voice Awareness**: I know who's active in voice channels and for how long.",
            },
            {
                name: "🚀 Activation Required",
                value: "I run on a **Bring Your Own Pollen (BYOP)** model. This means I'm free to host, but I need an API key to \"power my brain.\"\n\n**Administrators: Please set up the server key:**\n1️⃣ Get a free key at [pollinations.ai](https://pollinations.ai/) (Login with Discord).\n2️⃣ Run `/sage key set <your_key>` in this server.",
            },
            {
                name: "💬 How to Chat",
                value: "Once activated, you can trigger me in three ways:\n• **Prefix**: Start your message with \"**Sage**\" (e.g., *Sage, help me with this code*)\n• **Mention**: Tag me anywhere in your message (**@Sage**)\n• **Reply**: Just **reply** to any of my previous messages!",
            }
        );
}
