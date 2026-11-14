import { ENTE_SOURCES } from './enteSources';
import {TWOFAS_SOURCES} from './twofasSources';
import type { Asset, Language } from './models';
import { CLOUD_SOURCES } from './cloudSources';
import { privatePassphraseStep } from './passphraseCatalog';

export type Copy = { en: string; ja: string };
export const c = (en: string, ja: string): Copy => ({ en, ja });
export const say = (copy: Copy, language: Language) => copy[language];
export type Source = { title: string; url: string; checked: string; scope: string; reviewMethod: 'official-documentation' | 'official-search-excerpt' };
const source = (title: string, url: string, scope: string): Source => ({ title, url, scope, checked: '2026-11-13', reviewMethod: 'official-documentation' });
export const SOURCES = {
  ...ENTE_SOURCES,
  ...TWOFAS_SOURCES,
  ...CLOUD_SOURCES,
  applePasswords: source('Apple · パスワードアプリ', 'https://support.apple.com/ja-jp/120758', 'iOS / iPadOS 18+ / macOS Sequoia+'),
  appleKeychain: source('Apple · iCloudキーチェーン', 'https://support.apple.com/ja-jp/109016', 'Account / device approval / sync'),
  appleSaved: source('Apple · 保存済みのパスワード', 'https://support.apple.com/ja-jp/104955', 'iOS 18+ / older Settings path'),
  appleMacSaved: source('Apple · Macの保存済みパスワード', 'https://support.apple.com/ja-jp/105115', 'macOS Sequoia+ / Passwords app'),
  appleCreatePassword: { ...source('Apple · iPhoneでパスワードを作成', 'https://support.apple.com/ja-jp/guide/iphone/iph4ebb320ea/27/ios/27', 'Passwords / manual item / official indexed text'), reviewMethod: 'official-search-excerpt' as const },
  appleMacCreatePassword: { ...source('Apple · Macでパスワードを作成', 'https://support.apple.com/guide/passwords/create-a-password-mchla6acb8cb/mac', 'Passwords / manual item / official indexed text'), reviewMethod: 'official-search-excerpt' as const },
  appleDeviceSignin: source('Apple · 端末のAccountへサインイン', 'https://support.apple.com/ja-jp/111001', 'iPhone / iPad / Mac / existing Account'),
  chromeSigninAndroid: source('Google · Android Chromeのログイン', 'https://support.google.com/chrome/answer/185277?co=GENIE.Platform%3DAndroid&hl=ja', 'Existing Google Account / Android'),
  chromeSigninIos: source('Google · iOS Chromeのログイン', 'https://support.google.com/chrome/answer/185277?co=GENIE.Platform%3DiOS&hl=ja', 'Existing Google Account / iOS'),
  chromeSignin: source('Google · PCのChromeログイン', 'https://support.google.com/chrome/answer/16737508?hl=ja', 'Existing Google Account / desktop'),
  googleManager: source('Google · パスワードマネージャー', 'https://support.google.com/accounts/answer/6208650?hl=ja', 'Google Account / local / recovery'),
  chromePasswords: source('Google · Chromeのパスワード管理', 'https://support.google.com/chrome/answer/95606?hl=ja', 'Desktop Chrome / account and local storage'),
  chromePasswordsAndroid: source('Google · Android Chromeのパスワード', 'https://support.google.com/chrome/answer/95606?co=GENIE.Platform%3DAndroid&hl=ja', 'Android Chrome'),
  chromePasswordsIos: source('Google · iOS Chromeのパスワード', 'https://support.google.com/chrome/answer/95606?co=GENIE.Platform%3DiOS&hl=ja', 'iPhone / iPad Chrome'),
  chromeInstall: source('Google · Chromeのインストール', 'https://support.google.com/chrome/answer/95346?co=GENIE.Platform%3DDesktop&hl=ja', 'Desktop Chrome / installer'),
  chromeInstallAndroid: source('Google · AndroidにChromeを入れる', 'https://support.google.com/chrome/answer/95346?co=GENIE.Platform%3DAndroid&hl=ja', 'Android 10+ / Google Play'),
  chromeInstallIos: source('Google · iPhoneにChromeを入れる', 'https://support.google.com/chrome/answer/95346?co=GENIE.Platform%3DiOS&hl=ja', 'iOS / iPadOS 18+ / App Store'),
  chromeExport: source('Google · パスワードの書き出し', 'https://support.google.com/chrome/answer/13068232?co=GENIE.Platform%3DDesktop&hl=en', 'Desktop Chrome / readable CSV export'),
  chromeExportAndroid: source('Google · Androidの書き出しと取り込み', 'https://support.google.com/chrome/answer/13068232?co=GENIE.Platform%3DAndroid&hl=ja', 'Android Chrome / CSV versus app transfer'),
  startmailMfa: source('StartMail · Two-factor authentication', 'https://support.startmail.com/hc/en-us/articles/360006682158-Two-factor-authentication-2FA', 'StartMail / Web'),
  startmailPassword: source('StartMail · Changing password', 'https://support.startmail.com/hc/en-us/articles/360006635417-Changing-your-password', 'Account password / not PGP passphrase'),
  startmailPgp: source('StartMail · PGP passphrase', 'https://support.startmail.com/hc/en-us/articles/360006842578-PGP-passphrase', 'Account password / PGP distinction'),
  mailcomMfa: source('mail.com · Two-factor setup', 'https://support.mail.com/security/2fa/setup-twofactor.html', 'mail.com / Web'),
  gmxMfa: source('GMX.com · Two-factor setup', 'https://support.gmx.com/security/2fa/setup-twofactor.html', 'GMX.com / excludes GMX.de'),
  portalQr: source('mail.com · Same-device QR setup', 'https://support.mail.com/security/2fa/scan-problems.html', 'Manual registration / same device'),
  protonPassword: source('Proton · Change password', 'https://proton.me/support/how-to-change-your-password', 'Known current password / Web'),
  zohoPassword: source('Zoho · Change password', 'https://help.zoho.com/portal/en/kb/accounts/faqs-troubleshooting/faqs/password-recovery/articles/how-do-i-change-my-account-password', 'Known current password / Web'),
  yahooPassword: source('Yahoo · Change password', 'https://ca.help.yahoo.com/kb/reset-existing-password-sln27051.html', 'Yahoo.com / Web'),
  protonMfa: source('Proton · Authenticator 2FA', 'https://proton.me/support/2fa-authenticator-app', 'Proton Account / Web'),
  fastmailPassword: source('Fastmail · Password and account security', 'https://www.fastmail.help/hc/en-us/articles/9822848635919-Guide-to-Fastmail-for-Pobox-users', 'Fastmail / Privacy & Security'),
  fastmailMfa: source('Fastmail · Two-step verification', 'https://www.fastmail.help/hc/en-us/articles/360058752374-Using-two-step-verification-2FA', 'Fastmail / Web'),
  tutaMfa: source('Tuta · Login and second factor', 'https://tuta.com/support/howto', 'Tuta Mail / Login settings'),
  zohoMfa: source('Zoho · OTP Authenticator', 'https://help.zoho.com/portal/en/kb/accounts/multi-factor-authentication/articles/mfa-totp', 'Zoho Account / OTP authenticator'),
  zohoRecovery: source('Zoho · Backup verification codes', 'https://help.zoho.com/portal/en/kb/accounts/multi-factor-authentication/articles/mfa-backup-verification-codes', 'Zoho Account / Web'),
  yahooMfa: source('Yahoo · Two-step verification', 'https://help.yahoo.com/kb/account/enable-two-step-verification-sln5013.html', 'Yahoo.com / excludes Yahoo! JAPAN'),
  macLock: source('Apple · Require a password after waking', 'https://support.apple.com/en-gb/guide/mac-help/mchlp2270/27/mac/27', 'macOS / Lock Screen'),
  windowsLock: source('Microsoft · Sign-in options', 'https://support.microsoft.com/en-us/accounts-billing/security/sign-in-options-in-windows', 'Windows 11'),
  applePassword: source('Apple · Change account password', 'https://support.apple.com/en-ae/101567', 'iPhone / Mac / Web'),
  googlePassword: source('Google · Change password', 'https://support.google.com/accounts/answer/41078?hl=ja', 'Personal Google Account'),
  microsoftPassword: source('Microsoft · Change password', 'https://support.microsoft.com/en-gb/accounts-billing/manage/change-your-microsoft-account-password', 'Personal Microsoft account'),
  opGenerate: source('1Password · Generate website passwords', 'https://support.1password.com/generate-website-password/', 'Desktop / mobile apps / browser'),
  windowsUpdate: source('Microsoft · Windows Update', 'https://support.microsoft.com/en-us/windows/deployment/updates-lifecycle/troubleshoot-problems-updating-windows', 'Windows 11'),
  iosLock: source('Apple · Device passcode', 'https://support.apple.com/en-ie/119586', 'iPhone / iPad'),
  androidLock: source('Google · Screen lock', 'https://support.google.com/android/answer/9079129', 'Android / manufacturer variations'),
  appleMfa: source('Apple · 2ファクタ認証 / Two-factor authentication', 'https://support.apple.com/ja-jp/102660', 'iPhone / iPad / Mac / Web'),
  appleSecurityKeys: { ...source('Apple · Account security keys', 'https://support.apple.com/ja-jp/102637', 'FIDO Certified / separate spare / limits of recovery'), checked: '2026-11-14' },
  appleRecovery: source('Apple · Trusted phone numbers and devices', 'https://support.apple.com/en-us/122621', 'iOS / iPadOS / macOS / Web'),
  googleAuthMenus: source('iA · Google Authenticatorの導入・操作図', 'https://files.ia.ca/-/media/files/ia/authentification-multifactorielle-conseillers/pdf/2025/f13-1234a_installationguide_googleauthenticator_advisors_acc.pdf', 'App menu images in official service deployment guide / not a Google service enrollment recipe'),
  bwAuthenticator: source('Bitwarden · 単独のAuthenticatorアプリ', 'https://bitwarden.com/help/bitwarden-authenticator/', 'iOS 15+ / Android 9+ / local versus synced codes'),
  bwAuthenticatorExport: source('Bitwarden · Authenticatorの書き出しと取り込み', 'https://bitwarden.com/help/authenticator-import-export/', 'Readable JSON/CSV / local codes only'),
  microsoftAuthFaq: source('Microsoft · Authenticator FAQ', 'https://support.microsoft.com/en-us/authenticator/microsoft-authenticator-faqs', 'App Lock / TOTP versus notifications / retired autofill'),
  microsoftAuthBackup: source('Microsoft · Authenticatorのバックアップ', 'https://support.microsoft.com/en-us/authenticator/back-up-your-accounts-in-microsoft-authenticator', 'Same OS only / Android backup changes announced for January 2027'),
  googleAuth: source('Google · Authenticator setup', 'https://support.google.com/accounts/answer/1066447?hl=ja', 'Google Account / authenticator'),
  microsoftAuth: source('Microsoft · Add Authenticator', 'https://support.microsoft.com/en-gb/authenticator/how-to-add-your-accounts-to-microsoft-authenticator', 'Personal account / QR enrollment'),
  googleMfa: source('Google · 2 段階認証プロセス', 'https://support.google.com/accounts/answer/185839?hl=ja', 'Personal Google Account / Web'),
  googleRecovery: source('Google · Backup codes', 'https://support.google.com/accounts/answer/1187538', 'Personal Google Account / Web'),
  microsoftMfa: source('Microsoft · Two-step verification', 'https://support.microsoft.com/en-us/accounts-billing/security/how-to-use-two-step-verification-with-your-microsoft-account', 'Personal Microsoft Account / Web'),
  bwCreate: source('Bitwarden · Create an account', 'https://bitwarden.com/help/create-bitwarden-account/', 'Personal account / Web'),
  bwMaster: source('Bitwarden · Master password', 'https://bitwarden.com/help/master-password/', 'Personal account'),
  bwPhrase: source('Bitwarden · Passphrase length', 'https://bitwarden.com/passphrase-generator/', 'Random passphrases / word count'),
  opLength: source('1Password · Password length', 'https://1password.com/blog/how-long-should-my-passwords-be', 'Random word generator'),
  bwGenerator: source('Bitwarden · Password generator', 'https://bitwarden.com/help/generator/', 'Web app / generator'),
  bwUse: source('Bitwarden · Password Manager Web App', 'https://bitwarden.com/help/getting-started-webvault/', 'Web app'),
  bwMfa: source('Bitwarden · Authenticator two-step login', 'https://bitwarden.com/help/setup-two-step-login-authenticator/', 'Web app / standalone authenticator'),
  bwRecovery: source('Bitwarden · Recovery code', 'https://bitwarden.com/help/two-step-recovery-code/', 'Web app'),
  opStart: source('1Password · Get started', 'https://support.1password.com/explore/get-started/', 'Individual / family account'),
  opMaster: source('1Password · Choose an account password', 'https://support.1password.com/strong-account-password/', 'Account password'),
  opKit: source('1Password · Emergency Kit', 'https://support.1password.com/emergency-kit/', 'Web account management'),
  opRecovery: source('1Password · Recovery codes', 'https://support.1password.com/recovery-codes/', 'Individual / family account'),
  opMfa: source('1Password · Two-factor authentication', 'https://support.1password.com/two-factor-authentication/', 'Web account management'),
  opUse: source('1Password · Create and edit items on the web', 'https://support.1password.com/1password-com-items/', '1Password.com / Web'),
  opUseIos: source('1Password · iOS items', 'https://support.1password.com/getting-started-ios/', 'iOS'),
  opUseAndroid: source('1Password · Android items', 'https://support.1password.com/getting-started-android/', 'Android'),
  opUseMac: source('1Password · Mac items', 'https://support.1password.com/getting-started-mac/', 'macOS'),
  opUseWindows: source('1Password · Windows items', 'https://support.1password.com/getting-started-windows/', 'Windows'),
  iosBackup: source('Apple · Back up with iCloud', 'https://support.apple.com/en-us/108366', 'iOS / iPadOS'),
  iosUpdate: source('Apple · iPhone / iPad updates', 'https://support.apple.com/ja-jp/118575', 'Current iOS / iPadOS'),
  macBackup: source('Apple · Time Machine', 'https://support.apple.com/en-us/104984', 'macOS Ventura 13 or later'),
  macUpdate: source('Apple · macOS updates', 'https://support.apple.com/ja-jp/108382', 'System Settings / macOS'),
  androidUpdate: source('Google · Android updates', 'https://support.google.com/android/answer/7680439', 'Android / manufacturer variations'),
  androidBackup: source('Google · Android backup', 'https://support.google.com/android/answer/2819582', 'Android 9+ / personal device'),
  windowsBackup: source('Microsoft · Windows Backup', 'https://support.microsoft.com/en-us/windows/experience/backup-recovery/back-up-and-restore-with-windows-backup', 'Windows 11 / personal Microsoft account'),
} satisfies Record<string, Source>;
export type SourceId = keyof typeof SOURCES;
export type GuideStep = {
  id: string; title: Copy; place: Copy; action: Copy; expected: Copy;
  button?: Copy; sources: SourceId[]; url?: string; target?: Copy;
  choices?: { label: Copy; next: string }[];
  extraControls?: { targetRef: string; controlId: string }[];
  setupHelp?: { title: Copy; action: Copy; url?: string };
  control?: string; // Only the final, explicitly confirmed state updates a control.
  diagram?: Copy[];
  explanation?: Copy;
  technical?: 'mfa' | 'password' | 'backup' | 'updates';
  download?: { path: string; filename: string; label: Copy; attribution: Copy };
  requires?: string[];
};
export type Recipe = { id: string; title: Copy; steps: GuideStep[] };
const next = c('Next', '次へ');
const checked = c('I checked this', '確認しました');
const step = (id: string, title: Copy, place: Copy, action: Copy, expected: Copy, sources: SourceId[], extra: Partial<GuideStep> = {}): GuideStep => ({ id, title, place, action, expected, sources, button: next, ...extra });
export const PROVIDERS = { apple: 'iCloud / Apple Account', google: 'Gmail / Google', microsoft: 'Outlook / Microsoft', proton: 'Proton Mail', fastmail: 'Fastmail', tuta: 'Tuta / Tutanota', zoho: 'Zoho Mail', yahoo: 'Yahoo.com', startmail: 'StartMail', mailcom: 'mail.com', gmx: 'GMX.com', bitwarden: 'Bitwarden', '1password': '1Password', nord: 'Nord Account', ente: 'Ente Account', other: 'Other' };
export const PLATFORMS = { ios: 'iPhone / iPad', macos: 'Mac', android: 'Android', windows: 'Windows', web: 'Web' };
export type Platform = keyof typeof PLATFORMS;

