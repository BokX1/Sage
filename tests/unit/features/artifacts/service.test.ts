import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiscordArtifactRecord, DiscordArtifactRevisionRecord } from '@/features/artifacts/types';

const filterChannelIdsByMemberAccess = vi.hoisted(() => vi.fn());
const requestDiscordInteractionForTool = vi.hoisted(() => vi.fn());
const listIngestedAttachmentsByIds = vi.hoisted(() => vi.fn());
const sendCachedAttachment = vi.hoisted(() => vi.fn());
const getGuildArtifactVaultChannelId = vi.hoisted(() => vi.fn());
const createArtifact = vi.hoisted(() => vi.fn());
const createArtifactLink = vi.hoisted(() => vi.fn());
const createArtifactRevision = vi.hoisted(() => vi.fn());
const getArtifactById = vi.hoisted(() => vi.fn());
const getLatestArtifactRevision = vi.hoisted(() => vi.fn());
const listArtifactRevisions = vi.hoisted(() => vi.fn());
const listArtifactsByGuild = vi.hoisted(() => vi.fn());
const updateArtifactMetadata = vi.hoisted(() => vi.fn());
const countArtifactDiagnostics = vi.hoisted(() => vi.fn());

vi.mock('@/platform/discord/channel-access', () => ({
  filterChannelIdsByMemberAccess,
}));

vi.mock('@/features/admin/adminActionService', () => ({
  requestDiscordInteractionForTool,
}));

vi.mock('@/features/attachments/ingestedAttachmentRepo', () => ({
  listIngestedAttachmentsByIds,
}));

vi.mock('@/features/agent-runtime/bridgeBackends', () => ({
  sendCachedAttachment,
}));

vi.mock('@/features/settings/guildSettingsRepo', () => ({
  getGuildArtifactVaultChannelId,
}));

vi.mock('@/features/artifacts/artifactRepo', () => ({
  countArtifactDiagnostics,
  createArtifact,
  createArtifactLink,
  createArtifactRevision,
  getArtifactById,
  getLatestArtifactRevision,
  listArtifactRevisions,
  listArtifactsByGuild,
  updateArtifactMetadata,
}));

function createArtifactRecord(overrides: Partial<DiscordArtifactRecord> = {}): DiscordArtifactRecord {
  return {
    id: 'artifact-1',
    guildId: 'guild-1',
    originChannelId: 'channel-a',
    createdByUserId: 'user-1',
    name: 'Artifact One',
    filename: 'artifact-one.md',
    mediaKind: 'text',
    mimeType: 'text/markdown',
    descriptionText: null,
    latestRevisionNumber: 2,
    latestPublishedChannelId: null,
    latestPublishedMessageId: null,
    createdAt: new Date('2026-03-23T10:00:00.000Z'),
    updatedAt: new Date('2026-03-23T10:05:00.000Z'),
    ...overrides,
  };
}

function createRevisionRecord(overrides: Partial<DiscordArtifactRevisionRecord> = {}): DiscordArtifactRevisionRecord {
  return {
    id: 'revision-1',
    artifactId: 'artifact-1',
    revisionNumber: 2,
    createdByUserId: 'user-1',
    sourceKind: 'text',
    sourceAttachmentId: null,
    sourceRevisionId: null,
    format: 'md',
    filename: 'artifact-one.md',
    mimeType: 'text/markdown',
    contentText: '# updated',
    sizeBytes: 9,
    metadataJson: null,
    createdAt: new Date('2026-03-23T10:05:00.000Z'),
    ...overrides,
  };
}

describe('artifact service authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listArtifactsByGuild.mockResolvedValue([]);
    getArtifactById.mockResolvedValue(null);
    getLatestArtifactRevision.mockResolvedValue(createRevisionRecord());
    listArtifactRevisions.mockResolvedValue([createRevisionRecord()]);
    createArtifactRevision.mockResolvedValue(createRevisionRecord());
    updateArtifactMetadata.mockResolvedValue(createArtifactRecord());
    filterChannelIdsByMemberAccess.mockImplementation(
      async ({ channelIds }: { channelIds: string[] }) => new Set(channelIds.filter((id) => id === 'channel-a')),
    );
  });

  it('filters artifact inventory to only artifacts whose source channel the requester can access', async () => {
    listArtifactsByGuild.mockResolvedValue([
      createArtifactRecord({
        id: 'artifact-a',
        originChannelId: 'channel-a',
      }),
      createArtifactRecord({
        id: 'artifact-b',
        originChannelId: 'channel-b',
      }),
    ]);

    const { listArtifactsForTool } = await import('@/features/artifacts/service');
    const result = await listArtifactsForTool({
      guildId: 'guild-1',
      requesterUserId: 'user-9',
      limit: 25,
    });
    const items = (result as { items: Array<{ id: string }> }).items;

    expect(result).toMatchObject({
      ok: true,
      action: 'list_artifacts',
      items: [expect.objectContaining({ id: 'artifact-a' })],
    });
    expect(items.map((item) => item.id)).toEqual(['artifact-a']);
  });

  it('hides inaccessible artifacts from direct reads', async () => {
    getArtifactById.mockResolvedValue(
      createArtifactRecord({
        id: 'artifact-b',
        originChannelId: 'channel-b',
      }),
    );

    const { getArtifactForTool } = await import('@/features/artifacts/service');

    await expect(
      getArtifactForTool({
        guildId: 'guild-1',
        requesterUserId: 'user-9',
        artifactId: 'artifact-b',
      }),
    ).rejects.toThrow('Artifact not found.');
  });

  it('rejects artifact revision writes when the requester cannot access the artifact source channel', async () => {
    getArtifactById.mockResolvedValue(
      createArtifactRecord({
        id: 'artifact-b',
        originChannelId: 'channel-b',
      }),
    );

    const { replaceArtifactForTool } = await import('@/features/artifacts/service');

    await expect(
      replaceArtifactForTool({
        guildId: 'guild-1',
        requesterUserId: 'user-9',
        requestedByUserId: 'user-9',
        artifactId: 'artifact-b',
        content: 'new body',
      }),
    ).rejects.toThrow('Artifact not found.');

    expect(createArtifactRevision).not.toHaveBeenCalled();
    expect(updateArtifactMetadata).not.toHaveBeenCalled();
  });
});
