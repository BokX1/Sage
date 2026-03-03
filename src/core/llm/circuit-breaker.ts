/**
 * @description Implements a basic circuit breaker for external LLM calls.
 */
import { logger } from '../utils/logger';

/**
 * Enumerates values for CircuitState.
 */
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_RESET_TIMEOUT_MS = 60_000;

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

/**
 * Defines the CircuitBreaker class.
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private lastFailureTime = 0;
  private readonly config: CircuitConfig;

  constructor(config: Partial<CircuitConfig> = {}) {
    this.config = {
      failureThreshold: normalizePositiveInt(config.failureThreshold, DEFAULT_FAILURE_THRESHOLD),
      resetTimeoutMs: normalizePositiveInt(config.resetTimeoutMs, DEFAULT_RESET_TIMEOUT_MS),
    };
  }

  async execute<T>(action: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await action();
      // Reset failures on any success to prevent accumulation across separate failure events
      if (this.state === CircuitState.HALF_OPEN || this.failures > 0) {
        this.reset();
      }
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  private recordFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      logger.warn({ failures: this.failures }, '[CircuitBreaker] Opened');
    }
  }

  private reset() {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    logger.info('[CircuitBreaker] Closed/Reset');
  }

  isOpen(): boolean {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        return false;
      }
      return true;
    }
    return false;
  }
}
