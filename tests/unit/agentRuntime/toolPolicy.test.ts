import { describe, expect, it } from 'vitest';
import {
  classifyToolRisk,
  evaluateToolPolicy,
  mergeToolPolicyConfig,
  parseToolBlocklistCsv,
  parseToolPolicyJson,
} from '../../../src/core/agentRuntime/toolPolicy';

describe('toolPolicy', () => {
  it('classifies known tools across expanded risk taxonomy', () => {
    expect(classifyToolRisk('web_search')).toBe('network_read');
    expect(classifyToolRisk('channel_file_lookup')).toBe('data_exfiltration_risk');
    expect(classifyToolRisk('join_voice')).toBe('external_write');
    expect(classifyToolRisk('leave_voice_channel')).toBe('external_write');
    expect(classifyToolRisk('get_time')).toBe('high_risk');
  });

  it('applies risk override precedence over declared metadata', () => {
    const risk = classifyToolRisk(
      'web_search',
      {
        riskOverrides: { web_search: 'high_risk' },
      },
      'network_read',
    );
    expect(risk).toBe('high_risk');
  });

  it('denies blocked and gated risk classes deterministically', () => {
    const blocked = evaluateToolPolicy('web_search', {
      blockedTools: ['web_search'],
      allowNetworkRead: true,
      allowDataExfiltrationRisk: true,
      allowExternalWrite: false,
      allowHighRisk: false,
    });
    expect(blocked.allow).toBe(false);
    expect(blocked.code).toBe('blocked_tool');

    const networkDenied = evaluateToolPolicy('web_search', {
      allowNetworkRead: false,
      allowDataExfiltrationRisk: true,
      allowExternalWrite: false,
      allowHighRisk: false,
    });
    expect(networkDenied.allow).toBe(false);
    expect(networkDenied.code).toBe('network_read_disabled');

    const exfilDenied = evaluateToolPolicy('channel_file_lookup', {
      allowNetworkRead: true,
      allowDataExfiltrationRisk: false,
      allowExternalWrite: false,
      allowHighRisk: false,
    });
    expect(exfilDenied.allow).toBe(false);
    expect(exfilDenied.code).toBe('data_exfiltration_disabled');

    const unclassifiedDenied = evaluateToolPolicy('get_time', {
      allowNetworkRead: true,
      allowDataExfiltrationRisk: true,
      allowExternalWrite: false,
      allowHighRisk: false,
    });
    expect(unclassifiedDenied.allow).toBe(false);
    expect(unclassifiedDenied.code).toBe('unclassified_tool_high_risk');
  });

  it('parses AGENTIC_TOOL_POLICY_JSON in direct and wrapped forms', () => {
    const direct = parseToolPolicyJson(
      JSON.stringify({
        allowNetworkRead: false,
        blockedTools: ['web_search'],
        riskOverrides: { local_llm_infer: 'high_risk' },
      }),
    );
    expect(direct).toEqual({
      allowNetworkRead: false,
      allowDataExfiltrationRisk: undefined,
      allowExternalWrite: undefined,
      allowHighRisk: undefined,
      blockedTools: ['web_search'],
      riskOverrides: { local_llm_infer: 'high_risk' },
    });

    const wrapped = parseToolPolicyJson(
      JSON.stringify({
        default: {
          allowHighRisk: true,
          blockedTools: 'leave_voice, join_voice',
        },
      }),
    );
    expect(wrapped).toEqual({
      allowNetworkRead: undefined,
      allowDataExfiltrationRisk: undefined,
      allowExternalWrite: undefined,
      allowHighRisk: true,
      blockedTools: ['leave_voice', 'join_voice'],
      riskOverrides: undefined,
    });
  });

  it('fails closed when AGENTIC_TOOL_POLICY_JSON is invalid JSON', () => {
    const parsed = parseToolPolicyJson('{bad json');
    expect(parsed).toEqual({
      allowNetworkRead: false,
      allowDataExfiltrationRisk: false,
      allowExternalWrite: false,
      allowHighRisk: false,
      blockedTools: [],
    });
  });

  it('merges policy overlays with deterministic blocklist/risk override behavior', () => {
    const merged = mergeToolPolicyConfig(
      {
        allowNetworkRead: true,
        allowDataExfiltrationRisk: true,
        allowExternalWrite: false,
        allowHighRisk: false,
        blockedTools: ['join_voice'],
        riskOverrides: { local_llm_infer: 'high_risk' },
      },
      {
        allowNetworkRead: false,
        blockedTools: ['leave_voice', 'join_voice'],
        riskOverrides: { web_search: 'data_exfiltration_risk' },
      },
    );
    expect(merged).toEqual({
      allowNetworkRead: false,
      allowDataExfiltrationRisk: true,
      allowExternalWrite: false,
      allowHighRisk: false,
      blockedTools: ['join_voice', 'leave_voice'],
      riskOverrides: {
        local_llm_infer: 'high_risk',
        web_search: 'data_exfiltration_risk',
      },
    });
  });

  it('parses blocklist csv safely', () => {
    expect(parseToolBlocklistCsv('a,b , c')).toEqual(['a', 'b', 'c']);
    expect(parseToolBlocklistCsv('')).toEqual([]);
    expect(parseToolBlocklistCsv(undefined)).toEqual([]);
  });
});
