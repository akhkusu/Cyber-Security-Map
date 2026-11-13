import { z } from 'zod';
import { assessmentAnswerSchema, controlEvidenceSchema, controlStateSchema } from './recordSchemas';

const id = z.string().min(1);
const label = z.string().min(1).max(80);
const time = z.string().datetime({ offset: true });
export const EVIDENCE = ['unknown', 'user-reported', 'user-confirmed'] as const;
export const ACCESS_CONTEXTS = ['normal', 'enrollment', 'new-device', 'after-restart', 'no-existing-session', 'all-devices-lost'] as const;
export type AccessContext = (typeof ACCESS_CONTEXTS)[number];
const entityBase = { id, label, createdAt: time, scopeId: id.optional() };

// Existing accounts/devices/backups remain in assets under their original IDs.
// These records add distinct objects; they never copy account or device state.
export const securityEntitySchema = z.discriminatedUnion('kind', [
  z.object({ ...entityBase, kind: z.literal('person'), role: z.enum(['self', 'trusted-contact', 'administrator', 'other']) }).passthrough(),
  z.object({ ...entityBase, kind: z.literal('organization') }).passthrough(),
  z.object({ ...entityBase, kind: z.literal('installation'), codeStorage: z.enum(['local', 'account']).optional(), syncAccountRef: id.optional(), mergedIntoRef: id.optional(), productId: id, deviceRef: id, profileLabel: label.optional(), appVersion: z.string().max(40).optional(), vaultRef: id.optional(), platformVariant: z.enum(['ios18plus', 'mac15plus']).optional(), controls: z.record(z.string(), controlStateSchema).optional(), controlEvidence: z.record(z.string(), controlEvidenceSchema).optional() }).passthrough(),
  z.object({ ...entityBase, kind: z.literal('vault'), mergedIntoRef: id.optional(), productId: id, ownerRef: id.optional(), authenticationAccountRef: id.optional(), primaryDeviceRef: id.optional(), storageMode: z.enum(['account', 'local']).optional(), controls: z.record(z.string(), controlStateSchema).optional(), controlEvidence: z.record(z.string(), controlEvidenceSchema).optional() }).passthrough(),
  z.object({ ...entityBase, kind: z.literal('credential'), credentialType: z.enum(['password', 'totp', 'passkey', 'security-key-registration', 'app-password', 'recovery-code', 'recovery-key', 'api-token', 'ssh-key', 'certificate', 'other']), subjectRef: id, storageRef: id.optional(), replicaGroupId: id.optional(), roles: z.array(z.enum(['sign-in', 'second-step', 'decrypt', 'local-unlock', 'restore'])).min(1) }).passthrough(),
  z.object({ ...entityBase, kind: z.literal('identifier'), identifierType: z.enum(['email-alias', 'phone-number', 'domain', 'login-id', 'other']), subjectRef: id.optional(), roles: z.array(z.enum(['sign-in', 'recovery', 'contact', 'routing'])).min(1) }).passthrough(),
  z.object({ ...entityBase, kind: z.literal('phone-line'), deviceRef: id.optional(), carrierAccountRef: id.optional(), carrierProductId: id.optional(), simType: z.enum(['physical', 'esim', 'unknown']).default('unknown') }).passthrough(),
  z.object({ ...entityBase, kind: z.literal('security-key'), transports: z.array(z.enum(['usb-a', 'usb-c', 'lightning', 'nfc', 'other'])).default([]) }).passthrough(),
  z.object({ ...entityBase, kind: z.literal('data-set'), dataType: z.enum(['mail', 'files', 'photos', 'messages', 'password-vault', 'device-backup', 'other']), ownerRef: id.optional() }).passthrough(),
  z.object({ ...entityBase, kind: z.literal('grant'), grantType: z.enum(['sso', 'oauth', 'delegation', 'sharing-link', 'membership', 'other']), grantorRef: id, granteeRef: id, targetRefs: z.array(id).min(1), permissions: z.array(z.enum(['sign-in', 'read', 'write', 'manage', 'recover'])).min(1), expiresAt: time.optional() }).passthrough(),
  z.object({ ...entityBase, kind: z.literal('recovery-arrangement'), mode: z.enum(['contact', 'emergency-view', 'takeover', 'legacy', 'administrator', 'other']), subjectRef: id, helperRef: id.optional(), stage: z.enum(['unknown', 'invited', 'accepted', 'confirmation-needed', 'waiting', 'ready', 'revoked']), availableAt: time.optional() }).passthrough(),
]);
export type SecurityEntity = z.infer<typeof securityEntitySchema>;

