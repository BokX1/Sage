import { Buffer } from 'node:buffer';
import { PermissionsBitField } from 'discord.js';
import { filterChannelIdsByMemberAccess } from '../../platform/discord/channel-access';
import { requestDiscordInteractionForTool } from '../admin/adminActionService';
import { listIngestedAttachmentsByIds } from '../attachments/ingestedAttachmentRepo';
import { sendCachedAttachment } from '../agent-runtime/bridgeBackends';
import { getGuildArtifactVaultChannelId } from '../settings/guildSettingsRepo';
import {
  countArtifactDiagnostics,
  createArtifact,
  createArtifactLink,
  createArtifactRevision,
  getArtifactById,
  getLatestArtifactRevision,
  listArtifactRevisions,
  listArtifactsByGuild,
  updateArtifactMetadata,
} from './artifactRepo';
import type {
  DiscordArtifactMediaKind,
  DiscordArtifactRuntimeDiagnostic,
} from './types';

const CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY = [
  { flag: PermissionsBitField.Flags.ViewChannel, label: 'ViewChannel' },
  { flag: PermissionsBitField.Flags.ReadMessageHistory, label: 'ReadMessageHistory' },
];

function inferMediaKind(params: {
  filename: string;
  contentText?: string | null;
  mimeType?: string | null;
}): DiscordArtifactMediaKind {
  if (params.contentText && params.contentText.trim().length > 0) {
    const lowered = params.filename.toLowerCase();
    if (
      lowered.endsWith('.json') ||
      lowered.endsWith('.csv') ||
      lowered.endsWith('.yaml') ||
      lowered.endsWith('.yml') ||
      lowered.endsWith('.html')
    ) {
      return 'structured_text';
    }
    return 'text';
  }
  return 'binary';
}

