import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../../src/features/agent-runtime/defaultTools';

describe('default agentic tools', () => {
  it('registers only the bridge-native Code Mode surface and stays idempotent', async () => {
    const registry = new ToolRegistry();

    await registerDefaultAgenticTools(registry);
    await registerDefaultAgenticTools(registry);

    expect(registry.listNames()).toEqual(['runtime_execute_code']);
  });

  it('keeps runtime_execute_code on the runtime class with a large observation budget', async () => {
    const registry = new ToolRegistry();
    await registerDefaultAgenticTools(registry);

    const tool = registry.get('runtime_execute_code');
    expect(tool?.runtime.class).toBe('runtime');
    expect(tool?.runtime.observationPolicy).toBe('large');
    expect(tool?.runtime.capabilityTags).toEqual(
      expect.arrayContaining(['code_mode_surface', 'code_mode']),
    );
  });
});
