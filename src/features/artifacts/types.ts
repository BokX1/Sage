export type DiscordArtifactMediaKind = 'text' | 'structured_text' | 'binary';
export type DiscordArtifactSourceKind = 'text' | 'attachment' | 'artifact_revision';

export interface DiscordArtifactRecord {
  id: string;
  guildId: string;
  originChannelId: string | null;
  createdByUserId: string;
  name: string;
  filename: string;
  mediaKind: DiscordArtifactMediaKind;
  mimeType: string | null;
  descriptionText: string | null;
  latestRevisionNumber: number;
  latestPublishedChannelId: string | null;
  latestPublishedMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscordArtifactRevisionRecord {
  id: string;
  artifactId: string;
  revisionNumber: number;
  createdByUserId: string;
  sourceKind: DiscordArtifactSourceKind;
  sourceAttachmentId: string | null;
  sourceRevisionId: string | null;
  format: string | null;
  filename: string;
  mimeType: string | null;
  contentText: string | null;
  sizeBytes: number | null;
  metadataJson: Record<string, unknown> | null;
  createdAt: Date;
}

export interface DiscordArtifactLinkRecord {
  id: string;
  artifactId: string;
  revisionId: string;
  guildId: string;
  channelId: string;
  messageId: string;
  publishedByUserId: string | null;
  createdAt: Date;
}

export interface DiscordArtifactRuntimeDiagnostic {
  ready: boolean;
  totalArtifacts: number;
  totalRevisions: number;
  publishedArtifacts: number;
}
