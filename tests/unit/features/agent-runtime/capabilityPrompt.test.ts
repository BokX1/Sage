import { describe, expect, it } from 'vitest';
import {
  buildAgenticStateBlock,
  buildCapabilityPromptSection,
} from '../../../../src/features/agent-runtime/capabilityPrompt';

describe('capabilityPrompt', () => {
  describe('buildCapabilityPromptSection', () => {
    it('renders basic single-agent capability guidance', () => {
      // Arrange
      const params = {
        model: 'kimi',
        activeTools: ['web'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('<execution_rules>');
      expect(prompt).toContain('Active model: kimi.');
      expect(prompt).toContain('Runtime tools available this turn: web.');
      expect(prompt).toContain('call that tool\'s `help` action before guessing');
      expect(prompt).toContain('Attachment memory behavior: you do not have access to retrieve historical files this turn.');
      expect(prompt).toContain('Image generation behavior: you do not have image generation capabilities this turn.');
    });

    it('renders compact tool selection guidance for available tools', () => {
      // Arrange
      const params = {
        model: 'kimi',
        activeTools: ['web', 'system_time'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('<tool_selection_guide>');
      expect(prompt).toContain('timezone conversion for a specific utcOffset');
      expect(prompt).toContain('public internet information or fresh sources');
      expect(prompt).toContain('</tool_selection_guide>');
    });

    it('does not render the old reasoning protocol block', () => {
      // Arrange
      const params = {
        activeTools: ['web'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).not.toContain('<reasoning_protocol>');
      expect(prompt).not.toContain('</reasoning_protocol>');
    });

    it('renders guidance for channel file lookup when tool is active', () => {
      // Arrange
      const params = {
        activeTools: ['discord'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('Discord tool behavior: use the `discord` tool with action-based calls');
      expect(prompt).toContain('Attachment memory behavior: historical uploaded attachments are cached outside transcript');
      expect(prompt).toContain('If unsure which Discord action fits, call discord: help.');
      expect(prompt).toContain('files.send_attachment');
      // Guardrails from discordToolCatalog must be surfaced
      expect(prompt).toContain('Discord guardrail:');
      expect(prompt).toContain('Writes are disallowed in autopilot turns');
      expect(prompt).toContain('<reply_format_policy>');
      expect(prompt).toContain('Components V2 may be used freely');
      expect(prompt).toContain('IS_COMPONENTS_V2');
      expect(prompt).toContain('call `discord` action `messages.send` with `presentation="plain" | "legacy_components" | "components_v2"`');
      expect(prompt).toContain('do not repeat the same answer again as a normal assistant reply');
      expect(prompt).toContain('componentsV2.blocks` types: `text`, `section`, `media_gallery`, `file`, `separator`, `action_row`');
    });

    it('renders discord tool selection guide when discord is active', () => {
      // Arrange
      const params = {
        activeTools: ['discord'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('Discord-internal memory, messages, files, social graph, or voice analytics');
      expect(prompt).toContain('messages.search_history / messages.search_with_context');
      expect(prompt).toContain('memory.get_channel');
      expect(prompt).toContain('memory.get_user');
      expect(prompt).toContain('files.read_attachment');
      expect(prompt).toContain('files.send_attachment');
      expect(prompt).toContain('Final Discord-native delivery in the channel → messages.send');
      expect(prompt).toContain('Unsupported Discord reads after typed-action checks → discord.api GET');
    });

    it('renders web tool selection with all sub-tools', () => {
      // Arrange
      const params = {
        activeTools: ['web'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('public internet information or fresh sources');
      expect(prompt).toContain('web (action=search)');
      expect(prompt).toContain('web (action=read)');
      expect(prompt).toContain('web (action=extract)');
    });

    it('keeps key anti-pattern guidance in the smaller tool guide', () => {
      const prompt = buildCapabilityPromptSection({
        activeTools: ['discord', 'web', 'github'],
      });

      expect(prompt).toContain('ANTI-PATTERNS');
      expect(prompt).toContain('exact quotes or message-level evidence');
      expect(prompt).toContain('Discord-internal questions');
      expect(prompt).toContain('discord.api when a typed Discord action already covers the request');
      expect(prompt).toContain('plain assistant prose for a final rich in-channel reply that should be delivered via messages.send');
      expect(prompt).toContain('github file.get before code.search when the path is unknown');
      expect(prompt).toContain('extra tool calls after you already have enough evidence to answer');
    });

    it('renders guidance for image generation when tool is active', () => {
      // Arrange
      const params = {
        activeTools: ['image_generate'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('Image generation behavior: use image_generate for image creation requests (supports optional reference image)');
    });

    it('handles empty or missing model/tools gracefully', () => {
      // Arrange
      const params = {};

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('Active model: unspecified.');
      expect(prompt).toContain('Runtime tools available this turn: none.');
      // No tool_selection_guide or reasoning_protocol when no tools
      expect(prompt).not.toContain('<tool_selection_guide>');
      expect(prompt).not.toContain('<reasoning_protocol>');
    });

    it('is materially shorter than the previous verbose prompt shape', () => {
      const prompt = buildCapabilityPromptSection({
        model: 'kimi',
        activeTools: ['discord', 'web', 'github', 'system_time', 'system_plan', 'image_generate'],
      });

      expect(prompt.length).toBeLessThan(9200);
    });
  });

  describe('buildAgenticStateBlock', () => {
    it('builds machine-readable agentic state JSON', () => {
      // Arrange
      const params = {
        model: 'kimi',
        activeTools: ['web'],
      };

      // Act
      const stateBlock = buildAgenticStateBlock(params);

      // Assert
      expect(stateBlock).toContain('<agent_state>');
      expect(stateBlock).toContain('"architecture": "single_agent"');
      expect(stateBlock).toContain('"orchestrator": "runtime_assistant"');
      expect(stateBlock).toContain('"current_time_utc"');
      expect(stateBlock).toContain('"model": "kimi"');
      expect(stateBlock).toContain('"web"');
    });

    it('includes discord tool capabilities when discord is active', () => {
      // Arrange
      const params = {
        model: 'kimi',
        activeTools: ['discord'],
      };

      // Act
      const stateBlock = buildAgenticStateBlock(params);

      // Assert
      expect(stateBlock).toContain('"tool_capabilities"');
      expect(stateBlock).toContain('"discord"');
      expect(stateBlock).toContain('"read_only_actions"');
      expect(stateBlock).toContain('"write_actions"');
      expect(stateBlock).toContain('"admin_only_actions"');
    });

    it('handles missing params gracefully', () => {
      // Arrange
      const params = {};

      // Act
      const stateBlock = buildAgenticStateBlock(params);

      // Assert
      expect(stateBlock).toContain('"model": null');
      expect(stateBlock).toContain('"tools_available": []');
    });
  });
});
