import {
  ComponentType,
  MessageFlags,
  SeparatorSpacingSize,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIContainerComponent,
  type APIMessageTopLevelComponent,
  type APISeparatorComponent,
  type APITextDisplayComponent,
} from 'discord.js';
import { buildActionButtonComponent } from './interactiveComponentService';

type RuntimeCardTone = 'continue' | 'retry' | 'error' | 'notice';

type RuntimeCardButton = {
  customId: string;
  label: string;
  style?: 'primary' | 'secondary' | 'success' | 'danger';
};

const RUNTIME_CARD_ACCENTS: Record<RuntimeCardTone, number> = {
  continue: 0x2d5016,
  retry: 0x8a5a10,
  error: 0x8b2e1d,
  notice: 0x365f91,
};

type RuntimeReplyFile = {
  attachment: Buffer;
  name: string;
};

function buildTextDisplay(content: string): APITextDisplayComponent {
  return {
    type: ComponentType.TextDisplay,
    content,
  };
}

function buildSeparator(): APISeparatorComponent {
  return {
    type: ComponentType.Separator,
    divider: true,
    spacing: SeparatorSpacingSize.Small,
  };
}

function buildActionRow(button: RuntimeCardButton): APIActionRowComponent<APIButtonComponent> {
  return {
    type: ComponentType.ActionRow,
    components: [
      buildActionButtonComponent({
        customId: button.customId,
        label: button.label,
        style: button.style ?? 'primary',
      }),
    ],
  };
}

export function buildRuntimeResponseCardPayload(params: {
  text: string;
  tone?: RuntimeCardTone;
  button?: RuntimeCardButton | null;
  files?: RuntimeReplyFile[];
  ephemeral?: boolean;
  allowedMentions?: {
    repliedUser?: boolean;
  };
}): {
  flags: number;
  components: APIMessageTopLevelComponent[];
  files?: RuntimeReplyFile[];
  allowedMentions?: {
    repliedUser?: boolean;
  };
} {
  const components: APIContainerComponent['components'] = [buildTextDisplay(params.text)];
  if (params.button) {
    components.push(buildSeparator(), buildActionRow(params.button));
  }

  const container: APIContainerComponent = {
    type: ComponentType.Container,
    accent_color: RUNTIME_CARD_ACCENTS[params.tone ?? 'notice'],
    components,
  };

  return {
    flags: Number(MessageFlags.IsComponentsV2) | (params.ephemeral ? Number(MessageFlags.Ephemeral) : 0),
    components: [container],
    files: params.files,
    allowedMentions: params.allowedMentions,
  };
}
