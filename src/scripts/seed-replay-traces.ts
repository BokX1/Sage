/* eslint-disable no-console */

import { upsertTraceStart, updateTraceEnd } from '../core/agentRuntime/agent-trace-repo';
import { prisma } from '../core/db/prisma-client';

const ROUTES = ['chat', 'coding', 'search', 'creative'] as const;
type RouteKind = (typeof ROUTES)[number];

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.floor(numeric);
}

function buildReply(route: RouteKind, sample: number): string {
  switch (route) {
    case 'chat':
      return `Sample chat reply ${sample}: concise and context-aware response.`;
    case 'coding':
      return `Sample coding reply ${sample}: provided a safe TypeScript fix and explanation.`;
    case 'search':
      return (
        `Sample search reply ${sample}: latest summary with source references. ` +
        'Source: https://example.com/latest'
      );
    case 'creative':
      return `Sample creative reply ${sample}: generated a stylized visual concept and prompt.`;
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
  for (const route of ROUTES) {
    for (let sample = 1; sample <= perRoute; sample += 1) {
      const traceId = `seed-${runId}-${route}-${sample}`;
      const channelId = `${channelPrefix}-${route}`;

      await upsertTraceStart({
        id: traceId,
        guildId,
        channelId,
        userId,
        routeKind: route,
        routerJson: {
          kind: route,
          seeded: true,
          source: 'seed-replay-traces',
        },
        expertsJson: [
          { name: 'UserMemory', json: { seeded: true } },
          { name: 'ChannelMemory', json: { seeded: true } },
          { name: 'SocialGraph', json: { seeded: route === 'chat' } },
        ],
        reasoningText: `Seeded ${route} trace sample ${sample}`,
        budgetJson: {
          failedTasks: 0,
          seeded: true,
        },
      });

      await updateTraceEnd({
        id: traceId,
        toolJson: {
          executed: route === 'coding' || route === 'chat',
        },
        qualityJson: {
          critic: [
            {
              iteration: 1,
              score: 0.92,
              verdict: 'pass',
              model: 'seed',
              issues: [],
            },
          ],
          seeded: true,
        },
        budgetJson: {
          failedTasks: 0,
          seeded: true,
        },
        replyText: buildReply(route, sample),
      });

      inserted += 1;
    }
  }

  console.log('[replay-seed] done', {
    inserted,
    perRoute,
    routes: ROUTES.length,
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
