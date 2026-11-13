import { expect, type Page } from '@playwright/test';
import { webcrypto } from 'node:crypto';
export const passphrase = 'test-only encrypted storage phrase';
export async function createWorkspace(page: Page, language = 'ja') {
  await page.goto('./'); await page.locator('.language-picker select').selectOption(language);
  await page.getByRole('button', { name: language === 'ja' ? '対策を始める' : 'Start the guide', exact: true }).click();
  await page.getByLabel(language === 'ja' ? 'アプリの保存用パスフレーズ' : 'App passphrase', { exact: true }).fill(passphrase);
  await page.getByLabel(language === 'ja' ? '同じフレーズをもう一度' : 'Confirm passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: language === 'ja' ? '保存して始める' : 'Save and start', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(language === 'ja' ? 'よく使うメール' : 'Which email account');
}
export async function chooseApple(page: Page, platform: 'ios' | 'macos' | 'web' = 'ios') {
  await page.getByRole('button', { name: 'メールサービスを選ぶ', exact: true }).click();
  await page.getByRole('button', { name: /iCloud \/ Apple Account/ }).click();
  await page.getByRole('button', { name: '別のアカウントとして追加する', exact: true }).click();
  await page.getByRole('button', { name: '個人用', exact: true }).click();
  await page.getByRole('button', { name: platform === 'ios' ? 'iPhone / iPad を追加' : platform === 'macos' ? 'Mac を追加' : /^Webの設定画面で進める/, exact: platform !== 'web' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('アカウントの設定を開く');
}
export async function advance(page: Page, name = '次へ') { await page.getByRole('button', { name: name === 'Webの設定画面で進める' ? /^Webの設定画面で進める/ : name, exact: name !== 'Webの設定画面で進める' }).click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false'); }
export async function mfaState(page: Page, platform: 'ios' | 'macos' | 'web' = 'ios') {
  await advance(page); if (platform !== 'web') await advance(page); await advance(page); await advance(page, '使えることを確認しました');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('すでに認証は有効になっていますか？');
}
export async function exportVault(page: Page) {
  await page.getByRole('link', { name: '設定', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '暗号化バックアップを保存する', exact: true }).click();
  const file = await (await download).path(); if (!file) throw new Error('missing download');
  const { readFile } = await import('node:fs/promises'); return JSON.parse(await readFile(file, 'utf8'));
}

// Build historical and newer fixtures without passing through the current app schema.
export async function sealRawVault(value: unknown) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16)), iv = webcrypto.getRandomValues(new Uint8Array(12));
  const material = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { format: 'personal-cyber-os-v1', algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iterations: 600000, salt: Buffer.from(salt).toString('base64'), iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(ciphertext).toString('base64') };
}

export async function readSavedVault(page: Page) {
  return page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open('personal-cyber-os', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('encrypted-vault').objectStore('encrypted-vault').get('primary');
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }));
}

export async function writeSavedVault(page: Page, value: unknown) {
  await page.evaluate(value => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('personal-cyber-os', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('encrypted-vault', 'readwrite');
      transaction.objectStore('encrypted-vault').put(value, 'primary');
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }), value);
}

export async function prepareAuthenticator(page: Page, product = 'Bitwarden Authenticator（単独アプリ）', mode: 'local' | 'account' = 'local', rootName?: string, manual = false) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('どの認証アプリを使いますか？');
  await advance(page, product);
  await page.locator('.guide-card .choice').first().click(); await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
  if (product === 'Google 認証システム') {
    await advance(page, mode === 'local' ? 'アカウントなしで使う' : 'Google アカウントと同期する');
    if (mode === 'account') await advance(page, rootName!);
  } else await advance(page);
  for (let i = 0; i < 8; i++) {
    if (await page.getByRole('heading', { level: 1, name: '登録用のQRコードは、どの画面にありますか？', exact: true }).isVisible()) break;
    const buttons = page.locator('.guide-card .primary-actions button'); await expect(buttons).toHaveCount(1); await buttons.click();
    await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy', 'false');
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('登録用のQRコードは、どの画面にありますか？');
  await advance(page, manual ? '同じスマホにあり、手入力用の設定キーも表示されている' : '別の画面にあり、このスマホで読み取れる');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('選んだアプリへ今回のアカウントを追加する');
}
