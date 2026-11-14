import { c, type Copy, type GuideStep, type Recipe } from './guideCatalog';
const place = c('Nord Account · Web settings', 'Nord AccountのWeb設定');
const make = (id: string, title: Copy, action: Copy, expected: Copy, extra: Partial<GuideStep> = {}): GuideStep => ({ id, title, place, action, expected, sources: ['nordMfa', 'nordMfaCodes'], button: c('I checked this', '確認しました'), ...extra });
export function nordAccountRecipe(recovery = false, accountId?: string): Recipe {
  const open = make('open', c('Open the selected Nord Account', '選んだNord Accountの設定を開く'),
    c('Open Nord Account and sign in to the exact account used for NordPass. It may also be used for NordVPN and NordLocker. Keep the working NordPass session open.', 'Nord Accountを開き、NordPassで使うものと同じアカウントへログインします。NordVPN・NordLockerで使うアカウントも共通です。現在使えるNordPassのログインは残してください。'),
    c('Your correct Nord Account settings are displayed.', '今回の正しいNord Accountの設定が開くこと。'), { url: 'https://nordaccount.com/' });
  const manage = make('security', c('Open the account’s MFA settings', 'アカウントのMFA設定を開く'),
    c('In Account settings find Multi-factor authentication (MFA) and select Manage MFA. This changes protection for the Nord Account and its products, not only this device’s vault unlock.', 'Account settingsの「Multi-factor authentication (MFA)」から「Manage MFA」を開きます。この設定は、端末の保管庫解除だけでなく、Nord Accountとその製品に共通する保護です。'),
    c('The MFA settings or Nord’s email-verification screen is displayed.', 'MFAの設定、またはNordのメール確認が表示されること。'));
  const email = make('email', c('Complete Nord’s email verification', 'Nordのメール確認を行う'),
    c('Read Nord’s verification email at the mailbox registered to this account and enter the current code only in Nord’s screen. If you cannot receive mail without relying only on NordPass, keep this step unfinished and preserve your sessions.', 'このアカウントに登録したメールでNordの確認メールを受け取り、現在のコードをNordの画面だけに入力してください。NordPassの中だけに頼らないとメールを受け取れない場合は、未完了で残し、使えるログインを維持します。'),
    c('Nord accepts the email verification and shows the MFA settings.', 'Nordのメール確認が受け付けられ、MFAの設定が表示されること。'));
  const codes = make('save-codes', c('Keep the account MFA backup codes', 'アカウントのMFA用バックアップコードを保管する'),
    c('At Save backup codes, use Print or Copy to keep the current one-time codes privately outside NordPass and the authenticator phone. For an existing setup, select View codes if needed; keep valid stored codes and do not choose Get new codes merely for this guide. These 10 MFA codes differ from the 24-symbol vault Recovery Code.', '「Save backup codes」の「Print」または「Copy」で、現在の一回用コードをNordPassや認証用スマホの外へ安全に保管します。既存の設定なら必要に応じて「View codes」で確認し、有効な控えを残してください。この案内のためだけに「Get new codes」で再発行しません。この10個のMFA用コードは、24文字の保管庫用Recovery Codeとは別のものです。'),
    c('You can retrieve the current account MFA codes independently, without consuming one to test it.', '現在のMFA用コードを独立した場所から取り出せること。確認のためにコードを消費しません。'), { ...(recovery ? { control: 'recovery' } : accountId ? { extraControls: [{ targetRef: accountId, controlId: 'recovery' }] } : {}) });
  if (recovery) return { id: 'recovery', title: c('Keep Nord Account recovery available', 'Nord Accountの復旧に備える'), steps: [open, manage, email, codes] };
  return { id: 'email-mfa', title: c('Protect Nord Account', 'Nord Accountの認証を保護する'), steps: [
    open,
    make('ready', c('Keep a way to receive account mail', 'アカウントのメールを受け取る手段を残す'),
      c('Confirm you can receive mail for this Nord Account independently of the NordPass vault you are protecting. Keep current sign-in methods. Do not remove an existing key or authenticator.', '保護しようとしているNordPassの保管庫を開かなくても、Nord Accountのメールを受け取れることを確認します。現在のログイン方法は残し、既存のキーや認証アプリは削除しません。'),
      c('You can complete Nord’s email confirmation while keeping existing access.', '今の利用手段を残したまま、Nordのメール確認を行えること。')),
    manage, email,
    make('check', c('Check whether MFA is already enabled', 'MFAがすでに有効か確認する'),
      c('Check the current MFA status. If already on, keep the existing authenticator or security key and confirm it. Otherwise choose authenticator setup.', '現在のMFAの状態を確認します。すでに有効なら、今の認証アプリやセキュリティキーを維持して確認へ進みます。未設定なら認証アプリの設定を選びます。'),
      c('Choose the state actually shown in Nord Account.', 'Nord Accountに実際に表示された状態を選ぶこと。'), { choices: [{ label: c('MFA is already enabled', 'MFAはすでに有効です'), next: 'verify' }, { label: c('Set up an authenticator', '認証アプリで設定する'), next: 'auth-open' }] }),
    make('auth-open', c('Start authenticator setup', '認証アプリの設定を開始する'), c('Choose Set up beside Authenticator app. Leave this Nord Account page open.', '「Authenticator app」の横の「Set up」を選び、このNord Accountの画面を開いたままにします。'), c('Nord shows the setup QR or manual key for this exact account.', '今回のアカウント用のQRまたは手入力用キーが表示されること。')),
    make('auth-scan', c('Add the account to your authenticator', '認証アプリへ今回のアカウントを追加する'), c('Add this account to the selected authenticator using Nord’s QR or manual key. Keep the key and codes inside the official service and your authenticator.', 'NordのQRまたは手入力用キーを使い、選んだ認証アプリへ今回のアカウントを追加します。キーやコードは正規サービスと認証アプリの間だけで扱います。'), c('The selected app shows this account’s changing code.', '選んだアプリに、今回のアカウント用のコードが表示されること。')),
    make('auth-confirm', c('Confirm the changing code in Nord Account', 'Nord Accountでコードを確認する'), c('Return to Nord Account, choose Continue, and enter the current code from the selected app to complete enabling MFA. Keep this session.', 'Nord Accountへ戻り、「Continue」から選んだアプリの現在のコードを入力し、有効化を完了します。このログインは残してください。'), c('Nord accepts the code and enables the authenticator.', 'Nordでコードが受け付けられ、認証アプリが有効になること。')),
    codes,
    make('verify', c('Confirm the current MFA status', '現在のMFAの有効状態を確認する'), c('Check Nord Account shows MFA on and the intended method remains registered. Keep an existing key if that is your method. This does not require replacing it or signing out of working sessions.', 'Nord AccountでMFAが有効であり、意図した方法が登録されていることを確かめます。セキュリティキーを使っている場合も維持し、置換や、使えるログインからのサインアウトは行いません。'), c('MFA is shown as enabled for this Nord Account.', '今回のNord AccountでMFAが有効と表示されること。'), { control: 'mfa', button: c('I confirmed MFA', 'MFAを確認しました'), technical: 'mfa' }),
  ] };
}
