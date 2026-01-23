/**
 * Formats a consistent and visually appealing welcome message for Sage.
 * Used for both proactive greetings and missing-key fallback warnings.
 */
export function getWelcomeMessage(): string {
    return [
        '👋 **Hello! I\'m Sage, your Fully Agentic AI Companion.**',
        '',
        'I\'m designed to be a friendly member of your community. I don\'t just respond; I listen and evolve alongside you.',
        '',
        '### ✨ What I Can Do',
        '🧠 **Getting to Know You**: I remember our conversations so I can provide a personal touch and helpful context.',
        '👥 **Social Intelligence**: I understand the relationships and "vibe" of your server.',
        '📄 **File Ingestion**: Share **code files** or **text documents** with me for analysis (PDF support coming soon!).',
        '🎤 **Voice Awareness**: I know who\'s active in voice channels and for how long.',
        '👁️ **Vision**: I can see and discuss images you share.',
        '',
        '### 🚀 Activation Required',
        'I run on a **Bring Your Own Pollen (BYOP)** model. This means I\'m free to host, but I need an API key to "power my brain."',
        '',
        '**Administrators: Please set up the server key:**',
        '1️⃣ Get a free key at [pollinations.ai](https://pollinations.ai/) (Login with Discord).',
        '2️⃣ Run `/sage key set <your_key>` in this server.',
        '',
        '### 💬 How to Chat',
        'Once activated, you can trigger me in three ways:',
        '• **Prefix**: Start your message with "**Sage**" (e.g., *Sage, help me with this code*)',
        '• **Mention**: Tag me anywhere in your message (**@Sage**)',
        '• **Reply**: Just **reply** to any of my previous messages!',
    ].join('\n');
}
