import { z } from 'zod';
import { emptySecurityModel, securityModelIssues, securityModelSchema } from './securityModel';
import { phoneWorkflowSchema } from './phoneSchemas';
import { CONTROL_STATES, controlEvidenceSchema, assessmentAnswerSchema, type AssessmentAnswer, type ControlState } from './recordSchemas';
export { CONTROL_STATES, controlEvidenceSchema, assessmentAnswerSchema, type AssessmentAnswer, type ControlState, type ControlEvidence } from './recordSchemas';

export const LANGUAGES = ['en', 'ja'] as const;
export type Language = (typeof LANGUAGES)[number];
export const ASSET_KINDS = ['device', 'account', 'backup', 'network', 'identity'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const IMPORTANCE = ['critical', 'important', 'useful'] as const;
export type Importance = (typeof IMPORTANCE)[number];
export const OPERATING_SYSTEMS = ['windows', 'macos', 'ubuntu', 'ios', 'android', 'chromeos', 'other', 'unknown'] as const;
export type OperatingSystem = (typeof OPERATING_SYSTEMS)[number];

export const assetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(ASSET_KINDS),
  type: z.string().min(1).max(48),
  name: z.string().min(1).max(80),
  importance: z.enum(IMPORTANCE),
  createdAt: z.string(),
  updatedAt: z.string(),
  controls: z.record(z.string(), z.enum(CONTROL_STATES)).default({}),
  controlEvidence: z.record(z.string(), controlEvidenceSchema).default({}),
  operatingSystem: z.enum(OPERATING_SYSTEMS).optional(),
  notes: z.string().max(300).optional(),
  provider: z.enum(['apple', 'google', 'microsoft', 'proton', 'fastmail', 'tuta', 'zoho', 'yahoo', 'startmail', 'mailcom', 'gmx', 'bitwarden', '1password', 'other']).optional(),
  purpose: z.enum(['personal', 'work']).optional(),
  services: z.array(z.enum(['mail', 'cloud', 'manager'])).default([]),
}).passthrough();
export type Asset = z.infer<typeof assetSchema>;

export const dependencySchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  recoveryAssetId: z.string().min(1),
  relation: z.string().max(80),
  createdAt: z.string(),
  relationType: z.enum(['recovery-email', 'authentication', 'backup', 'offline-recovery']).optional(),
}).passthrough();
export type RecoveryDependency = z.infer<typeof dependencySchema>;

export const actionSchema = z.object({
  id: z.string(), completedAt: z.string().optional(), titleEn: z.string().optional(), titleJa: z.string().optional(), assetName: z.string().optional(),
  status: z.enum(['in-progress', 'completed', 'remind-me-later', 'not-applicable']).optional(), updatedAt: z.string().optional(),
  targetId: z.string().optional(), controlId: z.string().optional(), origin: z.string().optional(),
}).passthrough();
export type SecurityActionRecord = z.infer<typeof actionSchema>;
export const reviewSchema = z.object({ id: z.string(), completedAt: z.string(), kind: z.enum(['weekly', 'monthly']) }).passthrough();
export type SecurityReview = z.infer<typeof reviewSchema>;
export const validationRecordSchema = z.object({
  id: z.string(), validationId: z.string(), status: z.enum(['tested', 'passed', 'failed', 'partially-tested', 'not-tested', 'unknown']),
  testedAt: z.string(), method: z.string().max(160), note: z.string().max(300).optional(),
}).passthrough();
export type ValidationRecord = z.infer<typeof validationRecordSchema>;

export const threatModelSchema = z.object({
  concerns: z.array(z.string()).default([]), audience: z.enum(['self', 'family']).default('self'),
  knowledge: z.enum(['beginner', 'comfortable', 'advanced']).default('beginner'),
  priority: z.enum(['convenience', 'balanced', 'strongest']).default('balanced'),
}).passthrough();
export type ThreatModel = z.infer<typeof threatModelSchema>;

export const settingsSchema = z.object({
  language: z.enum(LANGUAGES), theme: z.enum(['light', 'dark']), mode: z.enum(['guided', 'advanced']),
  explanationDepth: z.enum(['action', 'why', 'technical']).default('action'),
  threatProfile: z.enum(['essential', 'advanced', 'high-assurance']).default('essential'),
  reviewIntervalDays: z.union([z.literal(30), z.literal(90), z.literal(180)]).default(90),
  autoLockMinutes: z.number().min(1).max(60),
}).passthrough();

