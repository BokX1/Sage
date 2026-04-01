import { z } from 'zod';
import {
  createArtifact,
  createArtifactLink,
  createArtifactRevision,
  getArtifactById,
  getLatestArtifactRevision,
  listArtifactRevisions,
  listArtifactsByGuild,
  updateArtifactMetadata,
} from '../../artifacts/artifactRepo';
import { buildBridgeMethod, fetchWritableTextChannel, requireGuildId } from './common';

function serializeArtifact(record: NonNullable<Awaited<ReturnType<typeof getArtifactById>>>) {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function serializeRevision(record: NonNullable<Awaited<ReturnType<typeof getLatestArtifactRevision>>>) {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
  };
}

export const artifactsDomainMethods = [
  buildBridgeMethod({
    namespace: 'artifacts',
    method: 'list',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
      channelId: z.string().trim().min(1).optional(),
      createdByUserId: z.string().trim().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    mutability: 'read',
    async execute(args, context) {
      const guildId = args.guildId ?? requireGuildId(context.toolContext);
      const items = await listArtifactsByGuild({
        guildId,
        originChannelId: args.channelId ?? null,
        createdByUserId: args.createdByUserId ?? null,
        limit: args.limit ?? 25,
      });
      return items.map(serializeArtifact);
    },
  }),
  buildBridgeMethod({
    namespace: 'artifacts',
    method: 'get',
    input: z.object({
      artifactId: z.string().trim().min(1),
    }),
    mutability: 'read',
    async execute(args) {
      const artifact = await getArtifactById(args.artifactId);
      if (!artifact) {
        return null;
      }
      const latestRevision = await getLatestArtifactRevision(artifact.id);
      const revisions = await listArtifactRevisions(artifact.id, 10);
      return {
        artifact: serializeArtifact(artifact),
        latestRevision: latestRevision ? serializeRevision(latestRevision) : null,
        revisions: revisions.map((revision) => ({
          ...revision,
          createdAt: revision.createdAt.toISOString(),
        })),
      };
    },
  }),
  buildBridgeMethod({
    namespace: 'artifacts',
    method: 'create',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
      name: z.string().trim().min(1).max(200),
      filename: z.string().trim().min(1).max(240),
      content: z.string().max(1_000_000),
      descriptionText: z.string().trim().max(4_000).optional(),
      mimeType: z.string().trim().max(200).optional(),
    }),
    mutability: 'write',
    approvalMode: 'required',
    async execute(args, context) {
      const guildId = args.guildId ?? requireGuildId(context.toolContext);
      const artifact = await createArtifact({
        guildId,
        originChannelId: context.toolContext.channelId,
        createdByUserId: context.toolContext.userId,
        name: args.name,
        filename: args.filename,
        mediaKind: 'text',
        mimeType: args.mimeType ?? 'text/plain; charset=utf-8',
        descriptionText: args.descriptionText ?? null,
      });
      const revision = await createArtifactRevision({
        artifactId: artifact.id,
        createdByUserId: context.toolContext.userId,
        revisionNumber: 1,
        sourceKind: 'text',
        filename: args.filename,
        mimeType: args.mimeType ?? 'text/plain; charset=utf-8',
        contentText: args.content,
        sizeBytes: Buffer.byteLength(args.content, 'utf8'),
      });
      await updateArtifactMetadata({
        id: artifact.id,
        latestRevisionNumber: revision.revisionNumber,
      });
      return {
        artifact: serializeArtifact(artifact),
        revision: serializeRevision(revision),
      };
    },
  }),
  buildBridgeMethod({
    namespace: 'artifacts',
    method: 'update',
    input: z.object({
      artifactId: z.string().trim().min(1),
      name: z.string().trim().min(1).max(200).optional(),
      filename: z.string().trim().min(1).max(240).optional(),
      descriptionText: z.string().trim().max(4_000).optional(),
      content: z.string().max(1_000_000).optional(),
      mimeType: z.string().trim().max(200).optional(),
    }),
    mutability: 'write',
    approvalMode: 'required',
    async execute(args, context) {
      const artifact = await getArtifactById(args.artifactId);
      if (!artifact) {
        throw new Error('Artifact not found.');
      }
      const updatedArtifact = await updateArtifactMetadata({
        id: artifact.id,
        name: args.name,
        filename: args.filename,
        descriptionText: args.descriptionText ?? undefined,
      });
      let revision = null;
      if (typeof args.content === 'string') {
        const latestRevision = await getLatestArtifactRevision(artifact.id);
        revision = await createArtifactRevision({
          artifactId: artifact.id,
          createdByUserId: context.toolContext.userId,
          revisionNumber: (latestRevision?.revisionNumber ?? 0) + 1,
          sourceKind: 'text',
          filename: args.filename ?? latestRevision?.filename ?? artifact.filename,
          mimeType: args.mimeType ?? latestRevision?.mimeType ?? artifact.mimeType,
          contentText: args.content,
          sizeBytes: Buffer.byteLength(args.content, 'utf8'),
        });
        await updateArtifactMetadata({
          id: artifact.id,
          latestRevisionNumber: revision.revisionNumber,
          filename: args.filename ?? latestRevision?.filename ?? artifact.filename,
        });
      }
      return {
        artifact: serializeArtifact(updatedArtifact),
        revision: revision ? serializeRevision(revision) : null,
      };
    },
  }),
  buildBridgeMethod({
    namespace: 'artifacts',
    method: 'publish',
    input: z.object({
      artifactId: z.string().trim().min(1),
      channelId: z.string().trim().min(1),
    }),
    mutability: 'write',
    approvalMode: 'required',
    async execute(args, context) {
      const artifact = await getArtifactById(args.artifactId);
      if (!artifact) {
        throw new Error('Artifact not found.');
      }
      const revision = await getLatestArtifactRevision(artifact.id);
      if (!revision || !revision.contentText?.trim()) {
        throw new Error('Only text artifacts with content can be published.');
      }
      const channel = await fetchWritableTextChannel({
        toolContext: context.toolContext,
        channelId: args.channelId,
      });
      const sent = await channel.send({
        content: revision.contentText,
      });
      const guildId = requireGuildId(context.toolContext);
      await createArtifactLink({
        artifactId: artifact.id,
        revisionId: revision.id,
        guildId,
        channelId: args.channelId,
        messageId: sent.id,
        publishedByUserId: context.toolContext.userId,
      });
      const updatedArtifact = await updateArtifactMetadata({
        id: artifact.id,
        latestPublishedChannelId: args.channelId,
        latestPublishedMessageId: sent.id,
      });
      return {
        artifact: serializeArtifact(updatedArtifact),
        revision: serializeRevision(revision),
        publishedMessageId: sent.id,
      };
    },
  }),
];
