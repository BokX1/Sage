import { describe, expect, it } from 'vitest';
import {
  buildAgenticStateBlock,
  buildCapabilityPromptSection,
} from '../../../src/core/agentRuntime/capabilityPrompt';

describe('capabilityPrompt', () => {
  describe('buildCapabilityPromptSection', () => {
    it('renders basic single-agent capability guidance', () => {
      // Arrange
      const params = {
        model: 'kimi',
        activeTools: ['web_search', 'web_read'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('<execution_rules>');
      expect(prompt).toContain('Active model: kimi.');
      expect(prompt).toContain('Runtime tools available this turn: web_search, web_read.');
      expect(prompt).toContain('Attachment memory behavior: you do not have access to retrieve historical files this turn.');
      expect(prompt).toContain('Image generation behavior: you do not have image generation capabilities this turn.');
    });

    it('renders tool selection guide for available tools', () => {
      // Arrange
      const params = {
        model: 'kimi',
        activeTools: ['web_search', 'system_time'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('<tool_selection_guide>');
      expect(prompt).toContain('TIME/DATE OFFSET CALCULATION?');
      expect(prompt).toContain('REAL-TIME WEB INFO?');
      expect(prompt).toContain('</tool_selection_guide>');
    });

    it('renders reasoning protocol when tools are active', () => {
      // Arrange
      const params = {
        activeTools: ['web_search'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('<reasoning_protocol>');
      expect(prompt).toContain('think');
      expect(prompt).toContain('</reasoning_protocol>');
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
      expect(prompt).toContain('Attachment memory behavior: historical non-image files are cached outside transcript');
      expect(prompt).toContain('Discord actions (read-only):');
      expect(prompt).toContain('Discord actions (writes; not autopilot):');
      expect(prompt).toContain('Discord actions (admin-only):');
      expect(prompt).toContain('messages.send');
      // Guardrails from discordToolCatalog must be surfaced
      expect(prompt).toContain('Discord guardrail:');
      expect(prompt).toContain('Writes are disallowed in autopilot turns');
    });

    it('renders discord tool selection guide when discord is active', () => {
      // Arrange
      const params = {
        activeTools: ['discord'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('DISCORD MEMORY/DATA?');
      expect(prompt).toContain('discord: memory.get_user');
      expect(prompt).toContain('discord: memory.get_channel');
      expect(prompt).toContain('discord: memory.get_server');
      expect(prompt).toContain('discord: messages.search_history');
      expect(prompt).toContain('discord: analytics.voice_summaries');
      expect(prompt).toContain('discord: oauth2.invite_url');
    });

    it('renders web tool selection with all sub-tools', () => {
      // Arrange
      const params = {
        activeTools: ['web_search', 'web_read', 'web_scrape'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('REAL-TIME WEB INFO?');
      expect(prompt).toContain('web_search');
      expect(prompt).toContain('web_read');
      expect(prompt).toContain('web_scrape');
    });

    it('renders guidance for image generation when tool is active', () => {
      // Arrange
      const params = {
        activeTools: ['image_generate'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('Image generation behavior: use image_generate for image creation/edit requests');
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
  });

  describe('buildAgenticStateBlock', () => {
    it('builds machine-readable agentic state JSON', () => {
      // Arrange
      const params = {
        model: 'kimi',
        activeTools: ['web_search', 'web_read'],
      };

      // Act
      const stateBlock = buildAgenticStateBlock(params);

      // Assert
      expect(stateBlock).toContain('<agent_state>');
      expect(stateBlock).toContain('"architecture": "single_agent"');
      expect(stateBlock).toContain('"orchestrator": "runtime_assistant"');
      expect(stateBlock).toContain('"current_time_utc"');
      expect(stateBlock).toContain('"model": "kimi"');
      expect(stateBlock).toContain('"web_search"');
      expect(stateBlock).toContain('"web_read"');
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
