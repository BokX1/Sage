import { EmbedBuilder } from 'discord.js';

/**
 * Formats a consistent and visually appealing welcome message for Sage.
 * Used for both proactive greetings and missing-key fallback warnings.
 */
export function getWelcomeMessage(): EmbedBuilder {
    return new EmbedBuilder()
        .setColor('#4a7c23')
        .setTitle("👋 Hello! I'm Sage, your server's strategist-host.")
        .setDescription("I'm built for live Discord communities. I read the room, keep the thread moving, and turn noisy server context into useful action.")
        .addFields(
            {
                name: "✨ What I Can Do",
        value: "🧠 **Server Instructions**: Admins can steer my guild-specific role, persona, tone, and behavior.\n🌐 **Live Research**: I can pull current docs, news, and web sources when fresh information matters.\n🧩 **Discord-Native Presentation**: I can format answers as clean briefings, rich cards, and actionable updates when structure helps.\n⚡ **Autonomous Tools**: I choose tools based on the job, then bring back the useful part instead of dumping raw output.\n🎤 **Voice Awareness**: I can summarize voice activity and who has been active in channel sessions.",
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
