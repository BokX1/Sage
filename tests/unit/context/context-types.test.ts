import { describe, expect, it } from 'vitest';
import {
  resolveContextProviderSet,
  withRequiredContextProviders,
} from '../../../src/core/context/context-types';

describe('context-types', () => {
  it('deduplicates valid providers in order', () => {
    const providers = resolveContextProviderSet({
      providers: ['UserMemory', 'ChannelMemory', 'UserMemory', 'SocialGraph'],
      fallback: ['UserMemory', 'ChannelMemory'],
    });

    expect(providers).toEqual(['UserMemory', 'ChannelMemory', 'SocialGraph']);
  });

  it('uses fallback providers when none are provided', () => {
    const providers = resolveContextProviderSet({
      providers: undefined,
      fallback: ['UserMemory', 'ChannelMemory'],
    });

    expect(providers).toEqual(['UserMemory', 'ChannelMemory']);
  });

  it('falls back when provided provider names are invalid at runtime', () => {
    const providers = resolveContextProviderSet({
      providers: ['Memory', 'Summarizer'] as unknown as Array<
        'UserMemory' | 'ChannelMemory' | 'SocialGraph' | 'VoiceAnalytics'
      >,
      fallback: ['UserMemory', 'ChannelMemory'],
    });

    expect(providers).toEqual(['UserMemory', 'ChannelMemory']);
  });

  it('adds required providers while preserving optional providers', () => {
    const providers = withRequiredContextProviders({
      providers: ['SocialGraph'],
      required: ['UserMemory', 'ChannelMemory'],
    });

    expect(providers).toEqual(['UserMemory', 'ChannelMemory', 'SocialGraph']);
  });

  it('deduplicates required providers already present in runtime providers', () => {
    const providers = withRequiredContextProviders({
      providers: ['ChannelMemory', 'VoiceAnalytics', 'UserMemory'],
      required: ['UserMemory', 'ChannelMemory'],
    });

    expect(providers).toEqual(['UserMemory', 'ChannelMemory', 'VoiceAnalytics']);
  });
});
