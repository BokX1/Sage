export interface ApprovalInterruptPayload {
  kind: string;
  guildId: string;
  sourceChannelId: string;
  reviewChannelId: string;
  sourceMessageId?: string | null;
  requestedBy: string;
  dedupeKey: string;
  executionPayloadJson: unknown;
  reviewSnapshotJson: unknown;
  interruptMetadataJson?: unknown;
}

export class ToolControlSignal extends Error {
  readonly signalKind: string;

  constructor(signalKind: string, message: string) {
    super(message);
    this.name = 'ToolControlSignal';
    this.signalKind = signalKind;
  }
}

export class ApprovalRequiredSignal extends ToolControlSignal {
  readonly payload: ApprovalInterruptPayload;

  constructor(payload: ApprovalInterruptPayload) {
    super(
      'approval_required',
      `Tool execution requires approval for ${payload.kind}.`,
    );
    this.name = 'ApprovalRequiredSignal';
    this.payload = payload;
  }
}

export function isToolControlSignal(error: unknown): error is ToolControlSignal {
  return error instanceof ToolControlSignal;
}
