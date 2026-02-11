import { ManagerWorkerAggregate, ManagerWorkerArtifact } from './managerWorkerTypes';

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

export function aggregateManagerWorkerArtifacts(params: {
  artifacts: ManagerWorkerArtifact[];
  maxChars?: number;
}): ManagerWorkerAggregate {
  const maxChars = Math.max(1_000, Math.floor(params.maxChars ?? 6_000));
  const successful = params.artifacts.filter((artifact) => !artifact.failed);
  const citations = unique(successful.flatMap((artifact) => artifact.citations)).slice(0, 12);

  if (successful.length === 0) {
    return {
      contextBlock: '',
      successfulWorkers: 0,
      failedWorkers: params.artifacts.length,
      citationCount: 0,
    };
  }

  const sections: string[] = ['## Manager-Worker Findings'];
  for (const artifact of successful) {
    const keyPoints = unique(artifact.keyPoints).slice(0, 5);
    const openQuestions = unique(artifact.openQuestions).slice(0, 3);
    const label = `[${artifact.worker}]`;
    sections.push(`${label} ${artifact.summary}`);
    if (keyPoints.length > 0) {
      sections.push(`Key points: ${keyPoints.join(' | ')}`);
    }
    if (openQuestions.length > 0) {
      sections.push(`Open questions: ${openQuestions.join(' | ')}`);
    }
  }
  if (citations.length > 0) {
    sections.push(`Candidate sources: ${citations.join(' ')}`);
  }

  const contextBlock = truncate(sections.join('\n'), maxChars);
  return {
    contextBlock,
    successfulWorkers: successful.length,
    failedWorkers: params.artifacts.length - successful.length,
    citationCount: citations.length,
  };
}
