import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

async function createWorkspace(page: Page) {
  await page.goto('/lab/cyber-security-map');
  await page.locator('.language-picker select').selectOption('en');
  await page.getByRole('button', { name: 'Start Security Checkup' }).click();
  await page.getByLabel('App passphrase', { exact: true }).fill('my private app phrase');
  await page.getByLabel('Confirm passphrase').fill('my private app phrase');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Account takeover' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const emailQuestion = page.locator('.question-row').filter({ hasText: 'Is multi-factor authentication on your main email?' });
  await emailQuestion.getByRole('button', { name: 'No', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Good to see you.' })).toBeVisible({ timeout: 20_000 });
}

test('a new user receives a tailored plan and can manage a digital asset', async ({ page }) => {
  await createWorkspace(page);
  await expect(page.locator('.next-action-card h2')).not.toBeEmpty();
  await expect(page.getByRole('link', { name: 'Security checkup' })).toBeVisible();
  await page.getByRole('button', { name: 'Guide me' }).click();
  await expect(page.getByRole('heading', { name: 'Security Checkup' })).toBeVisible();

  await page.getByRole('link', { name: 'My digital life' }).click();
  await page.getByRole('button', { name: 'Add something' }).click();
  await page.getByLabel('Category').selectOption('device');
  await page.getByLabel('Friendly nickname').fill('Work tablet');
  await page.getByLabel('Operating system').selectOption('android');
  await page.getByRole('button', { name: 'Add to inventory' }).click();
  await expect(page.getByRole('button', { name: /Work tablet/ })).toBeVisible();
  await page.getByRole('button', { name: /Work tablet/ }).click();
  await page.getByLabel('Friendly nickname').fill('Travel tablet');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: /Travel tablet/ })).toBeVisible();
  await page.getByRole('button', { name: /Travel tablet/ }).click();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: /Travel tablet/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Primary email/ }).click();
  await page.getByLabel('Multi-factor authentication').selectOption('verified');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('link', { name: 'Protection plan' }).click();
  await expect(page.getByText('Enable a second sign-in step on your primary email')).toHaveCount(0);

  await page.getByRole('link', { name: 'Recovery & Emergency' }).click();
  await page.getByRole('button', { name: 'Link a recovery path' }).click();
  await page.getByLabel('Account that needs recovery').selectOption({ label: 'Primary email' });
  await page.getByLabel('Recovery method it relies on').selectOption({ label: 'Primary smartphone' });
  await page.getByPlaceholder('For example: recovery email').fill('backup phone');
  await page.getByRole('button', { name: 'Save path' }).click();
  await expect(page.locator('.dependency-row')).toContainText('Primary email');
  await page.getByLabel('Choose unavailable asset').selectOption({ label: 'Primary smartphone' });
  await expect(page.getByText(/1 recovery path depends on this asset/)).toBeVisible();

  await page.getByRole('button', { name: /Lost or stolen smartphone/ }).click();
  await expect(page.getByText(/mark it lost or lock it/)).toBeVisible();
  const planReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export offline emergency plan' }).click();
  expect((await planReady).suggestedFilename()).toContain('cyber-security-map-emergency-plan');
});

test('the vault encrypts saved data and rejects a wrong passphrase', async ({ page }) => {
  await createWorkspace(page);
  const envelope = await page.evaluate(async () => new Promise<Record<string, string>>((resolve, reject) => {
    const open = indexedDB.open('personal-cyber-os', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction('encrypted-vault', 'readonly').objectStore('encrypted-vault').get('primary');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  }));
  expect(envelope.algorithm).toBe('AES-256-GCM');
  expect(JSON.stringify(envelope)).not.toContain('Primary email');

  await page.getByRole('link', { name: 'My digital life' }).click();
  await page.getByRole('button', { name: 'Add something' }).click();
  await page.getByLabel('Category').selectOption('device');
  await page.getByLabel('Friendly nickname').fill('Work tablet');
  await page.getByRole('button', { name: 'Add to inventory' }).click();
  await page.getByRole('button', { name: 'Settings and help' }).click();
  await page.getByRole('button', { name: 'Lock workspace' }).click();
  await page.getByLabel('App passphrase').fill('not the right passphrase');
  await page.getByRole('button', { name: 'Unlock workspace' }).click();
  await expect(page.getByText('That passphrase did not open the vault.')).toBeVisible();
  await page.getByLabel('App passphrase').fill('my private app phrase');
  await page.getByRole('button', { name: 'Unlock workspace' }).click();
  await expect(page.getByRole('heading', { name: 'My digital life' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Work tablet/ })).toBeVisible();
});

test('an encrypted backup can be exported and restored', async ({ page }) => {
  await createWorkspace(page);
  await page.getByRole('button', { name: 'Settings and help' }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const downloadReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download encrypted backup' }).click();
  const download = await downloadReady;
  const backupPath = await download.path();
  if (!backupPath) throw new Error('Backup download did not create a file');
  expect(download.suggestedFilename()).toContain('cyber-security-map-backup');

  page.on('dialog', (dialog) => dialog.accept());
  await page.getByLabel('Choose backup file').setInputFiles(backupPath);
  await page.getByPlaceholder('Backup passphrase').fill('my private app phrase');
  await page.getByRole('button', { name: 'Restore and replace' }).click();
  await expect(page.getByText('Encrypted backup restored.')).toBeVisible();
});
