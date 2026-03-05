import {
  clearPendingAdminActionApprovalMessageId,
  listPendingAdminActionsWithApprovalCardsReadyForDeletion,
} from '../../core/admin/pendingAdminActionRepo';
import { discordRestRequestGuildScoped } from '../../core/discord/discordRestPolicy';
import { logger } from '../../core/utils/logger';

const CLEANUP_INTERVAL_MS = 60_000;
const CLEANUP_BATCH_LIMIT = 50;

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.VITEST_WORKER_ID !== undefined
  );
}
export function initApprovalCardCleanupScheduler(): void {
  if (isTestRuntime()) {
    return;
  }

  let running = false;

  const runOnce = async () => {
    if (running) return;
    running = true;

    try {
      const resolvedBefore = new Date(Date.now() - CLEANUP_INTERVAL_MS);
      const actions = await listPendingAdminActionsWithApprovalCardsReadyForDeletion({
        resolvedBefore,
        limit: CLEANUP_BATCH_LIMIT,
      });

      for (const action of actions) {
        const approvalMessageId = action.approvalMessageId?.trim();
        if (!approvalMessageId) {
          continue;
        }

        try {
          const result = await discordRestRequestGuildScoped({
            guildId: action.guildId,
            method: 'DELETE',
            path: `/channels/${action.channelId}/messages/${approvalMessageId}`,
            reason: `[sage action:${action.id}] auto-delete resolved approval card`,
            maxResponseChars: 500,
          });

          const status = typeof result.status === 'number' ? result.status : null;
          const shouldClear =
            result.ok === true ||
            status === 404 ||
            status === 403;

          if (shouldClear) {
            await clearPendingAdminActionApprovalMessageId(action.id).catch((error) => {
              logger.warn({ error, actionId: action.id }, 'Failed to clear approval message id after cleanup deletion');
            });
          } else if (status !== 429) {
            logger.warn(
              {
                actionId: action.id,
                guildId: action.guildId,
                channelId: action.channelId,
                approvalMessageId,
                status,
                statusText: typeof result.statusText === 'string' ? result.statusText : undefined,
                errorText: typeof result.error === 'string' ? result.error : undefined,
              },
              'Approval card cleanup failed to delete message',
            );
          }
        } catch (error) {
          logger.warn(
            { error, actionId: action.id, guildId: action.guildId, channelId: action.channelId },
            'Approval card cleanup threw; clearing id to avoid repeated attempts',
          );

          await clearPendingAdminActionApprovalMessageId(action.id).catch(() => {
            // Ignore cleanup failures.
          });
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Approval card cleanup scheduler run failed');
    } finally {
      running = false;
    }
  };

  void runOnce();

  const timer = setInterval(() => {
    void runOnce();
  }, CLEANUP_INTERVAL_MS);
  timer.unref?.();
}
