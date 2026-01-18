import { prisma } from '../../db/client';
import crypto from 'crypto';

type PrismaAdminAuditClient = {
    create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
};

function getAdminAuditClient(): PrismaAdminAuditClient {
    return (prisma as unknown as { adminAudit: PrismaAdminAuditClient }).adminAudit;
}

/**
 * Compute SHA-256 hash of normalized params JSON.
 */
export function computeParamsHash(params: Record<string, unknown>): string {
    const normalized = JSON.stringify(params, Object.keys(params).sort());
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Log an admin command execution.
 */
export async function logAdminAction(params: {
    guildId: string;
    adminId: string;
    command: string;
    paramsHash: string;
}): Promise<void> {
    const client = getAdminAuditClient();
    await client.create({
        data: {
            guildId: params.guildId,
            adminId: params.adminId,
            command: params.command,
            paramsHash: params.paramsHash,
        },
    });
}