export const RELATION_KINDS = ['owns', 'administers', 'installed-on', 'identifies', 'authenticates-to', 'unlocks', 'decrypts', 'stored-in', 'synced-via', 'session-for', 'grants-access-to', 'delegated-to', 'shared-with', 'recovers', 'requires-for-restore', 'backs-up', 'restores-from', 'hosts', 'routes', 'manages-domain', 'replaces'] as const;
export const securityRelationSchema = z.object({
  id, fromRef: id, toRef: id, kind: z.enum(RELATION_KINDS), evidence: z.enum(EVIDENCE), checkedAt: time,
  sourceIds: z.array(id).default([]),
}).passthrough();
export type SecurityRelation = z.infer<typeof securityRelationSchema>;

export type AccessCondition = { kind: 'fact'; factId: string } | { kind: 'route'; routeId: string } | { kind: 'all' | 'any'; conditions: AccessCondition[] };
function boundedCondition(value: unknown): boolean {
  const pending = [{ value, depth: 0 }]; let visited = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++visited > 4096 || item.depth > 64) return false;
    if (item.value && typeof item.value === 'object' && 'conditions' in item.value && Array.isArray(item.value.conditions)) {
      for (const child of item.value.conditions) pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  return true;
}
export const accessConditionSchema: z.ZodType<AccessCondition> = z.preprocess(value => boundedCondition(value) ? value : null, z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fact'), factId: id }).passthrough(),
  z.object({ kind: z.literal('route'), routeId: id }).passthrough(),
  z.object({ kind: z.literal('all'), conditions: z.array(accessConditionSchema).min(1).max(100) }).passthrough(),
  z.object({ kind: z.literal('any'), conditions: z.array(accessConditionSchema).min(1).max(100) }).passthrough(),
])));
export const accessFactSchema = z.object({
  id, label, state: z.enum(['unknown', 'available', 'unavailable', 'revoked']), evidence: z.enum(EVIDENCE), checkedAt: time,
  requiredRefs: z.array(id).default([]), contexts: z.array(z.enum(ACCESS_CONTEXTS)).min(1).default(['normal']),
  availableAt: time.optional(), expiresAt: time.optional(), sourceIds: z.array(id).default([]),
  dependencyCompleteness: z.enum(['partial', 'complete']).optional(),
}).passthrough();
export type AccessFact = z.infer<typeof accessFactSchema>;
export const accessRouteSchema = z.object({
  id, label, targetRef: id, purpose: z.enum(['sign-in', 'second-step', 'decrypt', 'local-unlock', 'restore']),
  contexts: z.array(z.enum(ACCESS_CONTEXTS)).min(1).default(['normal']), requirements: accessConditionSchema,
  sourceIds: z.array(id).default([]),
}).passthrough();
export type AccessRoute = z.infer<typeof accessRouteSchema>;
export const lifecycleSchema = z.object({
  state: z.enum(['unknown', 'in-use', 'backup', 'unavailable', 'lost', 'transferred', 'retired', 'revoked', 'deleted']), evidence: z.enum(EVIDENCE), updatedAt: time, accessResetAt: time.optional(),
}).passthrough();
const controlBaselineSchema = z.object({
  targetRef: id, controlId: id, state: controlStateSchema, evidence: controlEvidenceSchema,
  answerKey: id.optional(), answer: assessmentAnswerSchema.optional(),
}).passthrough();
export const securityModelSchema = z.object({
  revision: z.union([z.literal(1), z.literal(2)]), entities: z.array(securityEntitySchema).default([]), relations: z.array(securityRelationSchema).default([]),
  facts: z.array(accessFactSchema).default([]), routes: z.array(accessRouteSchema).default([]),
  lifecycle: z.record(z.string(), lifecycleSchema).default({}),
  controlBaselines: z.record(z.string(), controlBaselineSchema).default({}),
}).passthrough();
export type SecurityModel = z.infer<typeof securityModelSchema>;
export const emptySecurityModel = (): SecurityModel => ({ revision: 1, entities: [], relations: [], facts: [], routes: [], lifecycle: {}, controlBaselines: {} });
export type LegacyEntity = { id: string; name: string; kind: string };
export type EntitySummary = { id: string; label: string; kind: string; legacy: boolean };
export function entityIndex(model: SecurityModel, legacy: readonly LegacyEntity[]): Map<string, EntitySummary> {
  return new Map([...legacy.map(e => ({ id: e.id, label: e.name, kind: e.kind, legacy: true })), ...model.entities.map(e => ({ id: e.id, label: e.label, kind: e.kind, legacy: false }))].map(e => [e.id, e]));
}