export function emailRecipe(provider: Asset['provider'], platform: string): Recipe {
  if (isExtendedMail(provider)) return extendedEmailRecipe(provider);
  const apple = provider === 'apple';
  const google = provider === 'google';
  const s: SourceId = apple ? 'appleMfa' : google ? 'googleMfa' : 'microsoftMfa';
  const place = c(apple ? platform === 'ios' ? 'iPhone / iPad · Settings' : platform === 'macos' ? 'Mac · System Settings' : 'Apple Account · Web' : google ? 'Google Account · Web' : 'Microsoft account · Web', apple ? platform === 'ios' ? 'iPhone / iPad の「設定」' : platform === 'macos' ? 'Mac の「システム設定」' : 'Apple Account のWeb設定' : google ? 'Google アカウントのWeb設定' : 'Microsoft アカウントのWeb設定');
  const url = apple ? 'https://account.apple.com/' : google ? 'https://myaccount.google.com/' : 'https://account.microsoft.com/security';
  const steps: GuideStep[] = [step('open', c('Open your account settings', 'アカウントの設定を開く'), place,
    c(apple && platform !== 'web' ? 'Open Settings on your iPhone or iPad, or System Settings on your Mac.' : 'Open the official account settings and sign in to the account you selected here.', apple && platform !== 'web' ? platform === 'ios' ? 'ホーム画面から「設定」を開いてください。' : 'Appleメニューから「システム設定」を開いてください。' : '公式の設定画面を開き、今回選んだアカウントでサインインしてください。'),
    c('Your account settings are open.', '今回のアカウントの設定画面が開いていること。'), [s], apple && platform !== 'web' ? {} : { url })];
  if (apple && platform !== 'web') steps.push(step('account', c('Select your name', '自分の名前を選ぶ'), place, c('Select your name. Check that this is the Apple Account used for your email.', '自分の名前を選び、メールで使っているApple Accountであることを確認してください。'), c('Your Apple Account settings are displayed.', 'Apple Accountの設定が表示されること。'), [s]));
  steps.push(step('security', c('Open sign-in settings', 'サインインの設定を開く'), place,
    c(apple ? 'Select Sign-In & Security.' : google ? 'Select Security & sign-in, then find How you sign in to Google.' : 'Select Manage how I sign in.', apple ? '「サインインとセキュリティ」を選んでください。' : google ? '「セキュリティとログイン」を選び、「Google にログインする方法」を見つけてください。' : '「サインイン方法の管理（Manage how I sign in）」を選んでください。'),
    c('The sign-in and security options are visible.', '認証方法やセキュリティの項目が表示されること。'), [s], { diagram: [c('Account settings', 'アカウントの設定'), c('Sign-in & security', 'サインインとセキュリティ')] }));
  steps.push(step('ready', c('Keep a way back into your account', 'ログインを取り戻す手段を確保する'), place,
    c(apple ? 'Keep your current signed-in session open. Have a phone number where you can receive verification codes ready.' : google ? 'Keep this signed-in session open. Check that you can use your recovery email or phone before changing authentication.' : 'Keep your signed-in session open. Have three pieces of security info available, such as an authenticator and alternate email addresses. Confirm that you can access them.', apple ? '現在ログインしている画面を閉じず、確認コードを受け取れる電話番号を手元に用意してください。' : google ? '現在のログインを保ったまま、再設定用のメールか電話番号が使えることを確認してください。' : '現在のログインを保ち、認証アプリや別のメールなど、本人確認用の情報を3つ用意し、使えることを確認してください。'),
    c('You can access your recovery or verification method. Do not remove any existing sign-in method.', '本人確認や復旧の手段を使えること。既存の認証方法は削除しません。'), [apple ? 'appleRecovery' : s], { button: c('I have access', '使えることを確認しました') }));
  steps.push(step('state', c('Is two-step verification already on?', 'すでに認証は有効になっていますか？'), place,
    c(apple ? platform === 'web' ? 'Open Account Security and check the two-factor authentication state.' : 'Select Two-Factor Authentication and check its current state.' : google ? 'Open 2-Step Verification and check whether it is on.' : 'Find Two-step verification under Additional security and check its state.', apple ? platform === 'web' ? '「アカウントセキュリティ」を開き、2ファクタ認証の状態を確認してください。' : '「2ファクタ認証」を選び、現在の状態を確認してください。' : google ? '「2 段階認証プロセス」を開き、現在の状態を確認してください。' : '「追加のセキュリティ」の「2段階認証」を見つけ、現在の状態を確認してください。'),
    c('An enabled state or a control to turn it on is shown.', '有効な状態、または有効にするための項目が表示されること。'), [s], { choices: [{ label: c('It is already on', 'すでに有効になっている'), next: 'verify' }, { label: c('It is off', 'まだ有効になっていない'), next: 'enable' }] }));
  steps.push(step('enable', c('Turn on two-step verification', '認証を有効にする'), place,
    c(apple ? platform === 'web' ? 'Select Upgrade Account Security.' : 'Turn on Two-Factor Authentication.' : google ? 'Select Turn on 2-Step Verification.' : 'Under Two-step verification, select Turn on.', apple ? platform === 'web' ? '「アカウントセキュリティをアップグレード」を選んでください。' : '2ファクタ認証をオンにしてください。' : google ? '「2 段階認証プロセスを有効にする」を選んでください。' : '「2段階認証」の「有効にする（Turn on）」を選んでください。'),
    c('The official setup flow has started.', '公式の設定手続きが開始されること。'), [s]));
  steps.push(step('enroll', c('Register the verification method', '本人確認の方法を登録する'), place,
    c('Use a phone number you control for the verification requested by Apple. Enter any code only in Apple’s settings.', 'Appleの画面で、受信できる電話番号の確認を進めてください。コードはAppleの画面だけに入力してください。'),
    c('Setup finishes and returns to the security settings.', '設定手続きが終わり、セキュリティの設定へ戻れること。'), [s]));
  if (!apple) {
    const enrollment = steps.find(s => s.id === 'enroll')!;
    enrollment.action = google
      ? c('In the 2-Step Verification settings, select Set up authenticator (some devices show Get started). Keep the displayed QR open.', '「2 段階認証プロセス」の設定で「認証システムを設定」（一部の端末では「使ってみる」）を選び、表示されたQRコードを残してください。')
      : c('In Manage how I sign in select Add a new way to sign in or verify → Use an app. If the app is installed, select Set up a different Authenticator app → Next to display the QR.', '「Manage how I sign in」で「Add a new way to sign in or verify」→「Use an app」を選びます。導入済みなら「Set up a different Authenticator app」→「Next」でQRを表示してください。');
    enrollment.expected = c('The official authenticator QR code is displayed.', '公式画面に認証アプリ登録用のQRコードが表示されること。');
    enrollment.sources = [google ? 'googleAuth' : 'microsoftAuth'];
    steps.push(step('auth-scan', c('Register the code in your authenticator', '認証アプリへ登録する'), place,
      c(google ? 'Open your authenticator and add this account using the displayed QR. Keep the account label distinct from other Google accounts.' : 'In Microsoft Authenticator select + → Personal account → Scan a QR Code. Scan the code displayed by Microsoft.', google ? '認証アプリのアカウント追加で、表示されたQRを読み取ってください。別のGoogle アカウントと区別できる名前を確認します。' : 'Microsoft Authenticatorで「＋」→「Personal account」→「Scan a QR Code」を選び、Microsoftが表示したQRを読み取ってください。'),
      c('The intended account appears in the authenticator.', '対象のアカウントが認証アプリに表示されること。'), [google ? 'googleAuth' : 'microsoftAuth']));
    steps.push(step('auth-confirm', c('Confirm the registration', '認証アプリの登録を確認する'), place, c('Enter the current authenticator code in the official setup screen if requested. Complete the verification there, then return to the two-step verification settings.', '確認を求められたら、現在の認証アプリのコードを公式の登録画面だけに入力してください。本人確認を終え、2段階認証の設定へ戻ります。'), c('The registration is accepted by the service.', '公式画面で認証アプリの登録が受け付けられたこと。'), [google ? 'googleAuth' : 'microsoftAuth']));
  }
  steps.push(step('verify', c('Confirm that protection is on', '有効になった状態を確認する'), place,
    c('Return to the two-step verification settings. Confirm that it is enabled for this account. If it was already on, leave it on.', '認証の設定へ戻り、今回のアカウントで有効になっていることを確認してください。すでに有効だった場合は、設定を変える必要はありません。'),
    c('Two-factor / 2-Step Verification is enabled.', '2ファクタ認証／2段階認証が有効と表示されていること。'), [s], { control: 'mfa', button: checked, technical: 'mfa' }));
  return { id: 'email-mfa', title: c('Protect your email', 'メールの認証を設定する'), steps };
}