export const guideSchema = z.object({
  cursor: z.string().default('start'),
  history: z.array(z.string()).default([]),
  accountId: z.string().optional(),
  managerId: z.string().optional(),
  deviceId: z.string().optional(),
  draftAccountId: z.string().optional(),
  pendingProvider: z.enum(['apple', 'google', 'microsoft', 'proton', 'fastmail', 'tuta', 'zoho', 'yahoo', 'startmail', 'mailcom', 'gmx', 'bitwarden', '1password', 'other']).optional(),
  answers: z.record(z.string(), z.string()).default({}),
  steps: z.record(z.string(), z.object({ status: z.enum(['done', 'later']), updatedAt: z.string(), beforeControl: z.enum(CONTROL_STATES).optional(), beforeEvidence: controlEvidenceSchema.optional(), beforeAnswer: assessmentAnswerSchema.optional() }).passthrough()).default({}),
}).passthrough().default({ cursor: 'start', history: [], answers: {}, steps: {} });
export type GuideState = z.infer<typeof guideSchema>;

// Preserve opaque legacy fields when reading and writing a supported payload version.
// UI and help prompts use known fields only; retained data does not enable old integrations.
const datasetFields = {
  guide: guideSchema,
  assets: z.array(assetSchema),
  dependencies: z.array(dependencySchema),
  actions: z.array(actionSchema),
  incidentProgress: z.record(z.string(), z.array(z.string())),
  workflowProgress: z.record(z.string(), z.array(z.string())),
  reviews: z.array(reviewSchema),
  assessmentAnswers: z.record(z.string(), assessmentAnswerSchema).default({}),
  checkupProgress: z.object({ activeDomain: z.string().default('identity'), startedAt: z.string().optional(), lastCompletedAt: z.string().optional() }).passthrough().default({ activeDomain: 'identity' }),
  threatModel: threatModelSchema.default({ concerns: [], audience: 'self', knowledge: 'beginner', priority: 'balanced' }),
  validationRecords: z.array(validationRecordSchema).default([]),
  onboarding: z.object({ complete: z.boolean(), goals: z.array(z.string()), completedAt: z.string().optional() }).passthrough(),
  settings: settingsSchema,
};
export const CURRENT_DATASET_VERSION = 2;
export const legacyDatasetSchema = z.object({ version: z.literal(1), ...datasetFields }).passthrough();
export const currentDatasetSchema = z.object({
  version: z.literal(CURRENT_DATASET_VERSION), ...datasetFields,
  securityModel: securityModelSchema.default(emptySecurityModel),
  deviceWorkflows: z.array(phoneWorkflowSchema).default([]),
}).passthrough().superRefine((data, context) => {
  for (const issue of securityModelIssues(data.securityModel, data.assets)) {
    context.addIssue({ code: 'custom', path: ['securityModel'], message: `${issue.code}: ${issue.recordId}` });
  }
  const ids = new Set<string>();
  for (const workflow of data.deviceWorkflows) {
    if (ids.has(workflow.id)) context.addIssue({ code: 'custom', path: ['deviceWorkflows'], message: 'duplicate-workflow-id' });
    ids.add(workflow.id);
    for (const ref of [workflow.oldDeviceRef, workflow.newDeviceRef]) {
      if (ref && !data.assets.some(a => a.id === ref && a.kind === 'device')) context.addIssue({ code: 'custom', path: ['deviceWorkflows'], message: 'missing-workflow-device' });
    }
    if (workflow.oldDeviceRef && workflow.oldDeviceRef === workflow.newDeviceRef) context.addIssue({ code: 'custom', path: ['deviceWorkflows'], message: 'same-workflow-device' });
  }
});
export const datasetSchema = z.union([legacyDatasetSchema, currentDatasetSchema]);
export type CurrentDataset = z.infer<typeof currentDatasetSchema>;
export type Dataset = z.infer<typeof datasetSchema>;
export class DataUpgradeConflict extends Error {
  constructor() { super('legacy-feature-key-conflict'); this.name = 'DataUpgradeConflict'; }
}
export function upgradeDataset(data: Dataset): CurrentDataset {
  if (data.version === CURRENT_DATASET_VERSION) return data;
  // Do not reinterpret an opaque v1 field as a new feature or silently replace it.
  if (Object.hasOwn(data, 'securityModel') || Object.hasOwn(data, 'deviceWorkflows')) throw new DataUpgradeConflict();
  return currentDatasetSchema.parse({ ...data, version: CURRENT_DATASET_VERSION, securityModel: emptySecurityModel(), deviceWorkflows: [] });
}