export type ModelIssue = { code: 'duplicate-id' | 'missing-entity' | 'missing-fact' | 'missing-route' | 'condition-limit' | 'invalid-alias'; recordId: string; referenceId: string };
export function securityModelIssues(model: SecurityModel, legacy: readonly LegacyEntity[]): ModelIssue[] {
  const issues: ModelIssue[] = [], ids = new Set<string>();
  for (const item of [...legacy, ...model.entities, ...model.relations, ...model.facts, ...model.routes]) {
    if (ids.has(item.id)) issues.push({ code: 'duplicate-id', recordId: item.id, referenceId: item.id });
    ids.add(item.id);
  }
  const entities = new Set([...legacy, ...model.entities].map(e => e.id));
  const canonicalVault = (ref: string | undefined) => {
    const seen = new Set<string>();
    while (ref && !seen.has(ref)) {
      seen.add(ref); const vault = model.entities.find(e => e.id === ref && e.kind === 'vault');
      if (!vault || vault.kind !== 'vault') return;
      if (!vault.mergedIntoRef) return vault.id;
      ref = vault.mergedIntoRef;
    }
  };
  for (const e of model.entities) if ((e.kind === 'vault' || e.kind === 'installation') && e.mergedIntoRef) {
    const seen = new Set([e.id]); let current = e;
    while (current.mergedIntoRef) {
      const target = model.entities.find(t => t.id === current.mergedIntoRef);
      if (!target || target.kind !== e.kind || target.productId !== e.productId || (e.kind === 'installation' && target.kind === 'installation' && (e.deviceRef !== target.deviceRef || (e.syncAccountRef && e.syncAccountRef !== target.syncAccountRef) || (e.codeStorage && e.codeStorage !== target.codeStorage) || (e.vaultRef && canonicalVault(e.vaultRef) !== canonicalVault(target.vaultRef)))) || (e.kind === 'vault' && target.kind === 'vault' && ((e.authenticationAccountRef && e.authenticationAccountRef !== target.authenticationAccountRef) || (e.storageMode && e.storageMode !== target.storageMode))) || seen.has(target.id)) { issues.push({ code: 'invalid-alias', recordId: e.id, referenceId: current.mergedIntoRef as string }); break; }
      seen.add(target.id); current = target;
    }
  }
  const check = (recordId: string, ref: string | undefined) => { if (ref && !entities.has(ref)) issues.push({ code: 'missing-entity', recordId, referenceId: ref }); };
  for (const e of model.entities) {
    if (e.kind === 'installation') { check(e.id, e.mergedIntoRef); check(e.id, e.syncAccountRef); check(e.id, e.deviceRef); check(e.id, e.vaultRef); }
    if (e.kind === 'vault') { check(e.id, e.mergedIntoRef); check(e.id, e.ownerRef); check(e.id, e.authenticationAccountRef); check(e.id, e.primaryDeviceRef); }
    if (e.kind === 'credential') { check(e.id, e.subjectRef); check(e.id, e.storageRef); }
    if (e.kind === 'identifier') check(e.id, e.subjectRef);
    if (e.kind === 'phone-line') { check(e.id, e.deviceRef); check(e.id, e.carrierAccountRef); }
    if (e.kind === 'data-set') check(e.id, e.ownerRef);
    if (e.kind === 'grant') { check(e.id, e.grantorRef); check(e.id, e.granteeRef); e.targetRefs.forEach(ref => check(e.id, ref)); }
    if (e.kind === 'recovery-arrangement') { check(e.id, e.subjectRef); check(e.id, e.helperRef); }
  }
  for (const edge of model.relations) { check(edge.id, edge.fromRef); check(edge.id, edge.toRef); }
  for (const fact of model.facts) fact.requiredRefs.forEach(ref => check(fact.id, ref));
  Object.keys(model.lifecycle).forEach(ref => check('lifecycle', ref));
  for (const [key, baseline] of Object.entries(model.controlBaselines)) check(`baseline:${key}`, baseline.targetRef);
  const facts = new Set(model.facts.map(f => f.id)), routes = new Set(model.routes.map(r => r.id));
  const checkCondition = (condition: AccessCondition, recordId: string, depth = 0): void => {
    if (depth > 64) { issues.push({ code: 'condition-limit', recordId, referenceId: recordId }); return; }
    if (condition.kind === 'fact' && !facts.has(condition.factId)) issues.push({ code: 'missing-fact', recordId, referenceId: condition.factId });
    if (condition.kind === 'route' && !routes.has(condition.routeId)) issues.push({ code: 'missing-route', recordId, referenceId: condition.routeId });
    if (condition.kind === 'all' || condition.kind === 'any') condition.conditions.forEach(c => checkCondition(c, recordId, depth + 1));
  };
  for (const route of model.routes) { check(route.id, route.targetRef); checkCondition(route.requirements, route.id); }
  return issues;
}