export function recoveryRecipe(provider: Asset['provider'], platform: string): Recipe {
  if (isExtendedMail(provider)) return extendedRecoveryRecipe(provider);
  const apple = provider === 'apple', google = provider === 'google';
  const s: SourceId = apple ? 'appleRecovery' : google ? 'googleRecovery' : 'microsoftMfa';
  const place = c('Account · Security settings', 'アカウントのセキュリティ設定');
  return { id: 'recovery', title: c('Prepare for a lost phone', 'スマホを失ったときに備える'), steps: [
    step('open', c('Open the backup method settings', '予備の認証手段の設定を開く'), place,
      c(apple ? platform === 'web' ? 'In Sign-In and Security, open Account Security. Find Trusted Phone Number.' : 'In Sign-In & Security, open Two-Factor Authentication. Find Add Trusted Phone Number.' : google ? 'In 2-Step Verification, select Backup codes.' : 'In Manage how I sign in, review your security info. Keep three available methods, including an alternate email or authenticator.', apple ? platform === 'web' ? '「サインインとセキュリティ」→「アカウントセキュリティ」で、信頼できる電話番号の項目を開いてください。' : '「サインインとセキュリティ」→「2ファクタ認証」で、信頼できる電話番号を追加する項目を見つけてください。' : google ? '「2 段階認証プロセス」の「バックアップ コード」を開いてください。' : '「サインイン方法の管理」で本人確認用の情報を確認してください。別のメールや認証アプリなど、使える手段を3つ確保します。'),
      c('Backup methods are visible.', '予備の認証手段の項目が表示されること。'), [s]),
    step('save', c('Make a backup available without this phone', 'このスマホなしでも使える手段を用意する'), place,
      c(apple ? 'Add and verify a trusted phone number accessible without your main phone. Keep a working existing number. If an independent number is already registered, check it instead.' : google ? 'Select Get backup codes. Print them and keep them in a locked place away from your phone. If you have valid codes safely stored, check their location instead; generating new codes invalidates old ones.' : 'Confirm that your alternate verification methods are accessible without your main phone. Keep existing methods until you have tested the new one.', apple ? 'メインのスマホを失っても受信できる電話番号を追加し、確認を完了してください。既存の番号は残します。すでに独立した番号が登録されていれば、それを確認してください。' : google ? '「バックアップ コードを入手」を選び、印刷してスマホと別の施錠できる場所へ保管してください。有効なコードを保管済みなら場所を確認します。再生成すると古いコードは無効になります。' : 'メインのスマホなしでも使える別の本人確認手段を確認してください。新しい方法を試すまでは、既存の方法を残してください。'),
      c('A usable backup exists independently of your main phone.', 'メインのスマホなしで使える予備の手段が確保されていること。'), [s], { control: 'recovery', button: c('I secured a backup method', '予備の手段を確保しました'), technical: 'mfa' }),
  ] };
}

