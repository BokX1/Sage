import { ExpertName } from './experts/types';

export type RouteKind =
  | 'summarize'
  | 'qa'
  | 'admin'
  | 'voice_analytics'
  | 'social_graph'
  | 'memory';

export interface RouteDecision {
  kind: RouteKind;
  experts: ExpertName[];
  allowTools: boolean;
  temperature: number;
  notes?: string;
}

export interface DecideRouteParams {
  userText: string;
  invokedBy: 'mention' | 'reply' | 'wakeword' | 'command';
  hasGuild: boolean;
}

/**
 * Deterministic intent classifier.
 * Routes user requests to appropriate experts and LLM parameters.
 */
export function decideRoute(params: DecideRouteParams): RouteDecision {
  const { userText, invokedBy, hasGuild } = params;
  const normalized = userText.toLowerCase();

  // Route: Summarize
  if (
    /\b(summarize|recap|tldr|sum up|summary)\b/i.test(normalized) ||
    /what (are|were) (they|you all|people|we) (talking|discussing) about/i.test(normalized)
  ) {
    return {
      kind: 'summarize',
      experts: ['Summarizer', 'Memory'],
      allowTools: false,
      temperature: 0.3,
      notes: 'Summarization request detected',
    };
  }

  // Route: Voice Analytics
  if (
    /\b(who'?s? in voice|who in voice|in vc|voice channel)\b/i.test(normalized) ||
    /\bhow long.*voice (today|this session)\b/i.test(normalized) ||
    /\b(voice|vc) time (today|this week)\b/i.test(normalized) ||
    /\bjoined voice\b/i.test(normalized)
  ) {
    return {
      kind: 'voice_analytics',
      experts: ['VoiceAnalytics', 'Memory'],
      allowTools: false,
      temperature: 0.5,
      notes: 'Voice analytics query detected',
    };
  }

  // Route: Social Graph
  if (
    /\b(who'?s? working with|relationship|closest to|whoiswho)\b/i.test(normalized) ||
    /\b(social graph|connections|network)\b/i.test(normalized) ||
    /\bwho (knows|talks to|works with)\b/i.test(normalized)
  ) {
    return {
      kind: 'social_graph',
      experts: ['SocialGraph', 'Memory'],
      allowTools: false,
      temperature: 0.5,
      notes: 'Social graph query detected',
    };
  }

  // Route: Memory
  if (
    /\b(remember|do i like|my preference|what do you know about me)\b/i.test(normalized) ||
    /\bwhat (have you learned|do you remember) about me\b/i.test(normalized)
  ) {
    return {
      kind: 'memory',
      experts: ['Memory'],
      allowTools: false,
      temperature: 0.6,
      notes: 'Memory query detected',
    };
  }

  // Route: Admin
  if (
    (invokedBy === 'command' && hasGuild) ||
    /\b(admin|configure|settings|manage)\b/i.test(normalized)
  ) {
    return {
      kind: 'admin',
      experts: ['SocialGraph', 'VoiceAnalytics', 'Memory'],
      allowTools: true,
      temperature: 0.4,
      notes: 'Admin context detected',
    };
  }

  // Route: QA (default)
  return {
    kind: 'qa',
    experts: ['Memory'],
    allowTools: true,
    temperature: 0.7,
    notes: 'Default Q&A route',
  };
}
