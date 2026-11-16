import { z } from 'zod';
import type { Dataset } from './models';
const ref = z.string().min(1), time = z.string().datetime({ offset: true });
export const nordSsoBindingSchema = z.object({
  id: ref, rootRef: ref, providerRef: ref, proofEpoch: ref.default('initial'), provider: z.enum(['google', 'apple']), grantRef: ref.optional(),
  records: z.record(z.string(), z.object({ key: ref, at: time, requiredGuideSteps: z.array(ref).default([]), requiredPhoneRecords: z.array(ref).default([]) }).passthrough()).default({}),
  createdAt: time, connectedAt: time.optional(), connectionCreatedAt: time.optional(),
}).passthrough();
export type NordSsoBinding = z.infer<typeof nordSsoBindingSchema>;
export const nordSsoSessionSchema = z.object({ id: ref, vaultRef: ref, appRef: ref, guide: z.unknown(), returnTo: z.string().regex(/^\/(guide|map|phone\/[^?#]+|recover\/nord\/[^?#]+)$/), createdAt: time, finished: z.boolean().default(false) }).passthrough();
export type NordSsoSession = z.infer<typeof nordSsoSessionSchema>;
export const nordSsoStoreSchema = z.object({
  version: z.literal(1), methods: z.record(z.string(), z.enum(['direct', 'sso', 'unknown'])).default({}), directPasswords: z.record(z.string(), z.enum(['available', 'not-used', 'unknown'])).default({}), selections: z.record(z.string(), z.object({ provider: z.enum(['google', 'apple']), bindingRef: ref.optional() }).passthrough()).default({}),
  bindings: z.array(nordSsoBindingSchema).default([]), sessions: z.array(nordSsoSessionSchema).default([]),
}).passthrough();
export type NordSsoStore = z.infer<typeof nordSsoStoreSchema>;
export function nordSsoStore(data: Dataset): NordSsoStore | undefined {
  if (data.version !== 2 || data.securityModel.revision < 5) return;
  const parsed = nordSsoStoreSchema.safeParse(data.securityModel.nordSsoV1);
  return parsed.success ? parsed.data : undefined;
}
export function nordSsoBinding(data: Dataset, rootRef?: string): NordSsoBinding | undefined {
  if (!rootRef) return;
  const store = nordSsoStore(data), selection = store?.selections[rootRef];
  return store?.bindings.find(b => b.id === selection?.bindingRef && b.rootRef === rootRef && b.provider === selection.provider);
}
export function nordSsoConnected(data: Dataset, rootRef?: string): boolean {
  const b = nordSsoBinding(data, rootRef); if (data.version !== 2 || !b?.grantRef || !b.records.connection) return false;
  const grant = data.securityModel.entities.find(e => e.id === b.grantRef && e.kind === 'grant');
  const life = data.securityModel.lifecycle[b.grantRef];
  return !(life?.evidence === 'user-confirmed' && ['revoked', 'deleted', 'unavailable', 'lost', 'retired', 'transferred'].includes(life.state)) && !!grant && grant.nordSsoGrant === 'v1' && grant.grantorRef === b.providerRef && grant.granteeRef === b.rootRef && data.securityModel.relations.some(r => r.nordSsoEvidence === 'v1' && r.nordSsoBindingRef === b.id && r.nordSsoPurpose === 'connection' && r.evidence === 'user-confirmed');
}
export function nordSsoReady(data: Dataset, rootRef?: string): boolean {
  const b = nordSsoBinding(data, rootRef), provider = data.assets.find(a => a.id === b?.providerRef);
  const unavailable = data.version === 2 && [rootRef, provider?.id].some(ref => { const life = ref ? data.securityModel.lifecycle[ref] : undefined; return life?.evidence === 'user-confirmed' && ['revoked', 'deleted', 'unavailable', 'lost', 'retired', 'transferred'].includes(life.state); });
  return !unavailable && !!b && provider?.purpose === 'personal' && provider.provider === b.provider && ['mfa', 'recovery'].every(key => ['implemented', 'verified'].includes(provider.controls[key])) && !!b.records.outside && nordSsoConnected(data, rootRef);
}
export const nordSsoSelected = (data: Dataset, rootRef?: string) => rootRef ? nordSsoStore(data)?.selections[rootRef] : undefined;

export function nordDirectPasswordAvailable(data: Dataset, rootRef: string) {
  const state = nordSsoStore(data)?.directPasswords[rootRef];
  if (state) return state === 'available';
  return data.assets.some(a => a.id === rootRef && ['implemented', 'verified'].includes(a.controls.uniquePassword));
}
