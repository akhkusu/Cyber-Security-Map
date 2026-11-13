import { expect, type Page } from '@playwright/test';
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