export function managerRecipe(product: Asset['provider'], platform: string, region: string): Recipe {
  const bw = product === 'bitwarden';
  const site = bw ? region === 'eu' ? 'https://vault.bitwarden.eu/' : 'https://vault.bitwarden.com/' : 'https://start.1password.com/';
  const place = c(bw ? 'Bitwarden · Web app' : '1Password · Web account', bw ? 'Bitwarden のWebアプリ' : '1Password のWebアカウント');
  const sources: SourceId[] = [bw ? 'bwCreate' : 'opStart'];
  const steps: GuideStep[] = [
    step('install', c('Install your password manager', 'パスワードマネージャーをインストールする'), c(PLATFORMS[platform as Platform] ?? 'Web', PLATFORMS[platform as Platform] ?? 'Web'), c('Open the official downloads page and install the app for the device selected above. If installed already, open it.', '公式ダウンロード画面から、選んだ端末向けのアプリをインストールしてください。導入済みなら開いてください。'), c('The official app is installed and opens.', '公式のアプリを起動できること。'), sources, { url: bw ? 'https://bitwarden.com/download/' : 'https://1password.com/downloads/' }),
    step('existing', c('Do you already have an account?', 'この製品のアカウントはありますか？'), place, c('Use your existing account if you have one. You do not need to create it again.', 'アカウントがある場合は、そのアカウントを使います。作り直す必要はありません。'), c('Choose the option that applies to you.', '当てはまるものを選んでください。'), sources, { choices: [{ label: c('I already have one', 'すでに持っている'), next: 'existing-signin' }, { label: c('Create a new account', '初めて作る'), next: 'master' }] }),
    step('existing-signin', c('Sign in to your existing account', '既存のアカウントでサインインする'), place, c('Sign in using your existing account. Keep its current password if it is unique and strong. Otherwise use the account’s password-change settings before continuing.', '既存のアカウントでサインインしてください。固有で十分に強いパスワードならそのまま使えます。使い回しや弱いものなら、製品のパスワード変更画面で変更してから進んでください。'), c('You can open your vault with a unique, strong password.', '固有の強いパスワードで保管庫を開けること。'), [bw ? 'bwMaster' : 'opMaster'], { url: site, choices: [{ label: checked, next: 'paper' }] }),
    { ...privatePassphraseStep('master', c(bw ? 'your Bitwarden master password' : 'your 1Password account password', bw ? 'Bitwardenのマスター' : '1Passwordのアカウントパスワード'), place, bw ? 'bwMaster' : 'opMaster'), title: c('Prepare a unique master passphrase', '専用のマスターパスフレーズを用意する'), sources: ['effDice', bw ? 'bwMaster' : 'opMaster', bw ? 'bwPhrase' : 'opLength'] },
    step('create', c('Create the account', 'アカウントを作る'), place,
      c(bw ? 'Select Sign Up, choose the correct server, verify your email, and set the passphrase you prepared. Enter it only on Bitwarden.' : 'Create your individual or family account on 1Password. Use your prepared account password and save your Emergency Kit when offered. Check the plan and price before accepting a subscription.', bw ? '「Sign Up」でサーバーを選び、メールを確認して、用意したフレーズを設定してください。入力先はBitwardenだけです。' : '1Passwordで個人用または家族用のアカウントを作り、用意したパスワードを設定してください。Emergency Kitも保存します。契約前に料金とプランを確認してください。'),
      c('You can sign in to the new vault.', '作成した保管庫へサインインできること。'), sources, { url: site }),
    step('paper', c('Keep emergency information off the device', '緊急用の情報を端末の外に保管する'), place,
      c(bw ? 'Write your master passphrase on paper and keep it in a locked location away from your device. Do not store your only copy inside Bitwarden.' : 'Select your name → Manage Account → Save Emergency Kit. Print it, write your account password in it, and store it in a locked place away from your device.', bw ? 'マスターパスフレーズを紙に控え、端末とは別の施錠できる場所へ保管してください。唯一の控えをBitwardenの中だけに置かないでください。' : '自分の名前→「Manage Account」→「Save Emergency Kit」で保存・印刷し、アカウントパスワードを書き込んで、端末とは別の施錠できる場所へ保管してください。'),
      c('You can retrieve the emergency information without unlocking this device or password manager.', '端末やマネージャーを開けなくても緊急用情報を取り出せること。'), [bw ? 'bwMaster' : 'opKit'], { button: c('I stored it safely', '安全な場所へ保管しました') }),
  ];
  if (!bw) steps.push(step('recovery', c('Save an account recovery code', 'アカウントの復旧コードを保管する'), place, c('In the app, open Manage Accounts → your account → Sign-in & Recovery → Set up recovery code. Store the code securely outside 1Password. Keep access to your account email; this code does not bypass two-factor authentication.', 'アプリの「Manage Accounts」→自分のアカウント→「Sign-in & Recovery」→「Set up recovery code」で作成し、1Passwordの外へ安全に保管してください。メールへのアクセスも必要です。このコードで2要素認証は省略できません。'), c('The recovery code and account email are accessible.', '復旧コードを取り出せて、登録メールも使えること。'), ['opRecovery'], { button: checked, control: 'recovery' }));
  steps.push(step('auth-ready', c('Keep your session and emergency information', '現在のログインと緊急用情報を残す'), place, c('Keep the current signed-in vault open and have your paper emergency information ready. The following guide will help prepare a separate authenticator.', '現在のログイン画面を残し、紙の緊急用情報を手元に用意してください。必要な別の認証アプリは、この後のガイドで準備します。'), c('Your current session and emergency information remain available.', '現在のログインと緊急用情報を使えること。'), [bw ? 'bwMfa' : 'opMfa'], { button: checked }));
  steps.push(step('auth-open', c('Open two-factor authentication settings', 'マネージャーの認証設定を開く'), place,
    c(bw ? 'Open Settings → Security → Two-step login. On Authenticator App select Manage.' : 'Select your name → Manage Account → More Actions → Manage Two-Factor Authentication.', bw ? '「Settings」→「Security」→「Two-step login」を開き、「Authenticator App」の「Manage」を選んでください。' : '自分の名前→「Manage Account」→「More Actions」→「Manage Two-Factor Authentication」を開いてください。'), c('The authenticator settings or enabled state are displayed.', '認証アプリの設定、または有効な状態が表示されること。'), [bw ? 'bwMfa' : 'opMfa'], { url: site, choices: [{ label: c('Already enabled', 'すでに有効になっている'), next: bw ? 'recovery' : 'auth-test' }, { label: c('Set it up', 'これから設定する'), next: bw ? 'auth-scan' : 'auth-secret' }] }));
  if (!bw) steps.push(step('auth-secret', c('Keep a backup of the authenticator secret', '認証アプリの予備情報を先に保管する'), place, c('Select Set Up App. Write the 16-character secret beside the QR code on paper and store it with your Emergency Kit.', '「Set Up App」を選び、QRコード横の16文字の秘密情報を紙に控えて、Emergency Kitと保管してください。'), c('The backup secret is safely stored before activation.', '有効化する前に、予備の秘密情報を安全に保管したこと。'), ['opMfa'], { button: c('I stored it safely', '安全な場所へ保管しました') }));
  steps.push(step('auth-scan', c('Register the authenticator', '認証アプリへ登録する'), place,
    c(bw ? 'Scan the displayed QR code with your standalone authenticator. Enter its code in Bitwarden and select Enable.' : 'Select Set Up App. First write the 16-character secret beside the QR code on paper and store it with your Emergency Kit. Then scan the QR code with your separate authenticator; select Next, enter the code and select Confirm.', bw ? '独立した認証アプリでQRコードを読み取り、そのコードをBitwardenの画面に入力して「Enable」を選んでください。' : '独立した認証アプリでQRコードを読み取り、「Next」で現在のコードを入力して「Confirm」を選んでください。'), c('The authenticator is enabled. Keep the existing session open.', '認証アプリが有効になったこと。現在のログインは残します。'), [bw ? 'bwMfa' : 'opMfa']));
  if (bw) steps.push(step('recovery', c('Save the two-step login recovery code', '2段階ログインの復旧コードを保管する'), place, c('In Settings → Security → Two-step login, select View recovery code. Confirm your master password there. Print the code and store it with your paper emergency information before testing a new login.', '「Settings」→「Security」→「Two-step login」で「View recovery code」を選び、その画面でマスターパスワードを確認してください。表示されたコードを印刷し、新しいログインを試す前に紙の緊急用情報と保管してください。'), c('A recovery code is safely stored outside Bitwarden.', '復旧コードをBitwardenの外へ安全に保管したこと。'), ['bwRecovery'], { button: c('I stored the recovery code', '復旧コードを保管しました'), control: 'recovery' }));
  steps.push(step('auth-test', c('Test the new sign-in method', '新しい認証方法でログインを試す'), place, c('Keep your current session open. In a separate private browser window, sign in using your password and the new authenticator. Do not remove old methods until this works.', '現在の画面を残し、別のプライベートウインドウで、パスワードと新しい認証アプリを使ってサインインを試してください。成功するまで既存の方法は削除しません。'), c('You can sign in and open the vault with the new method.', '新しい方法でサインインし、保管庫を開けること。'), [bw ? 'bwMfa' : 'opMfa'], { control: 'mfa', button: c('Sign-in worked', 'ログインできました'), technical: 'mfa' }));
  return { id: 'manager', title: c('Set up your password manager', 'パスワードを管理できる状態にする'), steps };
}

