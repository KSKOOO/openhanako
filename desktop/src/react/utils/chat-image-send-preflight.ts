import { isImageFile } from './format';

export interface ChatImageAttachment {
  path: string;
  name: string;
  isDirectory?: boolean;
}

export interface ChatImageModel {
  id?: string;
  provider?: string;
  input?: readonly string[];
}

export interface VisionAuxiliaryConfig {
  enabled: boolean;
  model: unknown;
}

export type ModelImageInputMode = 'native-image' | 'text-only' | 'unknown';

export type ChatImageSendPreflightResult =
  | {
    ok: true;
    reason: 'no-images' | 'native-image' | 'unknown-model-capability' | 'auxiliary-vision';
    imageInputMode: ModelImageInputMode;
  }
  | {
    ok: false;
    reason: 'text-model-image-without-auxiliary';
    imageInputMode: 'text-only';
  };

export type ChatImageBlockedToast = (
  text: string,
  type: 'warning',
  duration: number,
  opts: {
    dedupeKey: string;
    action: {
      label: string;
      onClick: () => void;
    };
  },
) => void;

export function hasChatImageAttachments(attachments: readonly ChatImageAttachment[]): boolean {
  return attachments.some((file) => !file.isDirectory && isImageFile(file.name));
}

export function getModelImageInputMode(model: ChatImageModel | null | undefined): ModelImageInputMode {
  const input = model?.input;
  if (!Array.isArray(input)) return 'unknown';
  return input.includes('image') ? 'native-image' : 'text-only';
}

function canUseVisionAuxiliary(config: VisionAuxiliaryConfig | null | undefined): boolean {
  return config?.enabled === true && !!config.model;
}

export async function evaluateChatImageSendPreflight({
  attachments,
  model,
  loadVisionAuxiliaryConfig,
}: {
  attachments: readonly ChatImageAttachment[];
  model: ChatImageModel | null | undefined;
  loadVisionAuxiliaryConfig: () => Promise<VisionAuxiliaryConfig>;
}): Promise<ChatImageSendPreflightResult> {
  const imageInputMode = getModelImageInputMode(model);
  if (!hasChatImageAttachments(attachments)) {
    return { ok: true, reason: 'no-images', imageInputMode };
  }
  if (imageInputMode === 'native-image') {
    return { ok: true, reason: 'native-image', imageInputMode };
  }
  if (imageInputMode === 'unknown') {
    return { ok: true, reason: 'unknown-model-capability', imageInputMode };
  }

  let auxiliaryConfig: VisionAuxiliaryConfig | null = null;
  try {
    auxiliaryConfig = await loadVisionAuxiliaryConfig();
  } catch {
    auxiliaryConfig = null;
  }
  if (canUseVisionAuxiliary(auxiliaryConfig)) {
    return { ok: true, reason: 'auxiliary-vision', imageInputMode };
  }
  return {
    ok: false,
    reason: 'text-model-image-without-auxiliary',
    imageInputMode,
  };
}

export function notifyTextModelImageBlocked({
  t,
  addToast,
  openSettings,
}: {
  t: (key: string) => string;
  addToast: ChatImageBlockedToast;
  openSettings: () => void;
}): void {
  addToast(
    t('input.textModelImageBlocked'),
    'warning',
    9000,
    {
      dedupeKey: 'text-model-image-blocked',
      action: {
        label: t('input.openModelSettings'),
        onClick: openSettings,
      },
    },
  );
}