function coerceFilename(filename: string | undefined, fallback: string): string {
  const trimmed = filename?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function trimOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

async function assertRequesterCanSeeArtifactSource(params: {
  guildId: string;
  requesterUserId: string;
  sourceChannelId: string;
}): Promise<void> {
  const allowed = await filterChannelIdsByMemberAccess({
    guildId: params.guildId,
    userId: params.requesterUserId,
    channelIds: [params.sourceChannelId],
    requirements: CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY,
  });
  if (!allowed.has(params.sourceChannelId)) {
    throw new Error('You do not have access to the source channel for this artifact.');
  }
}

function resolveArtifactAccessChannelId(params: {
  originChannelId?: string | null;
  latestPublishedChannelId?: string | null;
}): string | null {
  return params.originChannelId?.trim() || params.latestPublishedChannelId?.trim() || null;
}

async function canRequesterAccessArtifact(params: {
  guildId: string;
  requesterUserId: string;
  artifact: {
    originChannelId?: string | null;
    latestPublishedChannelId?: string | null;
  };
}): Promise<boolean> {
  const sourceChannelId = resolveArtifactAccessChannelId(params.artifact);
  if (!sourceChannelId) {
    return false;
  }

  const allowed = await filterChannelIdsByMemberAccess({
    guildId: params.guildId,
    userId: params.requesterUserId,
    channelIds: [sourceChannelId],
    requirements: CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY,
  });
  return allowed.has(sourceChannelId);
}

async function assertRequesterCanAccessArtifact(params: {
  guildId: string;
  requesterUserId: string;
  artifact: {
    originChannelId?: string | null;
    latestPublishedChannelId?: string | null;
  };
}): Promise<void> {
  const allowed = await canRequesterAccessArtifact(params);
  if (!allowed) {
    throw new Error('Artifact not found.');
  }
}

function readPublishedMessageId(sendResult: Record<string, unknown>): string | null {
  const data = sendResult.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const candidate = (data as { id?: unknown }).id;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

export async function listArtifactsForTool(params: {
  guildId: string;
  requesterUserId: string;
  channelId?: string | null;
  createdByUserId?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>> {
  const items = await listArtifactsByGuild({
    guildId: params.guildId,
    originChannelId: params.channelId ?? null,
    createdByUserId: params.createdByUserId ?? null,
    limit: Math.max(params.limit ?? 25, 50),
  });
  const accessibleItems = (
    await Promise.all(
      items.map(async (artifact) =>
        (await canRequesterAccessArtifact({
          guildId: params.guildId,
          requesterUserId: params.requesterUserId,
          artifact,
        }))
          ? artifact
          : null,
      ),
    )
  )
    .filter((artifact): artifact is (typeof items)[number] => artifact !== null)
    .slice(0, params.limit ?? 25);
  return {
    ok: true,
    action: 'list_artifacts',
    guildId: params.guildId,
    items: accessibleItems.map((artifact) => ({
      ...artifact,
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString(),
    })),
  };
}

export async function getArtifactForTool(params: {
  guildId: string;
  requesterUserId: string;
  artifactId: string;
}): Promise<Record<string, unknown>> {
  const artifact = await getArtifactById(params.artifactId);
  if (!artifact || artifact.guildId !== params.guildId) {
    throw new Error('Artifact not found.');
  }
  await assertRequesterCanAccessArtifact({
    guildId: params.guildId,
    requesterUserId: params.requesterUserId,
    artifact,
  });
  const latestRevision = await getLatestArtifactRevision(artifact.id);
  const revisions = await listArtifactRevisions(artifact.id, 10);
  return {
    ok: true,
    action: 'get_artifact',
    artifact: {
      ...artifact,
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString(),
    },
    latestRevision: latestRevision
      ? {
          ...latestRevision,
          createdAt: latestRevision.createdAt.toISOString(),
        }
      : null,
    recentRevisions: revisions.map((revision) => ({
      ...revision,
      createdAt: revision.createdAt.toISOString(),
    })),
  };
}

export async function getArtifactLatestTextContentForTool(params: {
  guildId: string;
  requesterUserId: string;
  artifactId: string;
}): Promise<{
  artifactId: string;
  name: string;
  filename: string;
  revisionId: string;
  revisionNumber: number;
  contentText: string;
}> {
  const artifact = await getArtifactById(params.artifactId);
  if (!artifact || artifact.guildId !== params.guildId) {
    throw new Error('Artifact not found.');
  }
  await assertRequesterCanAccessArtifact({
    guildId: params.guildId,
    requesterUserId: params.requesterUserId,
    artifact,
  });
  const latestRevision = await getLatestArtifactRevision(artifact.id);
  if (!latestRevision) {
    throw new Error('Artifact has no revisions.');
  }
  const contentText = latestRevision.contentText?.trim() ?? '';
  if (!contentText) {
    throw new Error('Only text-based artifacts can be used here.');
  }
  return {
    artifactId: artifact.id,
    name: artifact.name,
    filename: latestRevision.filename,
    revisionId: latestRevision.id,
    revisionNumber: latestRevision.revisionNumber,
    contentText,
  };
}

export async function stageAttachmentAsArtifactForTool(params: {
  guildId: string;
  requesterUserId: string;
  currentChannelId: string;
  attachmentId: string;
  name?: string;
  descriptionText?: string | null;
}): Promise<Record<string, unknown>> {
  const record = (await listIngestedAttachmentsByIds([params.attachmentId]))[0] ?? null;
  if (!record || record.guildId !== params.guildId) {
    throw new Error('Attachment not found in the active guild.');
  }
  await assertRequesterCanSeeArtifactSource({
    guildId: params.guildId,
    requesterUserId: params.requesterUserId,
    sourceChannelId: record.channelId,
  });

  const artifact = await createArtifact({
    guildId: params.guildId,
    originChannelId: record.channelId,
    createdByUserId: params.requesterUserId,
    name: trimOptional(params.name) ?? record.filename,
    filename: record.filename,
    mediaKind: inferMediaKind({
      filename: record.filename,
      contentText: record.extractedText,
      mimeType: record.contentType,
    }),
    mimeType: record.contentType ?? null,
    descriptionText: trimOptional(params.descriptionText),
  });
  const revision = await createArtifactRevision({
    artifactId: artifact.id,
    createdByUserId: params.requesterUserId,
    revisionNumber: 1,
    sourceKind: 'attachment',
    sourceAttachmentId: record.id,
    filename: record.filename,
    mimeType: record.contentType ?? null,
    contentText: record.extractedText ?? null,
    sizeBytes: record.readSizeBytes ?? record.declaredSizeBytes ?? null,
    metadataJson: {
      sourceMessageId: record.messageId,
      sourceChannelId: record.channelId,
      extractor: record.extractor,
      status: record.status,
    },
  });
  await updateArtifactMetadata({
    id: artifact.id,
    latestRevisionNumber: revision.revisionNumber,
  });
  return {
    ok: true,
    action: 'stage_attachment_artifact',
    artifactId: artifact.id,
    revisionId: revision.id,
    filename: artifact.filename,
    sourceAttachmentId: record.id,
  };
}

export async function createTextArtifactForTool(params: {
  guildId: string;
  channelId: string;
  requestedByUserId: string;
  name: string;
  filename?: string;
  format?: string | null;
  content: string;
  descriptionText?: string | null;
}): Promise<Record<string, unknown>> {
  const filename = coerceFilename(params.filename, `${params.name.trim().replace(/\s+/g, '-').toLowerCase() || 'artifact'}.md`);
  const mimeType = filename.endsWith('.json')
    ? 'application/json'
    : filename.endsWith('.csv')
      ? 'text/csv'
      : filename.endsWith('.html')
        ? 'text/html'
        : filename.endsWith('.yaml') || filename.endsWith('.yml')
          ? 'application/x-yaml'
          : 'text/plain';
  const artifact = await createArtifact({
    guildId: params.guildId,
    originChannelId: params.channelId,
    createdByUserId: params.requestedByUserId,
    name: params.name.trim(),
    filename,
    mediaKind: inferMediaKind({
      filename,
      contentText: params.content,
      mimeType,
    }),
    mimeType,
    descriptionText: trimOptional(params.descriptionText),
  });
  const revision = await createArtifactRevision({
    artifactId: artifact.id,
    createdByUserId: params.requestedByUserId,
    revisionNumber: 1,
    sourceKind: 'text',
    format: trimOptional(params.format),
    filename,
    mimeType,
    contentText: params.content,
    sizeBytes: Buffer.byteLength(params.content, 'utf8'),
  });
  await updateArtifactMetadata({
    id: artifact.id,
    latestRevisionNumber: revision.revisionNumber,
  });
  return {
    ok: true,
    action: 'create_text_artifact',
    artifactId: artifact.id,
    revisionId: revision.id,
    filename,
  };
}

export async function replaceArtifactForTool(params: {
  guildId: string;
  requesterUserId: string;
  artifactId: string;
  requestedByUserId: string;
  content?: string;
  filename?: string;
  format?: string | null;
  attachmentId?: string;
}): Promise<Record<string, unknown>> {
  const artifact = await getArtifactById(params.artifactId);
  if (!artifact || artifact.guildId !== params.guildId) {
    throw new Error('Artifact not found.');
  }
  await assertRequesterCanAccessArtifact({
    guildId: params.guildId,
    requesterUserId: params.requesterUserId,
    artifact,
  });
  const nextRevisionNumber = artifact.latestRevisionNumber + 1;
  if (params.attachmentId?.trim()) {
    const record = (await listIngestedAttachmentsByIds([params.attachmentId.trim()]))[0] ?? null;
    if (!record || record.guildId !== params.guildId) {
      throw new Error('Attachment not found in the active guild.');
    }
    await assertRequesterCanSeeArtifactSource({
      guildId: params.guildId,
      requesterUserId: params.requestedByUserId,
      sourceChannelId: record.channelId,
    });
    const revision = await createArtifactRevision({
      artifactId: artifact.id,
      createdByUserId: params.requestedByUserId,
      revisionNumber: nextRevisionNumber,
      sourceKind: 'attachment',
      sourceAttachmentId: record.id,
      filename: coerceFilename(params.filename, record.filename),
      mimeType: record.contentType ?? artifact.mimeType,
      contentText: record.extractedText ?? null,
      sizeBytes: record.readSizeBytes ?? record.declaredSizeBytes ?? null,
      metadataJson: {
        sourceMessageId: record.messageId,
        sourceChannelId: record.channelId,
      },
    });
    await updateArtifactMetadata({
      id: artifact.id,
      filename: revision.filename,
      latestRevisionNumber: revision.revisionNumber,
    });
    return {
      ok: true,
      action: 'replace_artifact',
      artifactId: artifact.id,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
    };
  }

  if (!params.content || params.content.trim().length === 0) {
    throw new Error('Provide replacement content or an attachmentId.');
  }
  const filename = coerceFilename(params.filename, artifact.filename);
  const revision = await createArtifactRevision({
    artifactId: artifact.id,
    createdByUserId: params.requestedByUserId,
    revisionNumber: nextRevisionNumber,
    sourceKind: 'text',
    format: trimOptional(params.format),
    filename,
    mimeType: artifact.mimeType,
    contentText: params.content,
    sizeBytes: Buffer.byteLength(params.content, 'utf8'),
  });
  await updateArtifactMetadata({
    id: artifact.id,
    filename,
    latestRevisionNumber: revision.revisionNumber,
  });
  return {
    ok: true,
    action: 'replace_artifact',
    artifactId: artifact.id,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
  };
}

export async function publishArtifactForTool(params: {
  guildId: string;
  requesterUserId: string;
  requesterChannelId: string;
  artifactId: string;
  channelId?: string;
  content?: string;
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';
}): Promise<Record<string, unknown>> {
  const artifact = await getArtifactById(params.artifactId);
  if (!artifact || artifact.guildId !== params.guildId) {
    throw new Error('Artifact not found.');
  }
  await assertRequesterCanAccessArtifact({
    guildId: params.guildId,
    requesterUserId: params.requesterUserId,
    artifact,
  });
  const revision = await getLatestArtifactRevision(artifact.id);
  if (!revision) {
    throw new Error('Artifact has no revisions to publish.');
  }
  const defaultVaultChannelId = await getGuildArtifactVaultChannelId(params.guildId);
  const targetChannelId = trimOptional(params.channelId) ?? defaultVaultChannelId ?? params.requesterChannelId;
  const sendResult =
    revision.sourceAttachmentId && !revision.contentText
      ? await sendCachedAttachment({
          guildId: params.guildId,
          requesterUserId: params.requesterUserId,
          requesterChannelId: params.requesterChannelId,
          invokedBy: params.invokedBy,
          attachmentId: revision.sourceAttachmentId,
          channelId: targetChannelId,
          content: trimOptional(params.content) ?? undefined,
        })
      : await requestDiscordInteractionForTool({
          guildId: params.guildId,
          channelId: params.requesterChannelId,
          requestedBy: params.requesterUserId,
          invokedBy: params.invokedBy,
          request: {
            action: 'send_message',
            channelId: targetChannelId,
            content: trimOptional(params.content) ?? undefined,
            files: [
              {
                filename: revision.filename,
                contentType: revision.mimeType ?? undefined,
                source: revision.contentText && revision.contentText.length <= 20_000
                  ? {
                      type: 'text',
                      text: revision.contentText,
                    }
                  : {
                      type: 'base64',
                      base64: Buffer.from(revision.contentText ?? '', 'utf8').toString('base64'),
                    },
              },
            ],
          },
        });

  const messageId = readPublishedMessageId(sendResult);
  if (messageId) {
    await createArtifactLink({
      artifactId: artifact.id,
      revisionId: revision.id,
      guildId: params.guildId,
      channelId: targetChannelId,
      messageId,
      publishedByUserId: params.requesterUserId,
    });
    await updateArtifactMetadata({
      id: artifact.id,
      latestPublishedChannelId: targetChannelId,
      latestPublishedMessageId: messageId,
    });
  }
  return {
    ok: true,
    action: 'publish_artifact',
    artifactId: artifact.id,
    revisionId: revision.id,
    targetChannelId,
    messageId,
    sendResult,
  };
}

export async function listArtifactRevisionsForTool(params: {
  guildId: string;
  requesterUserId: string;
  artifactId: string;
  limit?: number;
}): Promise<Record<string, unknown>> {
  const artifact = await getArtifactById(params.artifactId);
  if (!artifact || artifact.guildId !== params.guildId) {
    throw new Error('Artifact not found.');
  }
  await assertRequesterCanAccessArtifact({
    guildId: params.guildId,
    requesterUserId: params.requesterUserId,
    artifact,
  });
  const items = await listArtifactRevisions(artifact.id, params.limit ?? 25);
  return {
    ok: true,
    action: 'list_artifact_revisions',
    artifactId: artifact.id,
    items: items.map((revision) => ({
      ...revision,
      createdAt: revision.createdAt.toISOString(),
    })),
  };
}

export async function getArtifactRuntimeDiagnostics(): Promise<DiscordArtifactRuntimeDiagnostic> {
  const counts = await countArtifactDiagnostics();
  return {
    ready: true,
    ...counts,
  };
}
