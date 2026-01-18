import { config } from '../../config';

/**
 * In-memory override maps for guild/channel-specific settings.
 * These will be migrated to DB in a future phase.
 */
const loggingOverrides = new Map<string, boolean>();
const proactiveOverrides = new Map<string, boolean>();

/**
 * Generate a key for guild+channel lookups.
 */
function makeKey(guildId: string, channelId: string): string {
    return `${guildId}:${channelId}`;
}

/**
 * Check if logging is enabled for a guild/channel.
 * Priority: in-memory override > env default
 */
export function isLoggingEnabled(guildId: string, channelId: string): boolean {
    const key = makeKey(guildId, channelId);
    const override = loggingOverrides.get(key);
    if (override !== undefined) return override;
    return config.LOGGING_ENABLED;
}

/**
 * Check if proactive posting is enabled for a guild/channel.
 * Priority: in-memory override > env default
 */
export function isProactiveEnabled(guildId: string, channelId: string): boolean {
    const key = makeKey(guildId, channelId);
    const override = proactiveOverrides.get(key);
    if (override !== undefined) return override;
    return config.PROACTIVE_POSTING_ENABLED;
}

/**
 * Set logging override for a guild/channel.
 * (For future admin commands; not used in D1)
 */
export function setLoggingEnabled(guildId: string, channelId: string, enabled: boolean): void {
    const key = makeKey(guildId, channelId);
    loggingOverrides.set(key, enabled);
}

/**
 * Set proactive override for a guild/channel.
 * (For future admin commands; not used in D1)
 */
export function setProactiveEnabled(guildId: string, channelId: string, enabled: boolean): void {
    const key = makeKey(guildId, channelId);
    proactiveOverrides.set(key, enabled);
}

/**
 * Clear all overrides (for testing or reset).
 */
export function clearAllOverrides(): void {
    loggingOverrides.clear();
    proactiveOverrides.clear();
}
