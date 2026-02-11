import { describe, expect, it } from 'vitest';
import { resolveTenantPolicy } from '../../../src/core/agentRuntime/tenantPolicy';

describe('tenantPolicy', () => {
  it('returns empty policy when no JSON is provided', () => {
    const resolved = resolveTenantPolicy({
      guildId: 'guild-1',
      policyJson: undefined,
    });

    expect(resolved).toEqual({
      maxParallel: undefined,
      criticEnabled: undefined,
      criticMaxLoops: undefined,
      criticMinScore: undefined,
      toolAllowNetworkRead: undefined,
      toolAllowDataExfiltrationRisk: undefined,
      toolAllowExternalWrite: undefined,
      toolAllowHighRisk: undefined,
      toolBlockedTools: undefined,
      toolRiskOverrides: undefined,
      allowedModels: undefined,
    });
  });

  it('merges default and guild policy with normalization', () => {
    const resolved = resolveTenantPolicy({
      guildId: 'guild-1',
      policyJson: JSON.stringify({
        default: {
          maxParallel: 4,
          critic: { enabled: true, maxLoops: 9, minScore: 0.81 },
          tools: {
            allowNetworkRead: true,
            allowDataExfiltrationRisk: true,
            allowExternalWrite: false,
            blockedTools: ['join_voice'],
            riskOverrides: {
              LOCAL_LLM_INFER: 'high_risk',
            },
          },
          allowedModels: ['openai-fast', 'deepseek'],
        },
        guilds: {
          'guild-1': {
            maxParallel: 21,
            critic: { maxLoops: 1 },
            tools: {
              allowNetworkRead: false,
              allowDataExfiltrationRisk: false,
              allowHighRisk: true,
              blockedTools: ['LEAVE_VOICE', 'leave_voice'],
              riskOverrides: {
                web_search: 'data_exfiltration_risk',
              },
            },
            allowedModels: ['Gemini-Fast', 'openai-fast'],
          },
        },
      }),
    });

    expect(resolved.maxParallel).toBe(16);
    expect(resolved.criticEnabled).toBe(true);
    expect(resolved.criticMaxLoops).toBe(1);
    expect(resolved.criticMinScore).toBe(0.81);
    expect(resolved.toolAllowNetworkRead).toBe(false);
    expect(resolved.toolAllowDataExfiltrationRisk).toBe(false);
    expect(resolved.toolAllowExternalWrite).toBe(false);
    expect(resolved.toolAllowHighRisk).toBe(true);
    expect(resolved.toolBlockedTools).toEqual(['join_voice', 'leave_voice']);
    expect(resolved.toolRiskOverrides).toEqual({
      local_llm_infer: 'high_risk',
      web_search: 'data_exfiltration_risk',
    });
    expect(resolved.allowedModels).toEqual(['gemini-fast', 'openai-fast']);
  });

  it('handles invalid JSON safely', () => {
    const resolved = resolveTenantPolicy({
      guildId: 'guild-1',
      policyJson: '{invalid',
    });

    expect(resolved.allowedModels).toBeUndefined();
    expect(resolved.maxParallel).toBeUndefined();
  });
});