export const TECHNICAL = {
  mfa: c('A second factor makes a stolen password alone less useful. Codes can still be phished, and a compromised signed-in device can bypass this protection. Passkeys bind sign-in to the real site. Independent recovery prevents losing one phone from locking you out; it must be protected too.', 'パスワードが漏れても、追加の認証手段がなければログインしにくくなります。ただし、コードを偽サイトへ入力する攻撃や、ログイン済み端末の侵害には限界があります。パスキーは接続先のサイトと認証を結び付けます。独立した復旧手段はスマホの紛失に備えますが、その手段自体の保護も必要です。'),
  password: c('Random, unique passwords prevent one leaked password from unlocking other accounts. More random words increase the search space; choosing familiar lyrics does not. The manager encrypts the vault, but an unlocked compromised device can expose it. Paper recovery must be protected from theft.', 'ランダムで固有のパスワードは、他のサイトから漏れたパスワードの使い回し攻撃を防ぎます。ランダムな単語数を増やすと探索候補が増えますが、歌詞や有名な文には同じ効果がありません。保管庫は暗号化されますが、開いた端末が侵害されると読み取られる可能性があります。紙の控えは盗難から守る必要があります。'),
  backup: c('A separate backup helps recover from device loss or failure. A synced deletion can propagate, so synchronization alone is not a historical backup. Account access, storage capacity and successful restoration matter. Never erase your device just to test this guide.', '別の場所のコピーは、端末の紛失や故障からの復元に役立ちます。同期は削除も伝わるため、過去へ戻せるバックアップと同じではありません。保存先へのアクセス、空き容量、復元できることも重要です。この確認のために端末を初期化しないでください。'),
  updates: c('Security updates fix known vulnerabilities that attackers may exploit without knowing your password. They do not stop every phishing attempt or unknown vulnerability. Unsupported systems need a supported replacement or an administrator’s plan.', 'セキュリティ更新は、パスワードを知らなくても悪用できる既知の欠陥を修正します。すべての偽サイトや未知の欠陥を防ぐものではありません。更新対象外の端末では、対応する端末への移行や管理者による計画が必要です。'),
};

export function passwordRecipe(product: Asset['provider'], email: Asset, platform: string): Recipe {
  const bw = product === 'bitwarden', apple = email.provider === 'apple', google = email.provider === 'google';
  const extra = isExtendedMail(email.provider) ? extendedConfig[email.provider] : undefined;
  const extraPassword: Partial<Record<ExtendedMail, { source: SourceId; action: Copy }>> = {
    startmail: { source: 'startmailPassword', action: c('Open Settings → Account settings → Change password. Keep your old PGP passphrase stored: changing the login password does not change it.', '「Settings」→「Account settings」→「Change password」を開いてください。ログインの変更でPGPパスフレーズは変わらないため、古いPGPパスフレーズも保管してください。') },
    fastmail: { source: 'fastmailPassword', action: c('Open Settings → Privacy & Security → Password & Two-step verification → Change password.', '「Settings」→「Privacy & Security」→「Password & Two-step verification」→「Change password」を開いてください。') },
    proton: { source: 'protonPassword', action: c('Open Settings → All settings → Account and password. Select the pencil by Password, enter your current password and select Authenticate. Use password change, not a forgotten-password reset.', '「Settings」→「All settings」→「Account and password」のパスワード横の鉛筆を選び、現在のパスワードで「Authenticate」を進めてください。忘れたパスワードのリセットは使いません。') },
    tuta: { source: 'tutaMfa', action: c('Open Settings → Login and select the pencil beside Password.', '「Settings」→「Login」の「Password」横の鉛筆を選んでください。') },
    zoho: { source: 'zohoPassword', action: c('Open Security → Password → Change Password.', '「Security」→「Password」→「Change Password」を開いてください。') },
    yahoo: { source: 'yahooPassword', action: c('In Account Security → Ways of signing in select Password. If only Account Key is offered, stop and use the help branch.', '「Account Security」→「Ways of signing in」の「Password」を選んでください。Account Keyだけの場合は止めて「うまくいかない」を使ってください。') },
  };
  const custom = isExtendedMail(email.provider) ? extraPassword[email.provider] : undefined;
  const s: SourceId = custom?.source ?? (apple ? 'applePassword' : google ? 'googlePassword' : 'microsoftPassword');
  const opSource: SourceId = platform === 'ios' ? 'opUseIos' : platform === 'android' ? 'opUseAndroid' : platform === 'macos' ? 'opUseMac' : platform === 'windows' ? 'opUseWindows' : 'opUse';
  const place = c('Your password manager / official account settings', 'マネージャーと公式アカウント設定');
  return { id: 'password', title: c('Save and use your email password', 'メールのパスワードを保存して使う'), steps: [
    step('save-current', c('Save the current login first', '現在のログイン情報を先に保存する'), place,
      c(bw ? 'In Bitwarden select New → Login. Enter the account’s username, current password and official sign-in URL, then Save.' : 'In 1Password select New Item (+) → Login. Enter the account’s username, current password and official website, then Save.', bw ? 'Bitwardenで「New」→「Login」を選び、今回のアカウントのユーザー名・現在のパスワード・公式ログインURLを入力して「Save」を選んでください。' : '1Passwordで新規項目（＋）→「Login」を選び、今回のユーザー名・現在のパスワード・公式サイトを入力して保存してください。'),
      c('The current login is saved inside the manager. Enter no credentials in this app.', '現在のログイン情報がマネージャー内に保存されたこと。このアプリには入力しません。'), [bw ? 'bwUse' : opSource]),
    step('change-open', c('Open the account’s password settings', 'メール側のパスワード設定を開く'), place,
      custom?.action ?? c(apple ? platform === 'ios' ? 'In Settings select your name → Sign-In & Security → Change Password.' : platform === 'macos' ? 'In System Settings select your name → Sign-In & Security → Change Password.' : 'On account.apple.com, select Sign-In and Security → Password.' : google ? 'Open Google Account → Security & sign-in → How you sign in to Google → Password.' : 'Open Microsoft account → Security → Change password.', apple ? platform === 'ios' ? '「設定」→自分の名前→「サインインとセキュリティ」→「パスワードの変更」を開いてください。' : platform === 'macos' ? '「システム設定」→自分の名前→「サインインとセキュリティ」→「パスワードの変更」を開いてください。' : 'account.apple.comの「サインインとセキュリティ」→「パスワード」を開いてください。' : google ? 'Google アカウントの「セキュリティとログイン」→「Google にログインする方法」→「パスワード」を開いてください。' : 'Microsoft アカウントの「セキュリティ」→「パスワードの変更」を開いてください。'),
      c('The official password-change form is open. Keep your existing session and recovery methods.', '公式のパスワード変更画面が開いていること。既存のログインと復旧手段を残します。'), [s], { url: extra?.url ?? (apple ? 'https://account.apple.com/' : google ? 'https://myaccount.google.com/' : 'https://account.microsoft.com/security') }),
    step('generate', c('Generate a new, unique password', '新しい固有のパスワードを生成する'), place,
      c(bw ? 'Edit the saved login in Bitwarden and use its password generator. Choose a random password of at least 20 characters if the account allows it. Copy it and keep the edited item open.' : 'Edit the login in 1Password and choose Create a New Password. Generate a random password of at least 20 characters if allowed. Keep the item open.', bw ? 'Bitwardenの保存項目を編集し、生成機能でランダムなパスワードを作成してください。このガイドでは、サービスが許す場合は20文字以上にします。コピーし、編集画面を残してください。' : '1Passwordの保存項目を編集し、「Create a New Password」でランダムなパスワードを生成してください。このガイドでは、サービスが許す場合は20文字以上にします。編集画面を残してください。'),
      c('A fresh password is ready in your manager. Follow any account-specific character limits.', '新しいパスワードがマネージャー内にあり、サービスの文字数・文字種の条件を満たすこと。'), [bw ? 'bwGenerator' : 'opGenerate'], { technical: 'password' }),
    step('apply', c('Apply it on the official website', '公式の設定画面で変更を確定する'), place, c('Paste the generated password into the account’s new-password fields and confirm the change there. Keep the manager’s edited item open until the change succeeds.', '生成したパスワードを公式設定の新しいパスワード欄へ貼り付け、変更を確定してください。成功するまでマネージャーの編集画面は残します。'), c('The service confirms that the password was changed.', 'サービス側でパスワードの変更が受け付けられたこと。'), [s]),
    step('save-new', c('Save the updated login', '変更後のログイン情報を保存する'), place, c('Save the new password in the manager’s login item. If the service rejected the change, keep the old login and return to the previous step.', 'マネージャーのログイン項目へ新しいパスワードを保存してください。変更が拒否された場合は古い情報を残して前の操作へ戻ってください。'), c('The saved login matches the password accepted by the service.', 'サービスが受け付けたパスワードと、保存内容が一致すること。'), [bw ? 'bwUse' : 'opGenerate']),
    step('test', c('Use the saved login', '保存した情報でログインする'), place, c('Keep the current signed-in session. In another private window, open the official sign-in page and use the saved login from your manager. Complete two-step verification if asked.', '現在のログイン画面を残し、別のプライベートウインドウで公式ログイン画面を開いて、マネージャーの保存情報を使ってください。必要な場合は2段階認証も行います。'), c('You can sign in with the saved password.', '保存したパスワードでログインできること。'), [bw ? 'bwUse' : 'opGenerate'], { control: 'uniquePassword', button: c('I signed in successfully', 'ログインできました') }),
  ] };
}

