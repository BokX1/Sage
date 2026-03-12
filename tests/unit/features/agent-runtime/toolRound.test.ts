import { describe, expect, it } from 'vitest';
import { formatToolResultsMessage } from '../../../../src/features/agent-runtime/langgraph/toolRound';

describe('formatToolResultsMessage', () => {
  it('injects bounded repair guidance for routed-tool validation failures', () => {
    const message = formatToolResultsMessage(
      [
        {
          name: 'github',
          success: false,
          error: 'Invalid arguments for tool "github": action: Invalid input',
          errorType: 'validation',
          errorDetails: {
            category: 'validation',
            retryable: false,
            hint: 'Try: { action: "help" } to see available actions and example payloads.',
            repair: {
              tool: 'github',
              kind: 'unknown_action',
              suggestedActions: ['repo.get', 'code.search', 'help'],
              actionContract: {
                action: 'repo.get',
                purpose: 'Lookup GitHub repository metadata and optionally include README.',
                requiredFields: ['action', 'repo'],
                optionalFields: ['includeReadme'],
                commonMistakes: ['Use code.search first when the repo path is unknown.'],
              },
              nextStepHint:
                'Action "repo.gt" is not valid for github. Use one of the suggested actions instead, or call github with { action: "help" } first.',
            },
          },
          latencyMs: 12,
        },
      ],
      4_000,
    );

    expect(message.role).toBe('user');
    expect(message.content).toContain('retryable=false');
    expect(message.content).toContain('github.recovery');
    expect(message.content).toContain('repair_guidance');
    expect(message.content).toContain('&quot;kind&quot;:&quot;unknown_action&quot;');
    expect(message.content).toContain('&quot;suggestedActions&quot;:[&quot;repo.get&quot;,&quot;code.search&quot;,&quot;help&quot;]');
    expect(message.content).toContain('&quot;action&quot;:&quot;repo.get&quot;');
    expect(message.content).toContain('&quot;hint&quot;:&quot;Try: { action: \\&quot;help\\&quot; }');
    expect(message.content).not.toContain('examples');
  });
});
