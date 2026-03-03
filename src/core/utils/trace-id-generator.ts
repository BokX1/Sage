/**
 * @module src/core/utils/trace-id-generator
 * @description Defines the trace id generator module.
 */
import { randomUUID } from 'crypto';

/**
 * Runs generateTraceId.
 *
 * @returns Returns the function result.
 */
export function generateTraceId(): string {
  return randomUUID();
}
