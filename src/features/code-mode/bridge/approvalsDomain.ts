import { z } from 'zod';
import {
  getApprovalReviewRequestById,
  listApprovalReviewRequestsByThreadId,
} from '../../admin/approvalReviewRequestRepo';
import { defineBridgeMethod } from './common';

function serializeApprovalRecord(record: Awaited<ReturnType<typeof getApprovalReviewRequestById>> extends infer T
  ? Exclude<T, null>
  : never) {
  return {
    id: record.id,
    threadId: record.threadId,
    guildId: record.guildId,
    sourceChannelId: record.sourceChannelId,
    reviewChannelId: record.reviewChannelId,
    sourceMessageId: record.sourceMessageId,
    requestedBy: record.requestedBy,
    kind: record.kind,
    status: record.status,
    expiresAt: record.expiresAt.toISOString(),
    decidedBy: record.decidedBy,
    decidedAt: record.decidedAt?.toISOString() ?? null,
    executedAt: record.executedAt?.toISOString() ?? null,
    resultJson: record.resultJson,
    decisionReasonText: record.decisionReasonText,
    errorText: record.errorText,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export const approvalsDomainMethods = [
  defineBridgeMethod({
    namespace: 'approvals',
    method: 'get',
    summary: 'Read one approval request by id.',
    input: z.object({
      requestId: z.string().trim().min(1),
    }),
    mutability: 'read',
    access: 'admin',
    async execute(args) {
      const record = await getApprovalReviewRequestById(args.requestId);
      return record ? serializeApprovalRecord(record) : null;
    },
  }),
  defineBridgeMethod({
    namespace: 'approvals',
    method: 'list',
    summary: 'List approval requests for one task thread.',
    input: z.object({
      threadId: z.string().trim().min(1),
    }),
    mutability: 'read',
    access: 'admin',
    async execute(args) {
      const records = await listApprovalReviewRequestsByThreadId(args.threadId);
      return records.map((record) => serializeApprovalRecord(record));
    },
  }),
];