export function deviceRecipe(platform: string): Recipe {
  const ios = platform === 'ios', mac = platform === 'macos', android = platform === 'android';
  const b: SourceId = ios ? 'iosBackup' : mac ? 'macBackup' : android ? 'androidBackup' : 'windowsBackup';
  const u: SourceId = ios ? 'iosUpdate' : mac ? 'macUpdate' : android ? 'androidUpdate' : 'windowsUpdate';
  const place = c(`${PLATFORMS[platform as Platform] ?? platform} · Settings`, `${PLATFORMS[platform as Platform] ?? platform} の設定`);
  const steps: GuideStep[] = [];
  if (mac || platform === 'windows') steps.push(step('lock', c('Check your screen lock', '画面ロックを確認する'), place,
    c(mac ? 'Open System Settings → Lock Screen. Set Require password after screen saver begins or display is turned off to Immediately. Keep your login password.' : 'Open Settings → Accounts → Sign-in options. Confirm that a password, PIN or Windows Hello is set. Lock with Windows + L and check that signing in is required.', mac ? '「システム設定」→「ロック画面」で「スクリーンセーバの開始後またはディスプレイがオフになったあとにパスワードを要求」を「すぐに」にしてください。ログインパスワードは残します。' : '「設定」→「アカウント」→「サインイン オプション」で、パスワード・PIN・Windows Helloのいずれかが設定済みか確認してください。Windows + Lでロックし、サインインが必要なことを確かめます。'),
    c('Unlocking requires your password, PIN or biometrics.', '解除にパスワード・PIN・生体認証が必要なこと。'), [mac ? 'macLock' : 'windowsLock'], { control: 'screenLock', button: checked }));
  if (ios || android) steps.push(step('lock', c('Check your screen lock', '画面ロックを確認する'), place,
    c(ios ? 'Open Settings → Face ID & Passcode, Touch ID & Passcode, or Passcode. If no code is set, select Turn Passcode On. Keep an existing strong code.' : 'Open Settings → Security (or Security & privacy) → Screen lock. Use a strong password or a PIN of at least 6 digits. Do not use None or Swipe.', ios ? '「設定」の「Face IDとパスコード」「Touch IDとパスコード」または「パスコード」を開いてください。未設定なら「パスコードをオンにする」で設定します。強いものを設定済みなら変更不要です。' : '「設定」→「セキュリティ」（または「セキュリティとプライバシー」）→「画面ロック」を開き、強いパスワードか6桁以上のPINを使ってください。「なし」「スワイプ」は使いません。'),
    c('Lock and unlock your device to confirm it requires your code or biometrics.', '画面を一度ロックし、解除にコードや生体認証が必要なことを確認できること。'), [ios ? 'iosLock' : 'androidLock'], { control: 'screenLock', button: checked }));
  steps.push(step('backup-open', c('Open backup settings', 'バックアップ設定を開く'), place,
    c(ios ? 'Connect to Wi-Fi. Open Settings → your name → iCloud → iCloud Backup.' : mac ? 'Connect a backup disk. Open Apple menu → System Settings → General → Time Machine.' : android ? 'Open Settings → Google (Google services) → All services → Backup under Backup and restore.' : 'On Windows 11, search Start for Windows Backup and open it. This flow uses a personal Microsoft account and OneDrive.', ios ? 'Wi-Fiに接続し、「設定」→自分の名前→「iCloud」→「iCloudバックアップ」を開いてください。' : mac ? 'バックアップ用ディスクを接続し、Appleメニュー→「システム設定」→「一般」→「Time Machine」を開いてください。' : android ? '「設定」→「Google」（Google サービス）→「すべてのサービス」→「バックアップと復元」の「バックアップ」を開いてください。' : 'Windows 11のスタートで「Windows バックアップ」を検索して開いてください。この手順では個人用Microsoft アカウントとOneDriveを使います。'),
    c('The backup settings for this device are open.', 'この端末のバックアップ画面が開いていること。'), [b]));
  steps.push(step('backup-run', c('Make a current backup', '新しいバックアップを作る'), place,
    c(ios ? 'Select Back Up Now and stay connected until it finishes. If storage is full, use the help branch; a failed backup is not complete.' : mac ? 'Select Add Backup Disk, choose your disk, then Set Up Disk. Stop if asked to erase a disk containing files you need. Enable encryption and securely keep its password outside this app. Wait for the backup.' : android ? 'Turn on backup for the data you need and select Back up now. Keep network and power available while it completes.' : 'Expand Folders, turn on the folders you need to protect, and select Back up. Check OneDrive space; a storage error means the backup is incomplete.', ios ? '「今すぐバックアップを作成」を選び、完了までWi-Fiに接続してください。容量不足の場合は「うまくいかない」へ進みます。失敗した状態は完了にしません。' : mac ? '「バックアップディスクを追加」で対象ディスクを選び、設定してください。必要なファイルがあるディスクの消去を求められたら止めてください。暗号化を有効にし、そのパスワードはこのアプリの外へ安全に控え、バックアップを待ちます。' : android ? '必要なデータのバックアップを有効にし、「今すぐバックアップ」を選んでください。完了まで通信と電源を確保してください。' : '「フォルダー」を展開して必要なフォルダーをオンにし、「バックアップ」を選んでください。OneDriveの容量を確認し、エラーが出たら完了にしません。'),
    c('The backup finishes without an error.', 'エラーなくバックアップ処理が終了すること。'), [b]));
  steps.push(step('backup-check', c('Check the backup result', 'バックアップの結果を確認する'), place,
    c(ios ? 'Check the last successful backup date beneath Back Up Now.' : mac ? 'Check the latest backup date in the Time Machine menu.' : android ? 'Check the backup details: the selected data is backed up and the latest backup is shown. Some data may take up to 24 hours.' : 'Check that Windows Backup shows the selected folders as backed up.', ios ? '「今すぐバックアップを作成」の下にある、前回正常に完了した日時を確認してください。' : mac ? 'Time Machineメニューで最新のバックアップ日時を確認してください。' : android ? 'バックアップの詳細を開き、必要なデータが保存済みで、最新のバックアップが表示されていることを確認してください。反映まで最大24時間かかる場合があります。' : 'Windows バックアップで、選んだフォルダーがバックアップ済みと表示されることを確認してください。'),
    c('A recent successful backup is recorded. Do not reset the device to test this.', '最近の正常なバックアップを確認できること。確認のための端末初期化は不要です。'), [b], { control: 'backup', button: checked, technical: 'backup' }));
  steps.push(step('update-open', c('Open software updates', 'ソフトウェア更新を開く'), place,
    c(ios ? 'In Settings select General → Software Update.' : mac ? 'In System Settings select General → Software Update.' : android ? 'In Settings select System → Software updates (or Software update). Manufacturer menus may differ.' : 'On Windows 11, open Start → Settings → Windows Update → Check for updates.', ios ? '「設定」→「一般」→「ソフトウェアアップデート」を開いてください。' : mac ? '「システム設定」→「一般」→「ソフトウェアアップデート」を開いてください。' : android ? '「設定」→「システム」→「ソフトウェア アップデート」を開いてください。メーカーにより項目名が異なります。' : 'Windows 11で「スタート」→「設定」→「Windows Update」→「更新プログラムのチェック」を選んでください。'),
    c('The available update or current status is displayed.', '提供されている更新、または現在の状態が表示されること。'), [u]));
  steps.push(step('update-install', c('Install available security updates', '提供されている更新を適用する'), place, c('With your backup secured, install available updates using the displayed update button. Connect power and network, and allow required restarts. If the device is unsupported or managed, use the help branch.', 'バックアップを確保したうえで、表示されている更新ボタンから適用してください。電源と通信を確保し、必要な再起動を行います。対応していない端末や管理された端末の場合は「うまくいかない」を使ってください。'), c('Updates and any required restart finish; the screen reports no available updates.', '必要な更新と再起動が終わり、利用可能な更新がない状態になること。'), [u], { control: 'updates', button: c('I updated and checked', '更新して確認しました'), technical: 'updates' }));
  return { id: 'device', title: c('Protect your device', '端末の紛失や故障に備える'), steps };
}

