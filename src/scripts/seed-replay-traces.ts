/* eslint-disable no-console */

import { upsertTraceStart, updateTraceEnd } from '../core/agentRuntime/agent-trace-repo';
import { prisma } from '../core/db/prisma-client';

const TOPICS = ['chat', 'coding', 'search'] as const;
type TopicKind = (typeof TOPICS)[number];

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.floor(numeric);
}

function buildReply(topic: TopicKind, sample: number): string {
  switch (topic) {
    case 'chat':
      return `Sample chat reply ${sample}: concise and context-aware response.`;
    case 'coding':
      return `Sample coding reply ${sample}: provided a safe TypeScript fix and explanation.`;
    case 'search':
      return (
        `Sample search reply ${sample}: latest summary with source references. ` +
        'Source: https://example.com/latest'
      );

    default:
      return `Sample reply ${sample}.`;
  }
}

async function main(): Promise<void> {
  const perRoute = Math.max(1, Math.min(25, readInt('REPLAY_SEED_PER_ROUTE', 3)));
  const guildIdRaw = process.env.REPLAY_SEED_GUILD_ID?.trim();
  const guildId = guildIdRaw && guildIdRaw.length > 0 ? guildIdRaw : null;
  const channelPrefix = process.env.REPLAY_SEED_CHANNEL_PREFIX?.trim() || 'seed-replay';
  const userId = process.env.REPLAY_SEED_USER_ID?.trim() || 'seed-user';
  const runId = `${Date.now()}`;

  let inserted = 0;
  for (const topic of TOPICS) {
    for (let sample = 1; sample <= perRoute; sample += 1) {
      const traceId = `seed-${runId}-${topic}-${sample}`;
      const channelId = `${channelPrefix}-${topic}`;
      const toolsExecuted = topic === 'coding' || topic === 'chat' || topic === 'search';

      await upsertTraceStart({
        id: traceId,
        guildId,
        channelId,
        userId,
        routeKind: 'single',
        reasoningText: `Seeded single-route trace sample ${sample} (${topic})`,
        budgetJson: {
          failedTasks: 0,
          seeded: true,
        },
      });

      await updateTraceEnd({
        id: traceId,
        toolJson: {
          enabled: true,
          routeTools:
            topic === 'search'
              ? ['web']
              : topic === 'coding'
                ? ['github']
                : ['discord'],
          main: {
            enabled: true,
            toolsExecuted,
            roundsCompleted: toolsExecuted ? 1 : 0,
            toolResultCount: toolsExecuted ? 1 : 0,
            successfulToolCount: toolsExecuted ? 1 : 0,
          },
        },
        qualityJson: {
          seeded: true,
        },
        budgetJson: {
          failedTasks: 0,
          seeded: true,
        },
        replyText: buildReply(topic, sample),
      });

      inserted += 1;
    }
  }

  console.log('[replay-seed] done', {
    inserted,
    perRoute,
    routes: TOPICS.length,
    guildId,
  });
}

main()
  .catch((error) => {
    console.error('[replay-seed] failed', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
