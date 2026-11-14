import { describe, expect, it } from 'vitest';
import { createEncryptedVault, decryptVault, rekeyVault, UnsupportedVaultError, updateEncryptedVault } from './crypto';
import { makeAsset, newDataset } from './models';

// Seal raw JSON without normalizing it through the schema under test.
async function sealRaw(value: unknown) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode('original fixture phrase'), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return { format: 'personal-cyber-os-v1', algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iterations: 600000, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}

describe('encrypted local vault', () => {
  it('round-trips the dataset using the app passphrase', async () => {
    const original = { ...newDataset('ja', ['accounts']), onboarding: { complete: true, goals: ['accounts'] } };
    const created = await createEncryptedVault('long local passphrase', original);
    expect(created.envelope.ciphertext).not.toContain('accounts');
    const opened = await decryptVault(created.envelope, 'long local passphrase');
    expect(opened.data.settings.language).toBe('ja');
    expect(opened.data.onboarding.goals).toEqual(['accounts']);
    const changed = { ...opened.data, reviews: [{ id: 'review-1', completedAt: new Date().toISOString(), kind: 'weekly' as const }] };
    const updated = await updateEncryptedVault(changed, opened.context);
    expect(updated.iv).not.toBe(created.envelope.iv);
    expect((await decryptVault(updated, 'long local passphrase')).data.reviews).toHaveLength(1);
  });

  it('returns a safe error for a wrong passphrase', async () => {
    const created = await createEncryptedVault('long local passphrase', newDataset());
    await expect(decryptVault(created.envelope, 'incorrect passphrase')).rejects.toThrow('wrong-passphrase-or-damaged-vault');
  });

  it('retains opaque legacy fields through migration, an ordinary edit, and rekeying', async () => {
    const legacyBase = JSON.parse(JSON.stringify(newDataset('ja'))); legacyBase.version = 1; delete legacyBase.securityModel; delete legacyBase.deviceWorkflows;
    const fixture = {
      ...legacyBase, softwareInventory: [{ appName: 'Legacy app', custom: { retained: true } }],
      assets: [{ ...makeAsset({ kind: 'account', type: 'Primary email', name: 'Old account', importance: 'critical' }), historicalMetadata: { source: 'older version' } }],
      actions: [{ id: 'old', status: 'completed', originalEvidence: { retained: true } }],
      settings: { ...newDataset().settings, language: 'ja', legacyPreference: { retained: true } },
      guide: { cursor: 'start', history: [], answers: {}, resumeMetadata: { retained: true }, steps: { 'legacy-step': { status: 'done', updatedAt: '2025-01-01', originalProof: { retained: true } } } },
      onboarding: { complete: true, goals: [], oldSetup: { retained: true } },
      checkupProgress: { activeDomain: 'identity', originalPosition: { retained: true } },
      assessmentAnswers: { old: { response: 'yes', evidence: 'user-reported', updatedAt: '2025-01-01', originalProof: { retained: true } } },
    };
    const envelope = { ...await sealRaw(fixture), historicalMetadata: { source: 'original export' } };
    const opened = await decryptVault(envelope, 'original fixture phrase');
    expect(opened.data).toMatchObject(fixture);
    const updated = await updateEncryptedVault({ ...opened.data, settings: { ...opened.data.settings, language: 'en' } }, opened.context);
    expect(updated.historicalMetadata).toEqual(envelope.historicalMetadata);
    const edited = await decryptVault(updated, 'original fixture phrase');
    const changedKey = await rekeyVault(edited.data, 'different storage-only phrase', edited.context);
    expect(changedKey.envelope.historicalMetadata).toEqual(envelope.historicalMetadata);
    const restored = (await decryptVault(changedKey.envelope, 'different storage-only phrase')).data;
    expect(restored).toMatchObject({ ...fixture, settings: { ...fixture.settings, language: 'en' } });
  });

  it('identifies newer payload versions without rewriting them or calling them a wrong passphrase', async () => {
    const envelope = await sealRaw({ ...newDataset(), version: 3, futureEntities: [{ id: 'preserve-this' }] });
    const original = structuredClone(envelope);
    await expect(decryptVault(envelope, 'original fixture phrase')).rejects.toMatchObject({ name: 'UnsupportedVaultError', kind: 'version' });
    expect(envelope).toEqual(original);
  });

  it('rejects unsupported envelopes and incompatible decrypted data with safe errors', async () => {
    await expect(decryptVault({ format: 'future-format' }, 'original fixture phrase')).rejects.toBeInstanceOf(UnsupportedVaultError);
    const incompatible = await sealRaw({ ...newDataset(), assets: 'not-an-array', privateNote: 'must not appear in errors' });
    await expect(decryptVault(incompatible, 'original fixture phrase')).rejects.toMatchObject({ message: 'unsupported-vault-data' });
  });

  it('identifies a newer security-model revision and preserves the original encrypted file', async () => {
    const data = newDataset(), envelope = await sealRaw({ ...data, securityModel: { ...data.securityModel, revision: 14 } });
    const original = structuredClone(envelope);
    await expect(decryptVault(envelope, 'original fixture phrase')).rejects.toMatchObject({ name: 'UnsupportedVaultError', kind: 'version' });
    expect(envelope).toEqual(original);
  });
  it('preserves opaque older fact metadata without interpreting it as phone-independence evidence', async () => {
    const data = newDataset(), fact = { id: 'legacy-fact', label: 'Legacy observation', state: 'unknown', evidence: 'unknown', checkedAt: '2025-01-01T00:00:00Z', requiredRefs: [], contexts: ['normal'], sourceIds: [], observedWithoutRefs: { keep: true }, cloudPhoneObservation: { keep: true } };
    const envelope = await sealRaw({ ...data, securityModel: { ...data.securityModel, facts: [fact] } });
    const opened = await decryptVault(envelope, 'original fixture phrase');
    const updated = await updateEncryptedVault(opened.data, opened.context);
    expect((await decryptVault(updated, 'original fixture phrase')).data).toMatchObject({ securityModel: { facts: [fact] } });
  });
});
