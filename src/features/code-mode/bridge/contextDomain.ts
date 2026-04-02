import { z } from 'zod';
import { prisma } from '../../../platform/db/prisma-client';
import { defineBridgeMethod, requireGuildId } from './common';
import { normalizeUserProfileSummary, parseUserProfileSummary } from '../../memory/userProfileXml';

export const contextDomainMethods = [
  defineBridgeMethod({
    namespace: 'context',
    method: 'summary.get',
    input: z.object({
      channelId: z.string().trim().min(1),
      kind: z.enum(['rolling', 'profile']).default('profile'),
    }),
    mutability: 'read',
    async execute(args, context) {
      const guildId = requireGuildId(context.toolContext);
      const row = await prisma.channelSummary.findUnique({
        where: {
          guildId_channelId_kind: {
            guildId,
            channelId: args.channelId,
            kind: args.kind,
          },
        },
      });
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        guildId: row.guildId,
        channelId: row.channelId,
        kind: row.kind,
        windowStart: row.windowStart.toISOString(),
        windowEnd: row.windowEnd.toISOString(),
        summaryText: row.summaryText,
        topics: row.topicsJson,
        threads: row.threadsJson,
        unresolved: row.unresolvedJson,
        decisions: row.decisionsJson,
        actionItems: row.actionItemsJson,
        sentiment: row.sentiment,
        glossary: row.glossaryJson,
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'context',
    method: 'profile.get',
    input: z.object({
      userId: z.string().trim().min(1),
    }),
    mutability: 'read',
    async execute(args) {
      const row = await prisma.userProfile.findUnique({
        where: { userId: args.userId },
      });
      if (!row) {
        return null;
      }
      const normalized = normalizeUserProfileSummary(row.summary) ?? row.summary;
      return {
        userId: row.userId,
        summary: normalized,
        parsed: parseUserProfileSummary(normalized),
        updatedAt: row.updatedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    },
  }),
];
