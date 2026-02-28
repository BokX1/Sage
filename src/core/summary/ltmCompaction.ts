import { config } from '../../shared/config/env';
import { logger } from '../utils/logger';
import { ChannelSummaryKind, ChannelSummaryStore } from './channelSummaryStore';
import { getChannelSummaryStore } from './channelSummaryStoreRegistry';
import { summarizeChannelProfile } from './summarizeChannelWindow';

const COMPACTION_CRON_HOUR = 23;
const COMPACTION_CRON_MINUTE = 50;
const COMPACTION_CRON_DAY = 0; // Sunday (UTC)
const COMPACTION_INTERVAL_MS = 60 * 1000;

let compactionTimer: NodeJS.Timeout | null = null;
let compactionInFlight: Promise<void> | null = null;
let compactionInFlightWeek: string | null = null;
let lastCompactedWeek: string | null = null;

/**
 * Returns an ISO week key using UTC semantics, for example: 2026-W08.
 */
export function getISOWeekString(date: Date): string {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const isoDay = utcDate.getUTCDay() || 7; // Sunday -> 7
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - isoDay); // nearest Thursday

  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNumber = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
}

export async function compactChannelProfile(
  guildId: string,
  channelId: string,
  store: ChannelSummaryStore,
  options: {
    apiKey?: string;
    weekKey?: string;
    now?: Date;
  } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const weekKey = options.weekKey ?? getISOWeekString(now);
  const currentProfile = await store.getLatestSummary({
    guildId,
    channelId,
    kind: 'profile',
  });

  if (!currentProfile) {
    logger.debug({ guildId, channelId }, 'No profile to compact, skipping');
    return;
  }

  const archiveKind: ChannelSummaryKind = `archive:${weekKey}`;

  await store.upsertSummary({
    guildId,
    channelId,
    kind: archiveKind,
    windowStart: currentProfile.windowStart,
    windowEnd: currentProfile.windowEnd,
    summaryText: currentProfile.summaryText,
    topics: currentProfile.topics ?? [],
    threads: currentProfile.threads ?? [],
    unresolved: currentProfile.unresolved ?? [],
    decisions: currentProfile.decisions ?? [],
    actionItems: currentProfile.actionItems ?? [],
    sentiment: currentProfile.sentiment,
    glossary: currentProfile.glossary ?? {},
  });

  logger.info({ guildId, channelId, archiveKind }, 'Channel LTM archived');

  const compacted = await summarizeChannelProfile({
    previousSummary: {
      windowStart: currentProfile.windowStart,
      windowEnd: currentProfile.windowEnd,
      summaryText: currentProfile.summaryText,
      topics: currentProfile.topics ?? [],
      threads: currentProfile.threads ?? [],
      unresolved: currentProfile.unresolved ?? [],
      decisions: currentProfile.decisions ?? [],
      actionItems: currentProfile.actionItems ?? [],
      sentiment: currentProfile.sentiment,
      glossary: currentProfile.glossary ?? {},
    },
    latestRollingSummary: {
      windowStart: now,
      windowEnd: now,
      summaryText: '(New week - compaction in progress)',
      topics: [],
      threads: [],
      unresolved: [],
      decisions: [],
      actionItems: [],
      glossary: {},
    },
    apiKey: options.apiKey,
  });

  await store.upsertSummary({
    guildId,
    channelId,
    kind: 'profile',
    windowStart: compacted.windowStart,
    windowEnd: compacted.windowEnd,
    summaryText: compacted.summaryText,
    topics: compacted.topics,
    threads: compacted.threads,
    unresolved: compacted.unresolved,
    decisions: compacted.decisions,
    actionItems: compacted.actionItems,
    sentiment: compacted.sentiment,
    glossary: compacted.glossary,
  });

  logger.info({ guildId, channelId }, 'Channel LTM compacted for new week');
}

function isWithinCompactionWindow(now: Date): boolean {
  return (
    now.getUTCDay() === COMPACTION_CRON_DAY &&
    now.getUTCHours() === COMPACTION_CRON_HOUR &&
    now.getUTCMinutes() >= COMPACTION_CRON_MINUTE
  );
}

export function startCompactionScheduler(): void {
  if (!config.LTM_COMPACTION_ENABLED) {
    logger.info('[Compaction] LTM compaction is disabled via config');
    return;
  }
  if (compactionTimer) return;

  const maybeRunCompaction = async () => {
    const now = new Date();
    if (!isWithinCompactionWindow(now)) return;

    try {
      await runWeeklyCompaction(now);
    } catch (error) {
      logger.error({ error }, 'Weekly LTM compaction failed (non-fatal)');
    }
  };

  void maybeRunCompaction();
  compactionTimer = setInterval(() => {
    void maybeRunCompaction();
  }, COMPACTION_INTERVAL_MS);

  compactionTimer.unref();
  logger.info('LTM compaction scheduler started (Sunday 23:50 UTC)');
}

export function stopCompactionScheduler(): void {
  if (compactionTimer) {
    clearInterval(compactionTimer);
    compactionTimer = null;
  }
}

/**
 * Runs compaction for all channels with an active profile.
 * Guarded to execute at most once per ISO week in-process.
 */
export async function runWeeklyCompaction(now: Date = new Date()): Promise<void> {
  const weekKey = getISOWeekString(now);

  if (lastCompactedWeek === weekKey) {
    logger.info({ weekKey }, 'Weekly LTM compaction already completed for this week, skipping');
    return;
  }

  if (compactionInFlight && compactionInFlightWeek === weekKey) {
    logger.info({ weekKey }, 'Weekly LTM compaction already in progress for this week, awaiting');
    await compactionInFlight;
    return;
  }

  const task = (async () => {
    logger.info({ weekKey }, 'Weekly LTM compaction cycle started');
    const store = getChannelSummaryStore();

    try {
      const activeProfiles = await store.listActiveProfiles();
      logger.info({ profileCount: activeProfiles.length, weekKey }, 'Found active profiles for LTM compaction');

      let successCount = 0;
      let failCount = 0;

      for (const profile of activeProfiles) {
        try {
          await compactChannelProfile(profile.guildId, profile.channelId, store, {
            weekKey,
            now,
          });
          successCount++;
        } catch (error) {
          failCount++;
          logger.error(
            { error, guildId: profile.guildId, channelId: profile.channelId, weekKey },
            'Failed to compact channel profile',
          );
        }
      }

      logger.info(
        { successCount, failCount, totalCount: activeProfiles.length, weekKey },
        'Weekly LTM compaction cycle complete',
      );

      if (failCount === 0) {
        lastCompactedWeek = weekKey;
      } else {
        logger.warn(
          { failCount, totalCount: activeProfiles.length, weekKey },
          'Weekly LTM compaction had channel failures; scheduler will retry this week',
        );
      }
    } catch (error) {
      logger.error({ error, weekKey }, 'Failed to list active profiles for LTM compaction');
    }
  })();

  compactionInFlight = task;
  compactionInFlightWeek = weekKey;

  try {
    await task;
  } finally {
    compactionInFlight = null;
    compactionInFlightWeek = null;
  }
}

export function __resetCompactionStateForTests(): void {
  stopCompactionScheduler();
  compactionInFlight = null;
  compactionInFlightWeek = null;
  lastCompactedWeek = null;
}
