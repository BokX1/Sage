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

function parseChannelList(value: string): Set<string> {
    return new Set(
        value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
    );
}

function isChannelAllowed(channelId: string): boolean {
    const blocklist = parseChannelList(config.LOGGING_BLOCKLIST_CHANNEL_IDS);
    if (blocklist.has(channelId)) return false;

    if (config.LOGGING_MODE === 'allowlist') {
        const allowlist = parseChannelList(config.LOGGING_ALLOWLIST_CHANNEL_IDS);
        return allowlist.has(channelId);
    }

    return true;
}

/**
 * Check if logging is enabled for a guild/channel.
 * Priority: in-memory override > env default
 */
export function isLoggingEnabled(guildId: string, channelId: string): boolean {
    const key = makeKey(guildId, channelId);
    const override = loggingOverrides.get(key);
    if (!config.LOGGING_ENABLED) return false;
    const allowed = isChannelAllowed(channelId);
    if (override !== undefined) return override && allowed;
    return allowed;
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
