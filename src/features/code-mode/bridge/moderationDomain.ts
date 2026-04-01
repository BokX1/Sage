import { z } from 'zod';
import {
  acknowledgeModerationCase,
  addModerationCaseNote,
  getModerationCaseById,
  listModerationCaseNotes,
  listModerationCasesByGuild,
  markModerationCaseResolved,
} from '../../moderation/moderationPolicyRepo';
import type { ModerationCaseStatus } from '../../moderation/types';
import { buildBridgeMethod, requireGuildId } from './common';

function serializeCase(record: NonNullable<Awaited<ReturnType<typeof getModerationCaseById>>>) {
  return {
    ...record,
    acknowledgedAt: record.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export const moderationDomainMethods = [
  buildBridgeMethod({
    namespace: 'moderation',
    method: 'cases.list',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    mutability: 'read',
    access: 'moderator',
    async execute(args, context) {
      const guildId = args.guildId ?? requireGuildId(context.toolContext);
      const cases = await listModerationCasesByGuild({
        guildId,
        limit: args.limit ?? 25,
      });
      return cases.map((record) => serializeCase(record));
    },
  }),
  buildBridgeMethod({
    namespace: 'moderation',
    method: 'cases.get',
    input: z.object({
      caseId: z.string().trim().min(1),
    }),
    mutability: 'read',
    access: 'moderator',
    async execute(args) {
      const record = await getModerationCaseById(args.caseId);
      if (!record) {
        return null;
      }
      const notes = await listModerationCaseNotes(record.id);
      return {
        case: serializeCase(record),
        notes: notes.map((note) => ({
          ...note,
          createdAt: note.createdAt.toISOString(),
          updatedAt: note.updatedAt.toISOString(),
        })),
      };
    },
  }),
  buildBridgeMethod({
    namespace: 'moderation',
    method: 'cases.acknowledge',
    input: z.object({
      caseId: z.string().trim().min(1),
    }),
    mutability: 'write',
    access: 'moderator',
    approvalMode: 'required',
    async execute(args, context) {
      const updated = await acknowledgeModerationCase({
        id: args.caseId,
        acknowledgedByUserId: context.toolContext.userId,
      });
      return serializeCase(updated);
    },
  }),
  buildBridgeMethod({
    namespace: 'moderation',
    method: 'cases.resolve',
    input: z.object({
      caseId: z.string().trim().min(1),
      outcome: z.enum(['executed', 'failed', 'noop'] satisfies ModerationCaseStatus[]),
      lifecycleStatus: z.enum(['resolved', 'voided']).default('resolved'),
      resolutionReasonText: z.string().trim().max(4_000).optional(),
    }),
    mutability: 'write',
    access: 'moderator',
    approvalMode: 'required',
    async execute(args, context) {
      const updated = await markModerationCaseResolved({
        id: args.caseId,
        status: args.outcome,
        lifecycleStatus: args.lifecycleStatus,
        executedByUserId: context.toolContext.userId,
        resolutionReasonText: args.resolutionReasonText ?? null,
      });
      return serializeCase(updated);
    },
  }),
  buildBridgeMethod({
    namespace: 'moderation',
    method: 'notes.create',
    input: z.object({
      caseId: z.string().trim().min(1),
      noteText: z.string().trim().min(1).max(4_000),
    }),
    mutability: 'write',
    access: 'moderator',
    approvalMode: 'required',
    async execute(args, context) {
      const note = await addModerationCaseNote({
        caseId: args.caseId,
        guildId: requireGuildId(context.toolContext),
        createdByUserId: context.toolContext.userId,
        noteText: args.noteText,
      });
      return {
        ...note,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      };
    },
  }),
];
