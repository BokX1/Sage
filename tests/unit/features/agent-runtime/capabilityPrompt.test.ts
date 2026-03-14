import { describe, expect, it } from 'vitest';

import {
  buildAgenticStateBlock,
  buildCapabilityPromptSection,
} from '../../../../src/features/agent-runtime/capabilityPrompt';
import { buildRoutedToolHelp } from '../../../../src/features/agent-runtime/toolDocs';

describe('capabilityPrompt', () => {
  describe('buildCapabilityPromptSection', () => {
    it('renders a compact operator model with help-vs-schema fallback rules', () => {
      const prompt = buildCapabilityPromptSection({
        model: 'kimi',
        activeTools: ['web', 'system_time'],
      });

      expect(prompt).toContain('<operator_model>');
      expect(prompt).toContain('Lock onto the current user\'s objective before room noise.');
      expect(prompt).toContain('Decide the source type: exact evidence, summary context, file recall');
      expect(prompt).toContain('Choose the narrowest active tool for that source.');
      expect(prompt).toContain('Stop when enough evidence exists.');
      expect(prompt).toContain('<execution_rules>');
      expect(prompt).toContain('Read exact runtime facts from <agent_state>');
      expect(prompt).toContain('Routed tools expose action-level `help`: `web`. Use it only when a routed-tool contract is genuinely unclear.');
      expect(prompt).toContain('Direct tools do not expose `help`; rely on schema and description for: `system_time`.');
      expect(prompt).toContain('Batch read-only calls in one provider-native turn when possible.');
      expect(prompt).toContain('If no tool is needed, answer in plain text.');
      expect(prompt).not.toContain('<reasoning_protocol>');
    });

    it('renders compact prompt guidance instead of long action inventories', () => {
      const prompt = buildCapabilityPromptSection({
        activeTools: ['discord_context', 'discord_messages', 'web', 'github', 'workflow'],
      });

      expect(prompt).toContain('<tool_selection_guide>');
      expect(prompt).toContain('DISCORD-FIRST:');
      expect(prompt).toContain('OTHER ACTIVE TOOLS:');
      expect(prompt).toContain('discord_context: Profiles, recaps, relationship context, and Sage Persona reads.');
      expect(prompt).toContain('Room recap, profile context, relationship context, or a guild Sage Persona read -> discord_context.');
      expect(prompt).toContain('discord_messages: Exact message evidence, local message windows, and Discord-native delivery.');
      expect(prompt).toContain('Final in-channel rich or interactive reply -> discord_messages.send.');
      expect(prompt).toContain('web: Fresh public web information and external research.');
      expect(prompt).toContain('github: GitHub repo, code, file, issue, PR, and commit lookup.');
      expect(prompt).toContain('workflow: One-shot wrappers that replace routine multi-hop tool chains.');
      expect(prompt).not.toContain('action_contracts');
      expect(prompt).not.toContain('componentsV2.blocks` types');
    });

    it('keeps the critical Discord disambiguators in the capability prompt', () => {
      const prompt = buildCapabilityPromptSection({
        activeTools: ['discord_context', 'discord_messages', 'discord_files', 'discord_server', 'discord_admin', 'discord_voice'],
      });

      expect(prompt).toContain('Summary vs evidence: `discord_context.get_channel_summary` is rolling recap; exact quotes and message-level proof belong to `discord_messages`.');
      expect(prompt).toContain('Distinguish Sage Persona reads from Sage Persona writes');
      expect(prompt).toContain('Distinguish Sage Persona/config from moderation/enforcement');
      expect(prompt).toContain('Treat reply-targeted enforcement as moderation');
      expect(prompt).toContain('Distinguish file discovery from guild discovery');
      expect(prompt).toContain('Distinguish voice analytics from live voice control');
      expect(prompt).toContain('Typed Discord actions come first. Use `discord_admin.api` only after typed `discord_server` or `discord_admin` actions do not cover the task.');
      expect(prompt).toContain('Plain assistant text is fine for normal answers. Use `discord_messages.send` only when the final answer should be rendered as a Discord-native message inside the channel.');
    });

    it('covers the key routing regressions in the compact guide', () => {
      const prompt = buildCapabilityPromptSection({
        activeTools: ['discord_context', 'discord_messages', 'discord_files', 'discord_server', 'discord_admin', 'discord_voice', 'web'],
      });

      expect(prompt).toContain('Exact quotes, message proof, who-said-what, or local message windows -> discord_messages.');
      expect(prompt).toContain('Change Sage behavior or governance config -> discord_admin.');
      expect(prompt).toContain('Enforce on user or content -> discord_admin.submit_moderation.');
      expect(prompt).toContain('Uploaded files, cached attachment text, or "show that again" -> discord_files.');
      expect(prompt).toContain('Voice status or join or leave -> discord_voice.');
      expect(prompt).toContain('Do not use web for Discord-internal facts.');
      expect(prompt).toContain('Do not use generic delete_message for reply-targeted spam or abuse when submit_moderation fits better.');
    });

    it('keeps reply-format guidance lean while preserving components rules', () => {
      const prompt = buildCapabilityPromptSection({
        activeTools: ['discord_messages', 'discord_admin'],
      });

      expect(prompt).toContain('<reply_format_policy>');
      expect(prompt).toContain('Use plain send payloads for short conversational replies or simple status updates.');
      expect(prompt).toContain('Use `presentation="components_v2"` only when structure, grouped evidence, files, or guided next actions materially improve the reply.');
      expect(prompt).toContain('If you are not using Discord-native send, answer normally in plain text.');
      expect(prompt).toContain('Components V2 requires the `IS_COMPONENTS_V2` flag.');
      expect(prompt).toContain('When using Components V2, do not combine it with `content`, `embeds`, `poll`, or `stickers` in the same message.');
    });

    it('keeps full routed action detail in help rather than the always-on prompt', () => {
      const prompt = buildCapabilityPromptSection({
        activeTools: ['discord_messages'],
      });
      const help = buildRoutedToolHelp('discord_messages');
      const actionContracts = help.action_contracts as Array<Record<string, unknown>>;

      expect(prompt).not.toContain('action_contracts');
      expect(help.tool).toBe('discord_messages');
      expect(help.type).toBe('routed_tool_help');
      expect(actionContracts.length).toBeGreaterThan(5);
      expect(actionContracts.some((contract) => contract.action === 'send')).toBe(true);
    });

    it('enforces the tighter prompt-size ceilings', () => {
      const commonPrompt = buildCapabilityPromptSection({
        model: 'kimi',
        activeTools: [
          'discord_context',
          'discord_messages',
          'discord_files',
          'discord_server',
          'discord_voice',
          'web',
          'github',
          'workflow',
          'npm_info',
          'wikipedia_search',
          'stack_overflow_search',
          'system_time',
          'system_tool_stats',
          'image_generate',
        ],
        invokedBy: 'mention',
        invokerIsAdmin: false,
        inGuild: true,
        turnMode: 'text',
        autopilotMode: null,
        graphLimits: {
          maxRounds: 6,
          maxCallsPerRound: 5,
        },
      });
      const fullPrompt = buildCapabilityPromptSection({
        model: 'kimi',
        activeTools: [
          'discord_context',
          'discord_messages',
          'discord_files',
          'discord_server',
          'discord_voice',
          'discord_admin',
          'web',
          'github',
          'workflow',
          'npm_info',
          'wikipedia_search',
          'stack_overflow_search',
          'system_time',
          'system_tool_stats',
          'image_generate',
        ],
        invokedBy: 'mention',
        invokerIsAdmin: true,
        inGuild: true,
        turnMode: 'text',
        autopilotMode: null,
        graphLimits: {
          maxRounds: 6,
          maxCallsPerRound: 5,
        },
      });

      expect(commonPrompt.length).toBeLessThan(9500);
      expect(fullPrompt.length).toBeLessThan(11000);
    });

    it('handles empty or missing model/tools gracefully', () => {
      const prompt = buildCapabilityPromptSection({});

      expect(prompt).toContain('<operator_model>');
      expect(prompt).toContain('Read exact runtime facts from <agent_state>');
      expect(prompt).not.toContain('<tool_selection_guide>');
      expect(prompt).not.toContain('<reasoning_protocol>');
    });
  });

  describe('buildAgenticStateBlock', () => {
    it('builds machine-readable agentic state JSON', () => {
      const stateBlock = buildAgenticStateBlock({
        model: 'kimi',
        activeTools: ['web'],
      });

      expect(stateBlock).toContain('<agent_state>');
      expect(stateBlock).toContain('"current_time_utc"');
      expect(stateBlock).toContain('"model": "kimi"');
      expect(stateBlock).toContain('"tools_available": [\n    "web"\n  ]');
      expect(stateBlock).toContain('"turn_mode": "text"');
      expect(stateBlock).toContain('"autopilot_mode": null');
      expect(stateBlock).toContain('"graph_limits": null');
      expect(stateBlock).not.toContain('"architecture"');
      expect(stateBlock).not.toContain('"orchestrator"');
      expect(stateBlock).not.toContain('"tool_capabilities"');
    });

    it('includes compact turn facts and snake_case graph limits', () => {
      const stateBlock = buildAgenticStateBlock({
        model: 'kimi',
        activeTools: ['discord_messages'],
        invokedBy: 'autopilot',
        invokerIsAdmin: false,
        inGuild: true,
        turnMode: 'voice',
        autopilotMode: 'reserved',
        graphLimits: {
          maxRounds: 6,
          maxCallsPerRound: 5,
        },
      });

      expect(stateBlock).toContain('"discord_messages"');
      expect(stateBlock).toContain('"invoked_by": "autopilot"');
      expect(stateBlock).toContain('"invoker_is_admin": false');
      expect(stateBlock).toContain('"in_guild": true');
      expect(stateBlock).toContain('"turn_mode": "voice"');
      expect(stateBlock).toContain('"autopilot_mode": "reserved"');
      expect(stateBlock).toContain('"max_steps": 6');
      expect(stateBlock).toContain('"max_tool_calls_per_step": 5');
      expect(stateBlock).not.toContain('"parallel_read_only_tools"');
      expect(stateBlock).not.toContain('"max_parallel_read_only_tools"');
    });
  });
});