// Keep the persisted format ID stable for compatibility with existing backups.
export const envelopeSchema = z.object({
  format: z.literal('personal-cyber-os-v1'), algorithm: z.literal('AES-256-GCM'), kdf: z.literal('PBKDF2-SHA-256'),
  iterations: z.number().min(600_000), salt: z.string(), iv: z.string(), ciphertext: z.string(),
}).passthrough();
export type VaultEnvelope = z.infer<typeof envelopeSchema>;

export const CONTROL_CATALOG: Record<AssetKind, { id: string; en: string; ja: string }[]> = {
  device: [
    { id: 'screenLock', en: 'Screen lock', ja: '画面ロック' }, { id: 'updates', en: 'Automatic security updates', ja: 'セキュリティ更新の自動適用' },
    { id: 'encryption', en: 'Device encryption', ja: '端末の暗号化' }, { id: 'backup', en: 'Recent backup', ja: '最近のバックアップ' },
  ],
  account: [
    { id: 'mfa', en: 'Multi-factor authentication', ja: '多要素認証' }, { id: 'passkey', en: 'Passkey or security key', ja: 'パスキーまたはセキュリティキー' },
    { id: 'recovery', en: 'Recovery method checked', ja: '復旧方法の確認' }, { id: 'alerts', en: 'Sign-in alerts', ja: 'ログイン通知' },
  ],
  backup: [
    { id: 'encrypted', en: 'Backup is encrypted', ja: 'バックアップの暗号化' }, { id: 'offsite', en: 'Separate or offline copy', ja: '別の場所またはオフラインのコピー' },
    { id: 'restoreTest', en: 'Restore tested recently', ja: '最近の復元テスト' },
  ],
  network: [
    { id: 'adminPassword', en: 'Router admin access protected', ja: 'ルーター管理画面の保護' }, { id: 'updates', en: 'Router updates enabled', ja: 'ルーター更新の確認' },
    { id: 'remoteAccess', en: 'Remote administration reviewed', ja: '遠隔管理設定の確認' },
  ],
  identity: [
    { id: 'privacy', en: 'Privacy settings reviewed', ja: 'プライバシー設定の確認' }, { id: 'recovery', en: 'Recovery options protected', ja: '復旧手段の保護' },
  ],
};

export const newDataset = (language: Language = 'en', goals: string[] = []): CurrentDataset => ({
  version: CURRENT_DATASET_VERSION, securityModel: emptySecurityModel(), deviceWorkflows: [], guide: guideSchema.parse(undefined), assets: [], dependencies: [], actions: [], incidentProgress: {}, workflowProgress: {}, reviews: [],
  assessmentAnswers: {}, checkupProgress: { activeDomain: 'identity' },
  threatModel: { concerns: [], audience: 'self', knowledge: 'beginner', priority: 'balanced' }, validationRecords: [],
  onboarding: { complete: false, goals },
  settings: { language, theme: 'light', mode: 'guided', explanationDepth: 'action', threatProfile: 'essential', reviewIntervalDays: 90, autoLockMinutes: 10 },
});

export const makeAsset = (input: Pick<Asset, 'kind' | 'type' | 'name' | 'importance'> & Partial<Pick<Asset, 'operatingSystem'>>, controls: Record<string, ControlState> = {}): Asset => {
  const now = new Date().toISOString();
  const catalog = CONTROL_CATALOG[input.kind];
  return {
    id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now,
    services: [],
    controls: Object.fromEntries(catalog.map((control) => [control.id, controls[control.id] ?? 'unknown'])), controlEvidence: {},
  };
};

export function looksLikeSecret(value: string): boolean {
  const text = value.trim();
  if (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(text)) return true;
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(text)) return true;
  if (/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{18,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/.test(text)) return true;
  if (/\b(?:password|passphrase|secret|seed phrase|recovery code)\s*[:=]/i.test(text)) return true;
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 13 && digits.length <= 19 && /(?:\d[ -]*?){13,19}/.test(text)) return true;
  return false;
}

