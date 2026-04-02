import { z } from 'zod';
import { prisma } from '../../../platform/db/prisma-client';
import { defineBridgeMethod, requireGuildId } from './common';

function normalizeInstructionsText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

export const adminDomainMethods = [
  defineBridgeMethod({
    namespace: 'admin',
    method: 'instructions.get',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
    }),
    mutability: 'read',
    access: 'admin',
    async execute(args, context) {
      const guildId = args.guildId ?? requireGuildId(context.toolContext);
      const row = await prisma.serverInstructions.findUnique({
        where: { guildId },
      });
      if (!row) {
        return null;
      }
      return {
        guildId: row.guildId,
        instructionsText: row.instructionsText,
        version: row.version,
        updatedByAdminId: row.updatedByAdminId,
        updatedAt: row.updatedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'admin',
    method: 'instructions.update',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
      instructionsText: z.string().trim().min(1).max(20_000),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      const guildId = args.guildId ?? requireGuildId(context.toolContext);
      const adminId = context.toolContext.userId;
      const nextText = normalizeInstructionsText(args.instructionsText);
      const row = await prisma.$transaction(async (tx) => {
        const existing = await tx.serverInstructions.findUnique({
          where: { guildId },
        });
        if (existing) {
          await tx.serverInstructionsArchive.create({
            data: {
              guildId: existing.guildId,
              version: existing.version,
              instructionsText: existing.instructionsText,
              updatedByAdminId: existing.updatedByAdminId,
            },
          });
        }
        return tx.serverInstructions.upsert({
          where: { guildId },
          create: {
            guildId,
            instructionsText: nextText,
            version: 1,
            updatedByAdminId: adminId,
          },
          update: {
            instructionsText: nextText,
            version: (existing?.version ?? 0) + 1,
            updatedByAdminId: adminId,
          },
        });
      });
      return {
        guildId: row.guildId,
        instructionsText: row.instructionsText,
        version: row.version,
        updatedByAdminId: row.updatedByAdminId,
        updatedAt: row.updatedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    },
  }),
];
