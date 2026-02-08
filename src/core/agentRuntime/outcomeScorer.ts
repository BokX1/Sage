export interface OutcomeScorerInput {
  routeKind: string;
  replyText: string;
  toolJson?: unknown;
  qualityJson?: unknown;
  budgetJson?: unknown;
}

export interface OutcomeScore {
  score: number;
  successLikely: boolean;
  riskFlags: string[];
  notes: string[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function readNumber(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== 'object') return null;
  const val = (obj as Record<string, unknown>)[key];
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num)) return null;
  return num;
}

export function scoreTraceOutcome(input: OutcomeScorerInput): OutcomeScore {
  const riskFlags: string[] = [];
  const notes: string[] = [];

  let score = 0.7;
  const reply = input.replyText.trim();

  if (!reply) {
    score -= 0.45;
    riskFlags.push('empty_reply');
    notes.push('Reply text is empty.');
  }

  if (reply.includes("I'm having trouble connecting")) {
    score -= 0.5;
    riskFlags.push('runtime_fallback');
    notes.push('Runtime fallback response detected.');
  }

  const criticList =
    input.qualityJson && typeof input.qualityJson === 'object'
      ? (input.qualityJson as Record<string, unknown>).critic
      : null;
  if (Array.isArray(criticList) && criticList.length > 0) {
    const last = criticList[criticList.length - 1];
    const criticScore =
      last && typeof last === 'object' ? readNumber(last, 'score') : null;
    if (criticScore !== null) {
      if (criticScore < 0.5) {
        score -= 0.25;
        riskFlags.push('low_critic_score');
      } else if (criticScore > 0.8) {
        score += 0.05;
      }
      notes.push(`Critic score: ${criticScore.toFixed(2)}.`);
    }
  }

  const failedTasks = readNumber(input.budgetJson, 'failedTasks');
  if (failedTasks !== null && failedTasks > 0) {
    score -= Math.min(0.3, failedTasks * 0.1);
    riskFlags.push('agent_failures');
    notes.push(`Graph reported ${failedTasks} failed task(s).`);
  }

  const toolsExecuted =
    input.toolJson && typeof input.toolJson === 'object'
      ? (input.toolJson as Record<string, unknown>).executed
      : null;
  if (toolsExecuted === true) {
    score += 0.03;
    notes.push('Tools executed for this turn.');
  }

  if (input.routeKind === 'search' && !reply.toLowerCase().includes('source')) {
    riskFlags.push('search_no_sources_hint');
    score -= 0.06;
  }

  const normalized = clamp01(score);
  return {
    score: normalized,
    successLikely: normalized >= 0.6,
    riskFlags: Array.from(new Set(riskFlags)),
    notes,
  };
}
