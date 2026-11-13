import { describe, expect, it } from 'vitest';
import { CHECKUP_CONTROLS, CHECKUP_DOMAINS, controlKey } from './checkupCatalog';
import { datasetSchema, makeAsset, newDataset, looksLikeSecret } from './models';
import { buildGuidedFindings } from './rules';

describe('guided assessment catalog and prioritization', () => {
  it('provides at least 30 controls across the six required domains', () => {
    expect(CHECKUP_CONTROLS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(CHECKUP_CONTROLS.map((control) => control.id)).size).toBe(CHECKUP_CONTROLS.length);
    expect(new Set(CHECKUP_CONTROLS.map((control) => control.domain))).toEqual(new Set(CHECKUP_DOMAINS.map((domain) => domain.id)));
    expect(CHECKUP_DOMAINS).toHaveLength(6);
  });

  it('keeps unknown distinct from an explicitly reported gap', () => {
    const data = newDataset('en');
    const email = makeAsset({ kind: 'account', type: 'Primary email', name: 'Main email', importance: 'critical' });
    data.assets = [email];
    const unknown = buildGuidedFindings(data, 'en').find((finding) => finding.id === controlKey('identity.primary-email-mfa', email.id));
    expect(unknown?.evidence).toBe('not-assessed');
    expect(unknown?.title).toContain('Check');
    data.assessmentAnswers[controlKey('identity.primary-email-mfa', email.id)] = { response: 'unsure', evidence: 'user-reported', updatedAt: new Date().toISOString() };
    const unsure = buildGuidedFindings(data, 'en').find((finding) => finding.id === controlKey('identity.primary-email-mfa', email.id));
    expect(unsure?.evidence).toBe('unknown');
    expect(unsure?.priorityRationale).toContain('unknown to you');
    data.assessmentAnswers[controlKey('identity.primary-email-mfa', email.id)] = { response: 'no', evidence: 'user-reported', updatedAt: new Date().toISOString() };
    const reportedGap = buildGuidedFindings(data, 'en').find((finding) => finding.id === controlKey('identity.primary-email-mfa', email.id));
    expect(reportedGap?.evidence).toBe('self-reported');
    expect(reportedGap?.state).toBe('needs-improvement');
  });

  it('prioritizes a critical recovery account ahead of the same control on a useful account', () => {
    const data = newDataset('en');
    const mainEmail = makeAsset({ kind: 'account', type: 'Primary email', name: 'Main email', importance: 'critical' });
    const secondary = makeAsset({ kind: 'account', type: 'Secondary email', name: 'Newsletter email', importance: 'useful' });
    data.assets = [mainEmail, secondary];
    const findings = buildGuidedFindings(data, 'en').filter((finding) => finding.controlId === 'identity.primary-email-mfa');
    expect(findings).toHaveLength(2);
    expect(findings[0].assetId).toBe(mainEmail.id);
    expect(findings[0].priority).toBe('high');
    expect(findings[1].priority).toBe('low');
  });

  it('uses only recorded recovery dependencies when explaining priority', () => {
    const data = newDataset('en');
    const email = makeAsset({ kind: 'account', type: 'Primary email', name: 'Main email', importance: 'important' });
    data.assets = [email];
    data.dependencies = [{ id: 'edge', assetId: 'other', recoveryAssetId: email.id, relation: 'recovery', createdAt: new Date().toISOString() }];
    const finding = buildGuidedFindings(data, 'en').find((item) => item.id === controlKey('identity.primary-email-mfa', email.id));
    expect(finding?.priorityRationale).toContain('1 recovery-dependent asset');
  });

  it('preserves legacy inventory without treating it as new assessment answers', () => {
    const legacy = {
      ...newDataset('en'), softwareInventory: [{ appName: 'Sensitive app list' }], softwareSnapshot: { platform: 'Ubuntu' },
      securityAssessments: [{ host: { platform: 'Ubuntu' }, inventory: [{ appName: 'Secret inventory' }] }],
    };
    const normalized = datasetSchema.parse(legacy);
    expect(normalized.softwareInventory).toEqual(legacy.softwareInventory);
    expect(normalized.softwareSnapshot).toEqual(legacy.softwareSnapshot);
    expect(normalized.securityAssessments).toEqual(legacy.securityAssessments);
    expect(normalized.settings.language).toBe('en');
    expect(normalized.assessmentAnswers).toEqual({});
  });

  it('adds defaults for older local datasets', () => {
    const oldDataset = {
      version: 1, assets: [], dependencies: [], actions: [], incidentProgress: {}, workflowProgress: {}, reviews: [],
      onboarding: { complete: true, goals: [] }, settings: { language: 'en', theme: 'light', mode: 'guided', autoLockMinutes: 10 },
    };
    const parsed = datasetSchema.parse(oldDataset);
    expect(parsed.settings.explanationDepth).toBe('action');
    expect(parsed.settings.threatProfile).toBe('essential');
    expect(parsed.threatModel.priority).toBe('balanced');
  });
});

describe('no-secrets guard', () => {
  it('flags likely identifiers and credential material in notes', () => {
    expect(looksLikeSecret('someone@example.com')).toBe(true);
    expect(looksLikeSecret('password: hunter2')).toBe(true);
    expect(looksLikeSecret('This is a harmless nickname')).toBe(false);
  });
});
