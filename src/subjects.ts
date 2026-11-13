import type { Asset, Dataset } from './models';
import type { ControlEvidence, ControlState } from './recordSchemas';

export type ControlSubject = { id: string; kind: string; controls: Record<string, ControlState>; controlEvidence: Record<string, ControlEvidence> };
export function controlSubject(data: Dataset, id: string): ControlSubject | undefined {
  const asset = data.assets.find(a => a.id === id);
  if (asset) return asset;
  const entity = data.version === 2 ? data.securityModel.entities.find(e => e.id === id) : undefined;
  if (entity?.kind === 'vault' || entity?.kind === 'installation') return { id, kind: entity.kind, controls: entity.controls ?? {}, controlEvidence: entity.controlEvidence ?? {} };
}
export function writeSubjectControl(data: Dataset, id: string, control: string, state: ControlState, evidence: ControlEvidence, now: string): Dataset {
  if (data.assets.some(a => a.id === id)) return { ...data, assets: data.assets.map(a => a.id === id ? { ...a, updatedAt: now, controls: { ...a.controls, [control]: state }, controlEvidence: { ...a.controlEvidence, [control]: evidence } } : a) };
  if (data.version !== 2) return data;
  return { ...data, securityModel: { ...data.securityModel, entities: data.securityModel.entities.map(e => e.id === id && (e.kind === 'vault' || e.kind === 'installation') ? { ...e, updatedAt: now, controls: { ...e.controls, [control]: state }, controlEvidence: { ...e.controlEvidence, [control]: evidence } } : e) } };
}
// A transient rendering adapter, never an additional persisted account. The
// canonical vault ID still targets control records and graph relationships.
export function guideSubject(data: Dataset, id: string): Asset | undefined {
  const asset = data.assets.find(a => a.id === id); if (asset) return asset;
  const entity = data.version === 2 ? data.securityModel.entities.find(e => e.id === id && e.kind === 'vault') : undefined;
  if (entity?.kind !== 'vault' || !['apple-passwords', 'google-password-manager'].includes(entity.productId)) return;
  const root = data.assets.find(a => a.id === entity.authenticationAccountRef);
  return { id, kind: 'account', type: 'Password vault', name: entity.label, importance: 'critical', createdAt: entity.createdAt, updatedAt: typeof entity.updatedAt === 'string' ? entity.updatedAt : entity.createdAt, controls: entity.controls ?? {}, controlEvidence: entity.controlEvidence ?? {}, provider: entity.productId === 'apple-passwords' ? 'apple' : 'google', services: ['manager'], purpose: root?.purpose };
}
