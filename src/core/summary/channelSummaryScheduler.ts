import { config as appConfig } from '../../config';
import { MessageStore, InMemoryMessageStore } from '../awareness/messageStore';
import { PrismaMessageStore } from '../awareness/prismaMessageStore';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { logger } from '../utils/logger';
import { ChannelSummaryStore } from './channelSummaryStore';
import { getChannelSummaryStore } from './channelSummaryStoreRegistry';
import {
  summarizeChannelProfile,
  summarizeChannelWindow,
  StructuredSummary,
} from './summarizeChannelWindow';

export interface DirtyChannelParams {
  guildId: string | null;
  channelId: string;
  lastMessageAt: Date;
  messageCountIncrement?: number;
}

type DirtyChannelState = {
  guildId: string | null;
  channelId: string;
  lastMessageAt: Date;
  messageCount: number;
};

type SummarizeChannelWindowFn = typeof summarizeChannelWindow;

type SummarizeChannelProfileFn = typeof summarizeChannelProfile;

type NowFn = () => number;

export class ChannelSummaryScheduler {
  private dirtyChannels = new Map<string, DirtyChannelState>();
  private summaryStore: ChannelSummaryStore;
  private messageStore: MessageStore;
  private summarizeWindow: SummarizeChannelWindowFn;
  private summarizeProfile: SummarizeChannelProfileFn;
  private now: NowFn;

  constructor(params: {
    summaryStore: ChannelSummaryStore;
    messageStore: MessageStore;
    summarizeWindow?: SummarizeChannelWindowFn;
    summarizeProfile?: SummarizeChannelProfileFn;
    now?: NowFn;
  }) {
    this.summaryStore = params.summaryStore;
    this.messageStore = params.messageStore;
    this.summarizeWindow = params.summarizeWindow ?? summarizeChannelWindow;
    this.summarizeProfile = params.summarizeProfile ?? summarizeChannelProfile;
    this.now = params.now ?? (() => Date.now());
  }

  markDirty(params: DirtyChannelParams): void {
    const key = this.keyFor(params.guildId, params.channelId);
    const existing = this.dirtyChannels.get(key);
    const increment = params.messageCountIncrement ?? 1;

    if (existing) {
      existing.lastMessageAt = params.lastMessageAt;
      existing.messageCount += increment;
      this.dirtyChannels.set(key, existing);
      return;
    }

    this.dirtyChannels.set(key, {
      guildId: params.guildId,
      channelId: params.channelId,
      lastMessageAt: params.lastMessageAt,
      messageCount: increment,
    });
  }

  async tick(): Promise<void> {
    const entries = Array.from(this.dirtyChannels.entries());

    for (const [key, state] of entries) {
      try {
        await this.updateChannel(key, state);
      } catch (error) {
        logger.error(
          { error, guildId: state.guildId, channelId: state.channelId },
          'Channel summary scheduler tick failed (non-fatal)',
        );
      }
    }
  }

  private async updateChannel(key: string, state: DirtyChannelState): Promise<void> {
    if (!state.guildId) {
      this.dirtyChannels.delete(key);
      return;
    }

    if (!isLoggingEnabled(state.guildId, state.channelId)) {
      this.dirtyChannels.delete(key);
      return;
    }

    const lastRolling = await this.summaryStore.getLatestSummary({
      guildId: state.guildId,
      channelId: state.channelId,
      kind: 'rolling',
    });
    const lastRollingAt = lastRolling?.updatedAt?.getTime() ?? lastRolling?.windowEnd.getTime();
    const nowMs = this.now();

    const minIntervalMs = appConfig.SUMMARY_ROLLING_MIN_INTERVAL_SEC * 1000;
    const hasMinInterval = !lastRollingAt || nowMs - lastRollingAt >= minIntervalMs;
    const hasMinMessages = state.messageCount >= appConfig.SUMMARY_ROLLING_MIN_MESSAGES;

    if (!hasMinInterval || !hasMinMessages) {
      return;
    }

    const windowStart = new Date(nowMs - appConfig.SUMMARY_ROLLING_WINDOW_MIN * 60 * 1000);
    const windowEnd = new Date(nowMs);

    const messages = await this.messageStore.fetchRecent({
      guildId: state.guildId,
      channelId: state.channelId,
      limit: 120,
      sinceMs: windowStart.getTime(),
    });

    if (messages.length === 0) {
      this.dirtyChannels.delete(key);
      return;
    }

    const rollingSummary = await this.summarizeWindow({
      messages,
      windowStart,
      windowEnd,
    });

    await this.summaryStore.upsertSummary({
      guildId: state.guildId,
      channelId: state.channelId,
      kind: 'rolling',
      windowStart: rollingSummary.windowStart,
      windowEnd: rollingSummary.windowEnd,
      summaryText: rollingSummary.summaryText,
      topics: rollingSummary.topics,
      threads: rollingSummary.threads,
      unresolved: rollingSummary.unresolved,
      decisions: rollingSummary.decisions,
      actionItems: rollingSummary.actionItems,
      sentiment: rollingSummary.sentiment,
      glossary: rollingSummary.glossary,
    });

    await this.maybeUpdateProfileSummary(state, rollingSummary);

    this.dirtyChannels.delete(key);
  }