type ExtendedMail = 'proton' | 'fastmail' | 'tuta' | 'zoho' | 'yahoo' | 'startmail' | 'mailcom' | 'gmx';
export const isExtendedMail = (provider: Asset['provider']): provider is ExtendedMail => ['proton', 'fastmail', 'tuta', 'zoho', 'yahoo', 'startmail', 'mailcom', 'gmx'].includes(provider ?? '');
const extendedConfig = {
  startmail: { source: 'startmailMfa' as const, url: 'https://mail.startmail.com/login', navigation: c('Open Settings → Account settings → Login settings → Two-factor authentication.', '「Settings」→「Account settings」→「Login settings」→「Two-factor authentication」を開いてください。'), start: c('Select Enable. Confirm your password on StartMail and select Enable again.', '「Enable」を選び、StartMailの画面でパスワードを確認して、もう一度「Enable」を選んでください。'), confirm: c('Enter the changing 6-digit code on the StartMail activation screen.', '認証アプリに表示された現在の6桁コードをStartMailの有効化画面へ入力してください。') },
  mailcom: { source: 'mailcomMfa' as const, url: 'https://www.mail.com/', navigation: c('Select Account → Security Options. Find Two-factor authentication.', '「Account」→「Security Options」を開き、「Two-factor authentication」を見つけてください。'), start: c('Select Activate two-factor authentication, then Start setup now. Confirm your password and select Start now.', '「Activate two-factor authentication」→「Start setup now」を選び、公式画面でパスワードを確認して「Start now」を選んでください。'), confirm: c('Enter the authenticator’s 6-digit code and select Continue.', '認証アプリの6桁コードを入力して「Continue」を選んでください。') },
  gmx: { source: 'gmxMfa' as const, url: 'https://www.gmx.com/', navigation: c('Select Account → Security Options. Find Two-factor authentication.', '「Account」→「Security Options」を開き、「Two-factor authentication」を見つけてください。'), start: c('Select Activate two-factor authentication, then Start setup now. Confirm your password and select Start now.', '「Activate two-factor authentication」→「Start setup now」を選び、公式画面でパスワードを確認して「Start now」を選んでください。'), confirm: c('Enter the authenticator’s 6-digit code and select Continue.', '認証アプリの6桁コードを入力して「Continue」を選んでください。') },
  proton: { source: 'protonMfa' as const, url: 'https://account.proton.me/', navigation: c('Open Settings → All settings → Account and password.', '「Settings」→「All settings」→「Account and password」を開いてください。'), start: c('Under Two-factor authentication, turn on Authenticator app. Confirm your password on Proton.', '「Two-factor authentication」の「Authenticator app」をオンにし、Protonの画面でパスワードを確認してください。'), confirm: c('Select Next. Enter the password and authenticator code requested by Proton, then Submit.', '「Next」を選び、Protonが求めるパスワードと認証アプリのコードを入力して「Submit」を選んでください。') },
  fastmail: { source: 'fastmailMfa' as const, url: 'https://app.fastmail.com/', navigation: c('Open Settings → Privacy & Security.', '「Settings」→「Privacy & Security」を開いてください。'), start: c('In Password & Two-step verification select Manage two-step verification → Add verification device. Choose Authenticator app (TOTP).', '「Password & Two-step verification」の「Manage two-step verification」→「Add verification device」で「Authenticator app（TOTP）」を選んでください。'), confirm: c('Enter the app’s 6-digit code on Fastmail and name the verification device.', 'Fastmailの画面へアプリの6桁コードを入力し、認証端末の呼び名を付けてください。') },
  tuta: { source: 'tutaMfa' as const, url: 'https://app.tuta.com/', navigation: c('Open Settings → Login. Find Second factor authentication.', '「Settings」→「Login」を開き、「Second factor authentication」を見つけてください。'), start: c('Select the plus next to Second factor authentication and choose TOTP.', '「Second factor authentication」の横の＋を選び、TOTPを選んでください。'), confirm: c('Complete the TOTP enrollment in Tuta using the current authenticator code if requested.', 'Tutaの画面でTOTPの登録を完了してください。確認を求められたら、認証アプリの現在のコードをその画面へ入力します。') },
  zoho: { source: 'zohoMfa' as const, url: 'https://accounts.zoho.com/', navigation: c('Select Multi-Factor Authentication. Find OTP Authenticator.', '「Multi-Factor Authentication」を選び、「OTP Authenticator」を見つけてください。'), start: c('Under OTP Authenticator select Set up Now.', '「OTP Authenticator」の「Set up Now」を選んでください。'), confirm: c('Select Next, enter the app’s OTP in Zoho Accounts and select Verify.', '「Next」を選び、Zoho Accountsの画面へ認証アプリのOTPを入力して「Verify」を選んでください。') },
  yahoo: { source: 'yahooMfa' as const, url: 'https://login.yahoo.com/account/security', navigation: c('In Account Security, find Ways of signing in → 2-step verification. This is Yahoo.com, not Yahoo! JAPAN.', '「Account Security」の「Ways of signing in」→「2-step verification」を開いてください。Yahoo.com向けです。Yahoo! JAPANとは異なります。'), start: c('Choose Authenticator app, then Continue. If Account Key is active, use the help branch; do not disable an existing method here.', '「Authenticator app」→「Continue」を選んでください。Account Keyが有効な場合は「うまくいかない」へ進み、今の認証方法を無効にしないでください。'), confirm: c('Select Continue, enter the code from your authenticator, then select Done.', '「Continue」を選び、認証アプリのコードを入力して「Done」を選んでください。') },
};
function extendedEmailRecipe(provider: ExtendedMail): Recipe {
  const cfg = extendedConfig[provider], s = cfg.source, place = c(`${PROVIDERS[provider]} · Web account settings`, `${PROVIDERS[provider]} のWebアカウント設定`);
  const steps: GuideStep[] = [
    step('open', c('Open the official account settings', '公式のアカウント設定を開く'), place, c('Sign in to the account you selected. Keep this session open.', '今回選んだアカウントでサインインし、このログイン画面を残してください。'), c('You are signed in to the intended account.', '今回のアカウントへログインしていること。'), [s], { url: cfg.url }),
    step('security', c('Open authentication settings', '認証の設定を開く'), place, cfg.navigation, c('The account’s authentication settings are shown.', 'このアカウントの認証設定が表示されること。'), [s]),
    step('ready', c('Prepare recovery before changing authentication', '認証の変更前に復旧を準備する'), place,
      c(provider === 'fastmail' ? 'In Account recovery select Add recovery options → Add recovery phone. Verify a reachable phone using Send verification code → Verify. Keep existing recovery methods.' : provider === 'tuta' ? 'In Login, select the pencil beside Recovery code. Confirm your password there and securely print the recovery code. Recovery needs two of password, second factor and recovery code.' : provider === 'yahoo' ? 'Confirm access to at least two recovery methods. They are required for the authenticator option. Keep Account Key and existing methods if currently in use.' : 'Keep your current session and existing recovery methods. Confirm that a recovery method is accessible, The app-specific guide will help you prepare an authenticator when needed.', provider === 'fastmail' ? '「Account recovery」の「Add recovery options」→「Add recovery phone」で受信できる電話番号を用意し、「Send verification code」→「Verify」で確認してください。既存の手段は残します。' : provider === 'tuta' ? '「Login」の「Recovery code」横の鉛筆を選び、公式画面でパスワードを確認して、復旧コードを安全に印刷・保管してください。復旧には、パスワード・第2要素・復旧コードのうち2つが必要です。' : provider === 'yahoo' ? '少なくとも2つの復旧手段が使えることを確認してください。認証アプリの選択に必要です。使用中のAccount Keyや既存手段は残します。' : '現在のログインと既存の復旧手段を残し、復旧手段が使えることを確認してください。必要な認証アプリは、この後の製品別ガイドで準備します。'),
      c('Recovery is accessible and the current session remains open.', '復旧手段を使えて、現在のログインも残っていること。'), [s], { button: c('Recovery is ready', '復旧の準備ができました') }),
    step('state', c('Is two-factor authentication already enabled?', '2要素認証はすでに有効ですか？'), place, c('Check the enabled authenticator or second-factor list. If enabled, do not re-enroll it.', '認証アプリや第2要素の登録状態を確認してください。有効なら再登録は不要です。'), c('An enabled method or the setup option is visible.', '有効な方法、または設定する項目が表示されること。'), [s], { choices: [{ label: c('Already enabled', 'すでに有効になっている'), next: 'verify' }, { label: c('Not enabled yet', 'まだ有効になっていない'), next: 'enable' }] }),
    step('enable', c('Start authenticator registration', '認証アプリの登録を始める'), place, cfg.start, c('The official enrollment screen is open.', '公式の登録画面が開いていること。'), [s]),
    step('scan', c('Add the account to your authenticator', '認証アプリへアカウントを追加する'), place, c('In your authenticator, add an account using the QR code shown by the service. If you cannot scan it on the same device, use the help branch.', '認証アプリの追加操作で、サービスが表示したQRコードを読み取ってください。同じ端末で読み取れない場合は「うまくいかない」へ進んでください。'), c('The authenticator generates a changing code for this account.', 'このアカウントのコードが認証アプリに表示されること。'), [s]),
    step('confirm', c('Confirm the authenticator on the official screen', '公式画面で認証アプリを確認する'), place, cfg.confirm, c('The service accepts the registration.', 'サービスが登録を受け付けたこと。'), [s]),
  ];
  if (provider === 'mailcom' || provider === 'gmx') {
    const scanIndex = steps.findIndex(s => s.id === 'scan');
    steps.splice(scanIndex, 0,
      step('phone-request', c('Verify a reachable recovery phone', '受信できる復旧用の電話番号を確認する'), place, c('Check the displayed mobile number, or enter an available number on the official screen. Select Request SMS.', '公式画面の携帯電話番号が今も使えるか確認し、未登録なら受信できる番号を入力して「Request SMS」を選んでください。'), c('An SMS is sent to a phone you control.', '自分が管理する電話でSMSを受け取れること。'), [s]),
      step('phone-confirm', c('Confirm the SMS on the official screen', '公式画面でSMSを確認する'), place, c('Enter the SMS confirmation code on the official screen, then Continue.', 'SMSの確認コードを公式画面へ入力し、「Continue」を選んでください。'), c('Your phone number is verified.', '電話番号の確認が完了したこと。'), [s]));
    steps.push(step('save-key', c('Print the emergency secret key', '緊急用の秘密情報を印刷・保管する'), place, c('Select Save your secret key. Print the PDF and keep it securely away from your phone. Do not upload it here.', '「Save your secret key」でPDFを保存・印刷し、スマホと別の安全な場所へ保管してください。このアプリにはアップロードしません。'), c('The emergency PDF is independently accessible.', 'スマホがなくても緊急用PDFを取り出せること。'), [s], { button: c('I stored it safely', '安全な場所へ保管しました') }));
    steps.push(step('activate', c('Activate the completed setup', '設定を有効にする'), place, c('Check your details on the official screen, select Next, then Activate now.', '公式画面で登録内容を確認し、「Next」→「Activate now」を選んでください。'), c('The service confirms activation.', 'サービス側で有効化が完了したこと。'), [s]));
  }
  if (provider === 'proton' || provider === 'startmail') steps.push(step('save-codes', c('Save the recovery codes before leaving', '画面を閉じる前に復旧コードを保管する'), place, c('Print the one-use recovery codes now. Store them in a locked location away from your phone.', '今表示された一回用の復旧コードを印刷し、スマホとは別の施錠できる場所へ保管してください。'), c('The codes are accessible without the authenticator device.', '認証端末を使えなくてもコードを取り出せること。'), [s], { button: c('I stored them safely', '安全な場所へ保管しました') }));
  steps.push(step('verify', c('Confirm the enabled state', '有効な状態を確認する'), place, c('Check the enabled second-factor setting or registered method. Keep it enabled.', '第2要素が有効、または登録された状態を確認してください。有効なままにします。'), c('This account has an enabled second factor.', '今回のアカウントの第2要素が有効であること。'), [s], { control: 'mfa', button: c('I checked this', '確認しました'), technical: 'mfa' }));
  return { id: 'email-mfa', title: c(`Protect ${PROVIDERS[provider]}`, `${PROVIDERS[provider]}の認証を設定する`), steps };
}
function extendedRecoveryRecipe(provider: ExtendedMail): Recipe {
  const cfg = extendedConfig[provider], s = provider === 'zoho' ? 'zohoRecovery' : cfg.source;
  const place = c(`${PROVIDERS[provider]} · Recovery settings`, `${PROVIDERS[provider]} の復旧設定`);
  return { id: 'recovery', title: c('Keep an independent way back in', '独立した復旧の備えを作る'), steps: [
    step('save', c('Keep recovery information outside your phone', 'スマホの外に復旧情報を保管する'), place,
      c(provider === 'mailcom' || provider === 'gmx' ? 'Check that the emergency secret-key PDF is stored securely outside your phone, and your verified recovery phone remains available.' : provider === 'startmail' ? 'Check that the 2FA backup code shown during enrollment is safely stored outside your phone. This differs from your account password and PGP passphrase.' : provider === 'proton' ? 'Check that your saved one-use 2FA recovery codes are safely stored outside your authenticator device. If none were saved, keep your session open and use the help branch; do not disable 2FA to obtain codes.' : provider === 'fastmail' ? 'Open Settings → Privacy & Security → Account Recovery. View your recovery code and print it securely.' : provider === 'tuta' ? 'Open Settings → Login → the pencil beside Recovery code. Confirm your password there, print the code, and keep it safely apart from your device.' : provider === 'zoho' ? 'Open Multi-Factor Authentication → MFA Recovery Options → Generate new codes. Save or print them now; they will not be shown again and old codes become invalid.' : 'Confirm that both recovery methods remain accessible without your main phone. If Yahoo issued an emergency code during setup, print and store it securely.', provider === 'mailcom' || provider === 'gmx' ? '緊急用の秘密情報PDFがスマホの外へ安全に保管され、確認済みの復旧用電話も使えることを確認してください。' : provider === 'startmail' ? '登録時の2FAバックアップコードがスマホの外へ安全に保管されていることを確認してください。アカウントのパスワードやPGPパスフレーズとは別です。' : provider === 'proton' ? '保管した一回用の2FA復旧コードが、認証端末の外に安全にあることを確認してください。保管していなければログインを残して「うまくいかない」へ進みます。コードのために2FAを無効化しません。' : provider === 'fastmail' ? '「Settings」→「Privacy & Security」→「Account Recovery」で復旧コードを表示し、安全に印刷・保管してください。' : provider === 'tuta' ? '「Settings」→「Login」→「Recovery code」横の鉛筆を開き、公式画面でパスワードを確認して、コードを印刷し端末と別の場所へ保管してください。' : provider === 'zoho' ? '「Multi-Factor Authentication」→「MFA Recovery Options」→「Generate new codes」で発行し、今すぐ保存・印刷してください。再表示はできず、以前のコードは無効になります。' : '2つの復旧手段が、メインのスマホを失っても使えることを確認してください。設定時に緊急用コードが発行された場合は、安全に印刷・保管してください。'),
      c('Recovery information is available independently of your main device.', 'メインの端末なしで復旧情報を使えること。'), [s], { button: c('I secured a backup method', '予備の手段を確保しました') }),
    step('test', c('Test a new sign-in while keeping the current one', '現在のログインを残して動作を確認する'), place, c('In another private window, sign in using the new authenticator. Keep the current session and old methods. Do not use up a recovery code just to test this guide.', '別のプライベートウインドウで、新しい認証アプリを使ってログインしてください。現在のログインと既存手段は残し、この確認のためだけに復旧コードを消費しないでください。'), c('Sign-in succeeds with the authenticator.', '認証アプリを使ってログインできること。'), [cfg.source], { control: 'recovery', button: c('Sign-in worked', 'ログインできました') }),
  ] };
}
