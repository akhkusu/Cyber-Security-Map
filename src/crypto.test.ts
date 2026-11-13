import { describe, expect, it } from 'vitest';
import { createEncryptedVault, decryptVault, updateEncryptedVault } from './crypto';
import { newDataset } from './models';

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
});
