import { c, type Copy } from './guideCatalog';

export type LineStep = {
  id: string; kind: 'question' | 'action' | 'blocked' | 'finished' | 'prepared'; title: Copy; text?: Copy;
  place?: Copy; action?: Copy; expected?: Copy; button?: Copy; choices?: { value: string; label: Copy }[];
  sources: string[]; phase: 'prepare' | 'transfer' | 'use'; url?: string;
  effect?: 'source' | 'backup' | 'request' | 'sign-in' | 'read' | 'key-request' | 'key-observed' | 'key-store' | 'key-new-store';
};
export const lineChoice = (value: string, en: string, ja = en) => ({ value, label: c(en, ja) });
export const lineQuestion = (id: string, title: Copy, choices: LineStep['choices'], sources = ['lineQr'], text?: Copy): LineStep => ({ id, kind: 'question', title, choices, sources, text, phase: 'prepare' });
export const lineAction = (id: string, title: Copy, place: Copy, action: Copy, expected: Copy, sources: string[] = ['lineQr'], extra: Partial<LineStep> = {}): LineStep => ({ id, kind: 'action', title, place, action, expected, sources, phase: 'prepare', button: c('I checked this', '確認しました'), ...extra });
export const lineBlocked = (id: string, title: Copy, text: Copy, sources = ['lineMethods']): LineStep => ({ id, kind: 'blocked', title, text, sources, phase: 'prepare' });
