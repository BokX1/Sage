import { config } from '../config/env';

export function estimateTokens(text: string): number {
    if (config.tokenEstimator === 'heuristic') {
        return Math.ceil(text.length / config.tokenHeuristicCharsPerToken);
    }

    return Math.ceil(text.length / config.tokenHeuristicCharsPerToken);
}
