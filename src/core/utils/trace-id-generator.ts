import { randomUUID } from 'crypto';

export function generateTraceId(): string {
  return randomUUID();
}