  async forceSummarize(
    guildId: string,
    channelId: string,
    windowMinutesOverride?: number,
  ): Promise<StructuredSummary | null> {
    if (!isLoggingEnabled(guildId, channelId)) {
      logger.warn({ guildId, channelId }, 'Force summary aborted: logging disabled');
      return null;
    }

    const windowMinutes = windowMinutesOverride ?? appConfig.SUMMARY_ROLLING_WINDOW_MIN;
    const nowMs = this.now();
    const windowStart = new Date(nowMs - windowMinutes * 60 * 1000);
    const windowEnd = new Date(nowMs);

    const messages = await this.messageStore.fetchRecent({
      guildId,
      channelId,
      limit: 120,
      sinceMs: windowStart.getTime(),
    });

    if (messages.length === 0) {
      return null;
    }

    const rollingSummary = await this.summarizeWindow({
      messages,
      windowStart,
      windowEnd,
    });

    await this.summaryStore.upsertSummary({
      guildId,
      channelId,
      kind: 'rolling',
      windowStart: rollingSummary.windowStart,
      windowEnd: rollingSummary.windowEnd,
      summaryText: rollingSummary.summaryText,
      topics: rollingSummary.topics,
      threads: rollingSummary.threads,
      unresolved: rollingSummary.unresolved,
      decisions: rollingSummary.decisions,
      actionItems: rollingSummary.actionItems,
      sentiment: rollingSummary.sentiment,
      glossary: rollingSummary.glossary,
    });

    await this.maybeUpdateProfileSummary(
      {
        guildId,
        channelId,
        lastMessageAt: new Date(), // approximate
        messageCount: messages.length,
      },
      rollingSummary,
      true, // force update
    );

    return rollingSummary;
  }

  private async maybeUpdateProfileSummary(
    state: DirtyChannelState,
    rollingSummary: StructuredSummary,
    force = false,
  ): Promise<void> {
    const lastProfile = await this.summaryStore.getLatestSummary({
      guildId: state.guildId as string,
      channelId: state.channelId,
      kind: 'profile',
    });
    const lastProfileAt = lastProfile?.updatedAt?.getTime() ?? lastProfile?.windowEnd.getTime();
    const nowMs = this.now();
    const minIntervalMs = appConfig.SUMMARY_PROFILE_MIN_INTERVAL_SEC * 1000;
    const shouldUpdate = force || !lastProfileAt || nowMs - lastProfileAt >= minIntervalMs;

    if (!shouldUpdate) {
      return;
    }

    const profileSummary = await this.summarizeProfile({
      previousSummary: lastProfile
        ? {
          windowStart: lastProfile.windowStart,
          windowEnd: lastProfile.windowEnd,
          summaryText: lastProfile.summaryText,
          topics: lastProfile.topics ?? [],
          threads: lastProfile.threads ?? [],
          unresolved: lastProfile.unresolved ?? [],
          decisions: lastProfile.decisions ?? [],
          actionItems: lastProfile.actionItems ?? [],
          sentiment: lastProfile.sentiment,
          glossary: lastProfile.glossary ?? {},
        }
        : null,
      latestRollingSummary: rollingSummary,
    });

    await this.summaryStore.upsertSummary({
      guildId: state.guildId as string,
      channelId: state.channelId,
      kind: 'profile',
      windowStart: profileSummary.windowStart,
      windowEnd: profileSummary.windowEnd,
      summaryText: profileSummary.summaryText,
      topics: profileSummary.topics,
      threads: profileSummary.threads,
      unresolved: profileSummary.unresolved,
      decisions: profileSummary.decisions,
      actionItems: profileSummary.actionItems,
      sentiment: profileSummary.sentiment,
      glossary: profileSummary.glossary,
    });
  }

  private keyFor(guildId: string | null, channelId: string): string {
    return `${guildId ?? 'dm'}:${channelId}`;
  }
}

let schedulerInstance: ChannelSummaryScheduler | null = null;
let schedulerTimer: NodeJS.Timeout | null = null;

function createDefaultMessageStore(): MessageStore {
  if (appConfig.MESSAGE_DB_STORAGE_ENABLED) {
    return new PrismaMessageStore();
  }
  return new InMemoryMessageStore();
}

export function initChannelSummaryScheduler(params?: {
  summaryStore?: ChannelSummaryStore;
  messageStore?: MessageStore;
}): ChannelSummaryScheduler {
  if (schedulerInstance) {
    return schedulerInstance;
  }

  const summaryStore = params?.summaryStore ?? getChannelSummaryStore();
  const messageStore = params?.messageStore ?? createDefaultMessageStore();

  schedulerInstance = new ChannelSummaryScheduler({
    summaryStore,
    messageStore,
  });

  schedulerTimer = setInterval(() => {
    schedulerInstance?.tick().catch((error) => {
      logger.error({ error }, 'Channel summary scheduler tick failed (non-fatal)');
    });
  }, appConfig.SUMMARY_SCHED_TICK_SEC * 1000);

  return schedulerInstance;
}

export function getChannelSummaryScheduler(): ChannelSummaryScheduler | null {
  return schedulerInstance;
}

export function stopChannelSummaryScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  schedulerInstance = null;
}
