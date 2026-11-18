import { setupI18n } from '../../../i18n/index.ts';
import type { ModelFallbackNotice } from './protocol.ts';

export function formatModelFallbackNotice(notice: ModelFallbackNotice): string {
  const key = notice.reason === 'cooldown' ? 'chat.modelFallbackCooldown' : 'chat.modelFallback';
  return setupI18n().t(key, { from: notice.from, to: notice.to });
}
