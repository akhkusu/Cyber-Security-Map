import { z } from 'zod';
import type { Dataset } from './models';

const ref = z.string().min(1), time = z.string().datetime({ offset: true });
export const KEY_MODES = ['google-second-step', 'google-passkey', 'apple-keys', 'bitwarden-second-step', 'bitwarden-login'] as const;
export type KeyMode = typeof KEY_MODES[number];
export const keyTaskSchema = z.object({
  id: ref, accountRef: ref, cursor: ref.default('mode'), mode: z.enum(KEY_MODES).optional(),
  answers: z.record(z.string(), z.string()).default({}), history: z.array(ref).default([]),
  status: z.enum(['active', 'deferred', 'completed', 'cancelled']).default('active'),
  returnTo: z.enum(['/guide', '/map']), originGuideCursor: z.string(),
  vaultRef: ref.optional(), deviceRef: ref.optional(), browserRef: ref.optional(), keyRefs: z.array(ref).max(2).default([]),
  registrationRefs: z.array(ref).max(2).default([]),
  records: z.record(z.string(), z.object({ titleEn: ref, titleJa: ref, at: time, refs: z.array(ref).default([]), requires: z.array(ref).default([]) }).passthrough()).default({}),
  createdAt: time, updatedAt: time,
}).passthrough();
export type KeyTask = z.infer<typeof keyTaskSchema>;
export const keyStoreSchema = z.object({ version: z.literal(1), tasks: z.array(keyTaskSchema).default([]) }).passthrough();
export function keyTasks(data: Dataset): KeyTask[] {
  if (data.version !== 2 || data.securityModel.revision < 7) return [];
  const parsed = keyStoreSchema.safeParse(data.securityModel.hardwareKeysV1);
  return parsed.success ? parsed.data.tasks : [];
}
