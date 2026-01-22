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

  increment(name: string, labels: Record<string, string> = {}) {
    const key = this.getKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + 1);
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
    return out;
  },
};