const demoAnswer = (response: AssessmentAnswer['response'], evidence: AssessmentAnswer['evidence'] = 'user-reported'): AssessmentAnswer => ({ response, evidence, updatedAt: new Date().toISOString() });
const demoAssets = [
  makeAsset({ kind: 'device', type: 'Laptop', name: 'MacBook', importance: 'critical', operatingSystem: 'macos' }, { screenLock: 'verified', encryption: 'verified', updates: 'implemented', backup: 'needs-improvement' }),
  makeAsset({ kind: 'device', type: 'Smartphone', name: 'iPhone', importance: 'critical', operatingSystem: 'ios' }, { screenLock: 'verified', updates: 'verified', encryption: 'implemented', backup: 'implemented' }),
  makeAsset({ kind: 'account', type: 'Primary email', name: 'Google account', importance: 'critical' }, { mfa: 'verified', passkey: 'implemented', recovery: 'needs-improvement', alerts: 'implemented' }),
  makeAsset({ kind: 'account', type: 'Identity provider', name: 'Apple account', importance: 'important' }, { mfa: 'verified', passkey: 'verified', recovery: 'implemented', alerts: 'unknown' }),
  makeAsset({ kind: 'account', type: 'Password manager', name: 'Bitwarden account', importance: 'critical' }, { mfa: 'verified', passkey: 'implemented', recovery: 'verified', alerts: 'implemented' }),
  makeAsset({ kind: 'account', type: 'Banking and finance', name: 'Banking account', importance: 'critical' }, { mfa: 'implemented', recovery: 'unknown', alerts: 'unknown' }),
  makeAsset({ kind: 'network', type: 'Router', name: 'Home router', importance: 'important' }, { adminPassword: 'unknown', updates: 'unknown', remoteAccess: 'unknown' }),
  makeAsset({ kind: 'backup', type: 'Cloud photo storage', name: 'Photo library', importance: 'important' }, { encrypted: 'implemented', offsite: 'unknown', restoreTest: 'needs-improvement' }),
];
const demoAssetKey = (controlId: string, name: string) => `${controlId}@${demoAssets.find((asset) => asset.name === name)!.id}`;
export const DEMO_DATA: CurrentDataset = {
  version: CURRENT_DATASET_VERSION, securityModel: emptySecurityModel(), deviceWorkflows: [], guide: guideSchema.parse(undefined),
  assets: demoAssets,
  dependencies: [], actions: [], incidentProgress: {}, workflowProgress: {}, reviews: [],
  assessmentAnswers: {
    'identity.password-manager': demoAnswer('yes', 'user-confirmed'),
    [demoAssetKey('identity.primary-email-mfa', 'Google account')]: demoAnswer('yes', 'user-confirmed'),
    [demoAssetKey('identity.primary-email-mfa', 'Apple account')]: demoAnswer('yes', 'user-confirmed'),
    [demoAssetKey('identity.primary-email-mfa', 'Bitwarden account')]: demoAnswer('yes', 'user-confirmed'),
    [demoAssetKey('identity.passkey', 'Google account')]: demoAnswer('yes'),
    [demoAssetKey('identity.recovery', 'Google account')]: demoAnswer('unsure'),
    [demoAssetKey('identity.recovery', 'Apple account')]: demoAnswer('yes', 'user-confirmed'),
    [demoAssetKey('device.auto-updates', 'MacBook')]: demoAnswer('yes'),
    [demoAssetKey('device.auto-updates', 'iPhone')]: demoAnswer('yes', 'user-confirmed'),
    [demoAssetKey('device.disk-encryption', 'MacBook')]: demoAnswer('yes', 'user-confirmed'),
    [demoAssetKey('data.restore-test', 'Photo library')]: demoAnswer('no'),
    'privacy.social-visibility': demoAnswer('unsure'),
  },
  checkupProgress: { activeDomain: 'identity', lastCompletedAt: new Date().toISOString() },
  threatModel: { concerns: ['account-takeover', 'data-loss'], audience: 'self', knowledge: 'comfortable', priority: 'balanced' },
  validationRecords: [],
  onboarding: { complete: true, goals: ['accounts', 'devices', 'files'], completedAt: new Date().toISOString() },
  settings: { language: 'en', theme: 'light', mode: 'guided', explanationDepth: 'action', threatProfile: 'essential', reviewIntervalDays: 90, autoLockMinutes: 10 },
};
