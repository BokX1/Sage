/**
 * Track lightweight in-memory counters for debugging and diagnostics.
 *
 * Details: stores counters in-process with label serialization for simple
 * metric keys.
 *
 * Side effects: mutates in-memory counter state.
 * Error behavior: none.
 */
export const metrics = {
  counters: new Map<string, number>(),
  histograms: new Map<string, { sum: number; count: number }>(),

  increment(name: string, labels: Record<string, string> = {}) {
    const key = this.getKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + 1);
  },

  /** Record a numeric observation (e.g. latency) for a named histogram. */
  histogram(name: string, value: number, labels: Record<string, string> = {}) {
    const key = this.getKey(name, labels);
    const existing = this.histograms.get(key) ?? { sum: 0, count: 0 };
    existing.sum += value;
    existing.count += 1;
    this.histograms.set(key, existing);
  },

  getKey(name: string, labels: Record<string, string>) {
    const labelStr = Object.entries(labels)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  },

  dump(): string {
    let out = '';
    for (const [key, val] of this.counters) {
      out += `${key}: ${val}\n`;
    }
    for (const [key, val] of this.histograms) {
      const avg = val.count > 0 ? (val.sum / val.count).toFixed(1) : '0';
      out += `${key}: sum=${val.sum.toFixed(1)} count=${val.count} avg=${avg}\n`;
    }
    return out;
  },
};