export type AccessState = 'available' | 'unavailable' | 'unknown' | 'not-applicable';
export type AccessReason = { code: 'confirmed' | 'unconfirmed' | 'reported-only' | 'missing-reference' | 'outside-context' | 'waiting' | 'expired' | 'resource-unavailable' | 'revoked' | 'cycle' | 'limit'; referenceId: string };
export type AccessResult = { state: AccessState; reasons: AccessReason[]; usedFactIds: string[] };
export type AccessScenario = { context: AccessContext; unavailableRefs?: readonly string[]; now: string };
const result = (state: AccessState, code: AccessReason['code'], referenceId: string, usedFactIds: string[] = []): AccessResult => ({ state, reasons: [{ code, referenceId }], usedFactIds });

// This evaluates recorded conditions, not real accounts. A missing/unconfirmed
// observation never becomes evidence of access just because a route is configured.
export function evaluateAccess(model: SecurityModel, routeId: string, scenario: AccessScenario): AccessResult {
  const facts = new Map(model.facts.map(f => [f.id, f])), routes = new Map(model.routes.map(r => [r.id, r]));
  const unavailable = new Set(scenario.unavailableRefs ?? []), now = Date.parse(scenario.now);
  for (const [ref, life] of Object.entries(model.lifecycle)) if (life.evidence === 'user-confirmed' && ['unavailable', 'lost', 'transferred', 'retired', 'revoked', 'deleted'].includes(life.state)) unavailable.add(ref);
  let visits = 0;
  const factResult = (factId: string): AccessResult => {
    const f = facts.get(factId);
    if (!f) return result('unknown', 'missing-reference', factId);
    if (!f.contexts.includes(scenario.context)) return result('not-applicable', 'outside-context', factId);
    if (f.evidence !== 'user-confirmed') return result('unknown', f.evidence === 'user-reported' ? 'reported-only' : 'unconfirmed', f.id);
    const missing = f.requiredRefs.find(ref => unavailable.has(ref));
    if (missing) return result('unavailable', 'resource-unavailable', missing);
    const reset = f.requiredRefs.find(ref => { const life = model.lifecycle[ref]; return life?.accessResetAt && Date.parse(f.checkedAt) <= Date.parse(life.accessResetAt); });
    if (reset) return result('unknown', 'unconfirmed', reset);
    if (f.state === 'revoked') return result('unavailable', 'revoked', f.id);
    if (f.availableAt && now < Date.parse(f.availableAt)) return result('unavailable', 'waiting', f.id);
    if (f.expiresAt && now >= Date.parse(f.expiresAt)) return result('unavailable', 'expired', f.id);
    if (f.state === 'unavailable') return result('unavailable', 'resource-unavailable', f.id);
    if (f.state !== 'available') return result('unknown', 'unconfirmed', f.id);
    // An observed login does not establish that every MFA/recovery dependency
    // was captured. Do not project it onto an untested loss scenario.
    if (f.dependencyCompleteness === 'partial' && unavailable.size > 0) return result('unknown', 'unconfirmed', f.id);
    return result('available', 'confirmed', f.id, [f.id]);
  };
  const conditionResult = (condition: AccessCondition, path: Set<string>, depth: number): AccessResult => {
    if (++visits > 4096 || depth > 64) return result('unknown', 'limit', routeId);
    if (condition.kind === 'fact') return factResult(condition.factId);
    if (condition.kind === 'route') return routeResult(condition.routeId, path, depth + 1);
    const children = condition.conditions.map(c => conditionResult(c, path, depth + 1));
    if (!children.length) return result('unknown', 'unconfirmed', routeId);
    if (condition.kind === 'any') {
      const available = children.find(c => c.state === 'available');
      if (available) return available;
    }
    const chosen = condition.kind === 'all'
      ? children.some(c => c.state === 'unavailable' || c.state === 'not-applicable') ? 'unavailable' : children.every(c => c.state === 'available') ? 'available' : 'unknown'
      : children.some(c => c.state === 'unknown') ? 'unknown' : 'unavailable';
    return { state: chosen, reasons: children.flatMap(c => c.reasons), usedFactIds: chosen === 'available' ? [...new Set(children.flatMap(c => c.usedFactIds))] : [] };
  };
  const routeResult = (ref: string, path: Set<string>, depth: number): AccessResult => {
    const route = routes.get(ref);
    if (!route) return result('unknown', 'missing-reference', ref);
    if (path.has(ref)) return result('unknown', 'cycle', ref);
    if (!route.contexts.includes(scenario.context)) return result('not-applicable', 'outside-context', ref);
    if (unavailable.has(route.targetRef)) return result('unavailable', 'resource-unavailable', route.targetRef);
    return conditionResult(route.requirements, new Set([...path, ref]), depth + 1);
  };
  if (!Number.isFinite(now)) return result('unknown', 'unconfirmed', routeId);
  return routeResult(routeId, new Set(), 0);
}
