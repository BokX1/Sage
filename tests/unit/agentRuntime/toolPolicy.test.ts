import { describe, expect, it } from 'vitest';
import {
  classifyToolRisk,
  evaluateToolPolicy,
  parseToolBlocklistCsv,
} from '../../../src/core/agentRuntime/toolPolicy';

describe('toolPolicy', () => {
  it('classifies known side-effect tools', () => {
    expect(classifyToolRisk('join_voice')).toBe('external_write');
    expect(classifyToolRisk('leave_voice')).toBe('external_write');
    expect(classifyToolRisk('get_time')).toBe('read_only');
  });

  it('denies blocked and side-effect tools when disabled', () => {
    const blocked = evaluateToolPolicy('get_time', {
      allowExternalWrite: false,
      allowHighRisk: false,
      blockedTools: ['get_time'],
    });
    expect(blocked.allow).toBe(false);

    const sideEffect = evaluateToolPolicy('join_voice', {
      allowExternalWrite: false,
      allowHighRisk: false,
      blockedTools: [],
    });
    expect(sideEffect.allow).toBe(false);
    expect(sideEffect.risk).toBe('external_write');
  });

  it('parses blocklist csv safely', () => {
    expect(parseToolBlocklistCsv('a,b , c')).toEqual(['a', 'b', 'c']);
    expect(parseToolBlocklistCsv('')).toEqual([]);
    expect(parseToolBlocklistCsv(undefined)).toEqual([]);
  });
});
