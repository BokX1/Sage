export type RuntimeAutopilotMode = 'reserved' | 'talkative' | null;

type InvocationSource = 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'command';
type ConfiguredAutopilotMode = 'manual' | 'reserved' | 'talkative';

export function resolveRuntimeAutopilotMode(params: {
  invokedBy?: InvocationSource;
  configuredMode: ConfiguredAutopilotMode;
}): RuntimeAutopilotMode {
  const { invokedBy, configuredMode } = params;

  if (invokedBy !== 'autopilot') {
    return null;
  }

  if (configuredMode === 'reserved' || configuredMode === 'talkative') {
    return configuredMode;
  }

  return null;
}
