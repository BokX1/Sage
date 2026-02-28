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
        activeTools: ['web_search', 'web_get_page_text'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('<execution_rules>');
      expect(prompt).toContain('- Architecture: single-agent orchestrator with iterative tool calling.');
      expect(prompt).toContain('- Active model: kimi.');
      expect(prompt).toContain('- Runtime tools available this turn: web_search, web_get_page_text.');
      expect(prompt).toContain('Attachment memory behavior: you do not have access to retrieve historical files this turn.');
      expect(prompt).toContain('Image generation behavior: you do not have image generation capabilities this turn.');
    });

    it('renders guidance for channel file lookup when tool is active', () => {
      // Arrange
      const params = {
        activeTools: ['discord_lookup_channel_files'],
      };

      // Act
      const prompt = buildCapabilityPromptSection(params);

      // Assert
      expect(prompt).toContain('Attachment memory behavior: historical non-image files are cached outside transcript');
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
      expect(prompt).toContain('- Active model: unspecified.');
      expect(prompt).toContain('- Runtime tools available this turn: none.');
    });
  });

  describe('buildAgenticStateBlock', () => {
    it('builds machine-readable agentic state JSON', () => {
      // Arrange
      const params = {
        model: 'kimi',
        activeTools: ['web_search', 'web_get_page_text'],
      };

      // Act
      const stateBlock = buildAgenticStateBlock(params);

      // Assert
      expect(stateBlock).toContain('<agent_state>');
      expect(stateBlock).toContain('"architecture": "single_agent"');
      expect(stateBlock).toContain('"orchestrator": "runtime_assistant"');
      expect(stateBlock).toContain('"model": "kimi"');
      expect(stateBlock).toContain('"web_search"');
      expect(stateBlock).toContain('"web_get_page_text"');
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
