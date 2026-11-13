import { describe, expect, it } from 'vitest';
import { makeAsset, newDataset, looksLikeSecret } from './models';
import { buildFindings, controlsSummary } from './rules';

describe('security recommendations', () => {
  it('creates actionable guidance when a critical email has unknown MFA', () => {
    const email = makeAsset({ kind: 'account', type: 'Primary email', name: 'Main email', importance: 'critical' });
    const findings = buildFindings([email], 'en');
    expect(findings.some((finding) => finding.controlId === 'mfa' && finding.priority === 'high')).toBe(true);
    expect(findings.find((finding) => finding.controlId === 'mfa')?.how).toContain('account security settings');
  });

  it('removes findings after a control is verified and keeps unknown separate', () => {
    const laptop = makeAsset({ kind: 'device', type: 'Laptop', name: 'Main computer', importance: 'important' }, { encryption: 'verified' });
    expect(buildFindings([laptop], 'ja').some((finding) => finding.controlId === 'encryption')).toBe(false);
    expect(controlsSummary([laptop]).verified).toBe(1);
    expect(controlsSummary([laptop]).assessed).toBe(1);
  });

  it('does not count unassessed controls as verified', () => {
    const empty = newDataset('ja');
    const phone = makeAsset({ kind: 'device', type: 'Smartphone', name: 'Phone', importance: 'important' });
    const summary = controlsSummary([phone]);
    expect(summary.verified).toBe(0);
    expect(summary.assessed).toBe(0);
    expect(buildFindings([phone], 'ja').length).toBeGreaterThan(0);
    expect(empty.assets).toHaveLength(0);
  });

  it('sorts high-impact account sign-in checks ahead of device housekeeping', () => {
    const laptop = makeAsset({ kind: 'device', type: 'Laptop', name: 'Main computer', importance: 'critical' }, { backup: 'needs-improvement' });
    const email = makeAsset({ kind: 'account', type: 'Primary email', name: 'Main email', importance: 'critical' });
    expect(buildFindings([laptop, email], 'en')[0].controlId).toBe('mfa');
  });
});

describe('no-secrets guard', () => {
  it('flags likely identifiers and credential material in notes', () => {
    expect(looksLikeSecret('someone@example.com')).toBe(true);
    expect(looksLikeSecret('password: hunter2')).toBe(true);
    expect(looksLikeSecret('This is a harmless nickname')).toBe(false);
  });
});
