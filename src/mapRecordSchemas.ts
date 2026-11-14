import { z } from 'zod';
import { securityRelationSchema } from './securityModel';
import type { Dataset } from './models';
export const MAP_RECORD_KINDS = ['account', 'device', 'backup', 'network', 'identity', 'person', 'organization', 'installation', 'vault', 'credential', 'identifier', 'phone-line', 'security-key', 'data-set', 'grant', 'recovery-arrangement', 'session'] as const;
export const mapRecordValue = z.union([z.string().max(300), z.array(z.string().max(100)).max(100)]);
export const mapRecordDraftSchema = z.object({
  id: z.string().min(1), nodeId: z.string().min(1), editRef: z.string().optional(), baseline: z.string().optional(),
  kind: z.enum(MAP_RECORD_KINDS).optional(), cursor: z.string().default('kind'), history: z.array(z.string()).default([]),
  values: z.record(z.string(), mapRecordValue).default({}), confirmations: z.record(z.string(), z.enum(['unknown', 'user-confirmed'])).default({}),
  status: z.enum(['active', 'completed', 'cancelled']).default('active'), createdAt: z.string().datetime({ offset: true }),
}).passthrough();
export type MapRecordDraft = z.infer<typeof mapRecordDraftSchema>;
export const mapRecordStoreSchema = z.object({
  version: z.literal(1), connectionDrafts: z.array(z.object({ id: z.string().min(1), editRef: z.string().optional(), baseline: z.string().optional(), cursor: z.number().int().min(0).max(4), fromRef: z.string(), toRef: z.string(), kind: securityRelationSchema.shape.kind, evidence: z.enum(['unknown','user-confirmed']), status: z.enum(['active','completed','cancelled']) }).passthrough()).default([]), drafts: z.array(mapRecordDraftSchema).default([]), manualRefs: z.array(z.string().min(1)).default([]), archivedRefs: z.array(z.string().min(1)).default([]),
}).passthrough();
export function mapRecordStore(data: Dataset) {
  if (data.version !== 2 || data.securityModel.revision < 6) return;
  const parsed = mapRecordStoreSchema.safeParse(data.securityModel.mapRecordsV1); return parsed.success ? parsed.data : undefined;
}
export const mapRecordArchived = (data: Dataset, ref: string) => mapRecordStore(data)?.archivedRefs.includes(ref) ?? false;
