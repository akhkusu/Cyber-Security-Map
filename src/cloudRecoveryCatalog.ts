import type { Dataset } from './models';
import { c, type Copy, type GuideStep, type Recipe, type SourceId } from './guideCatalog';
import { cloudAnswer, cloudInstallation, cloudVault } from './cloudManagers';

const checked = c('I checked this', '確認しました');
const action = (id: string, title: Copy, place: Copy, text: Copy, expected: Copy, source: SourceId, extra: Partial<GuideStep> = {}): GuideStep => ({ id, title, place, action: text, expected, sources: [source], button: checked, ...extra });
export function cloudRecoveryRecipe(data: Dataset, installationId: string, phase: string): Recipe | undefined {
  const app = cloudInstallation(data, installationId), vault = cloudVault(data, app?.vaultRef), root = data.assets.find(a => a.id === vault?.authenticationAccountRef);
  const device = data.assets.find(a => a.id === app?.deviceRef);
  if (!app || !vault || !root || !device) return;
  const nord = vault.productId === 'nordpass', mobile = ['ios', 'android'].includes(device.operatingSystem ?? '');
  const place = c(nord ? `${device.name} · NordPass` : 'Proton Account → Recovery', nord ? `${device.name} · NordPass` : 'Proton Account →「Recovery」');
  const steps: GuideStep[] = [];
  if (phase === 'cloud-recovery' && nord) {
    const existing = cloudAnswer(data, vault.id, 'recovery') === 'existing';
    steps.push(action('open', c('Find the vault recovery settings', '保管庫の復旧設定を開く'), place,
      c(mobile ? 'In NordPass select Profile → Settings. Find Reset Recovery Code under Security, but do not select it yet.' : 'In NordPass select the settings cog and find Reset Recovery Code under Security. Do not select it yet.', mobile ? 'NordPassの「Profile」→「Settings」で、Security欄の「Reset Recovery Code」を探します。まだリセットは選びません。' : 'NordPassの歯車の設定を開き、Security欄の「Reset Recovery Code」を探します。まだリセットは選びません。'),
      c('You can identify the vault Recovery Code setting, separate from Nord Account MFA.', 'Nord AccountのMFAとは別の、保管庫のRecovery Codeの項目を確認できること。'), 'nordRecovery'));
    if (!existing) {
      steps.push(action('replace', c('Create a new vault Recovery Code', '保管庫のRecovery Codeを作成する'), place,
        c('Select Reset Recovery Code. Read the warning: all earlier vault Recovery Codes stop working. If you intend to replace them, choose Reset, confirm with the current Master Password or the offered biometric unlock, then Continue. Do not use Reset account.', '「Reset Recovery Code」を選び、以前の保管庫用コードがすべて使えなくなる注意を確認します。置き換える意図がある場合だけ「Reset」を選び、現在のMaster Passwordまたは表示された生体認証で確認し、「Continue」へ進みます。「Reset account」は使いません。'),
        c('NordPass shows the new vault Recovery Code after your authentication.', '本人確認後に、新しい保管庫用Recovery Codeが表示されること。'), 'nordRecovery', { requires: ['open'] }));
    }
    steps.push(action('store', c('Keep the 24-symbol vault Recovery Code privately', '24文字の保管庫用Recovery Codeを保管する'), place,
      c(existing ? 'Locate the current 24-symbol Recovery Code you already kept. Keep it outside NordPass, labeled as vault/master recovery, and accessible without opening the vault. Do not rotate a valid code just for this guide. It differs from Nord Account’s MFA backup codes.' : 'Use Copy or Download as PDF and keep the new 24-symbol code outside NordPass, such as a private printed copy in locked storage. Replace the outdated copy after the new copy is safely kept. Label it as vault/master recovery, separate from Nord Account’s MFA codes.', existing ? '控えてある現在の24文字のRecovery Codeを取り出せるか確認します。NordPassの外へ、保管庫・マスターの復旧用と分かる形で保管してください。この案内のためだけに、有効なコードを再発行する必要はありません。Nord AccountのMFA用バックアップコードとは別のものです。' : '「Copy」または「Download as PDF」で新しい24文字のコードを控え、NordPassの外にある施錠できる場所へ紙で置くなど、安全に保管します。新しい控えを確保してから古い控えを整理します。保管庫・マスターの復旧用と明記し、Nord AccountのMFA用コードと分けてください。'),
      c('The current vault Recovery Code is reachable without NordPass. Do not reset the Master Password to test it.', '現在の保管庫用コードをNordPassなしで取り出せること。確認のためにMaster Passwordをリセットしません。'), 'nordRecovery', { requires: [existing ? 'open' : 'replace'], extraControls: [{ targetRef: vault.id, controlId: 'recovery' }], button: c('I stored the recovery information', '復旧用の情報を保管しました') }));
    steps.push(action('account-access', c('Keep Nord Account access outside the vault', 'Nord Accountへのログイン手段を保管庫の外に残す'), place,
      c('Check that you can retrieve your Nord Account sign-in password or receive its email verification without opening NordPass. If the only password or only way to open that mailbox is inside this vault, keep a private independent copy or another working route first. Keep the vault Master Password/recovery copy separately labeled. The vault Recovery Code cannot replace Nord Account sign-in or its MFA.', 'NordPassを開かずに、Nord Account用のパスワードを取り出すか、登録メールで本人確認を受け取れるかを確かめます。唯一のパスワードやメールを開く手段がこの保管庫の中だけにある場合は、先に私的な控えや別の使える方法を確保してください。保管庫用マスター・復旧用の控えも用途を区別して残します。保管庫のRecovery Codeだけでは、Nord AccountのログインやMFAは置き換えられません。'),
      c('Account sign-in information and vault recovery are accessible without opening the same vault.', '同じ保管庫を開かなくても、アカウントのログイン情報と保管庫の復旧用情報を取り出せること。'), 'nordAccount', { requires: ['store'], extraControls: [{ targetRef: vault.id, controlId: 'independentRoot' }] }));
  } else if (!nord && phase === 'cloud-phrase') {
    const existing = cloudAnswer(data, root.id, 'phrase') === 'existing';
    steps.push(action('open', c('Open Proton recovery-phrase settings', 'Protonの復旧フレーズ設定を開く'), place,
      c('Open the official Proton Account settings → Recovery → Advanced recovery options → Recovery phrase. Check whether the current phrase is active and ready, or needs action. Keep an existing Recovery Kit.', '正規のProton Account設定から「Recovery」→「Advanced recovery options」→「Recovery phrase」を開きます。現在のフレーズが有効で利用可能か、対応が必要かを確認してください。既存のRecovery Kitは残します。'),
      c('The recovery-phrase status for this exact Proton Account is displayed.', 'このProton Accountの復旧フレーズの状態が表示されること。'), 'protonRecoveryPhrase', { url: 'https://account.proton.me/' }));
    if (!existing) steps.push(action('create', c('Create the recovery phrase in Proton', 'Protonの画面で復旧フレーズを作成する'), place,
      c('If no usable phrase is enabled, select Create recovery phrase. Use the Download icon for its PDF, or Copy recovery phrase. If a current phrase is already active, go back and choose the existing-phrase branch instead of replacing it.', '利用できるフレーズが未設定なら「Create recovery phrase」を選びます。ダウンロードのアイコンでPDFを保存するか、「Copy recovery phrase」で控えます。現在のフレーズがすでに有効なら、戻って既存のフレーズを確認する分岐を選び、不要な置換はしません。'),
      c('Proton has enabled the new 12-word phrase and you can keep a private copy.', 'Protonで新しい12語のフレーズが有効になり、本人が控えを保管できること。'), 'protonRecoveryPhrase', { requires: ['open'] }));
    steps.push(action('store', c('Store Proton recovery outside Proton', 'Protonの復旧フレーズをProtonの外へ保管する'), place,
      c('Keep the current 12-word phrase or Recovery Kit somewhere you can reach without any Proton service, for example printed in locked storage. Do not keep the only copy in Proton Pass or Proton Drive. Check that its setting is ready; action-needed or outdated is unfinished. It can reset the account password and recover encrypted data, unlike a 2FA backup code.', '現在の12語のフレーズまたはRecovery Kitを、Protonのサービスを一つも開かずに取り出せる場所へ保管します。施錠できる場所に紙で置く方法などを選び、Proton PassやProton Driveの中だけには置きません。設定が利用可能な状態であることも確認します。要対応・期限切れの表示は未完了です。これはアカウントのパスワード再設定と暗号化データの復旧用で、2FAのバックアップコードとは別です。'),
      c('The current recovery phrase is ready and accessible independently of Proton; no test password reset is required.', '現在の復旧フレーズが利用可能で、Protonの外から取り出せること。試すためのパスワード再設定は不要です。'), 'protonRecoveryPhrase', { requires: [existing ? 'open' : 'create'], extraControls: [{ targetRef: root.id, controlId: 'dataRecovery' }], button: c('I stored the recovery phrase', '復旧フレーズを保管しました') }));
  } else if (!nord && phase === 'cloud-reset') {
    const mode = cloudAnswer(data, root.id, 'reset') ?? '', sms = mode.endsWith('sms'), existing = mode.startsWith('existing');
    steps.push(action('open', c('Open an additional password-reset method', '追加のパスワード再設定方法を開く'), place,
      c(`In Proton Account settings open Recovery → Password reset options → ${sms ? 'SMS verification' : 'Email verification'}. This method resets the account password; the independent phrase and recovery file are for the encrypted data too.`, `Proton Account設定の「Recovery」→「Password reset options」→「${sms ? 'SMS verification' : 'Email verification'}」を開きます。この方法はアカウントのパスワードを再設定するもので、暗号化データには復旧フレーズや復旧ファイルも必要です。`),
      c('The selected password-reset destination and its status are shown.', '選んだ再設定方法の宛先と状態が表示されること。'), 'protonResetRecovery', { url: 'https://account.proton.me/' }));
    if (!existing) {
      steps.push(action('destination', c('Set the recovery destination only in Proton', 'Protonの画面に復旧先を設定する'), place,
        c(`Enter your ${sms ? 'phone number' : 'separate email address you control'} in Proton’s screen, then select Add and verify. Confirm using your Proton password there. Enter the password only in Proton.`, `Protonの画面だけに、${sms ? '本人が利用できる電話番号' : '自分が管理する別のメールアドレス'}を入力し、「Add and verify」を選びます。Protonのパスワードによる確認もその画面内で行います。パスワードはProtonの画面だけに入力してください。`),
        c('Proton accepts the destination and offers its verification.', 'Protonで宛先が受け付けられ、確認の案内が出ること。'), 'protonResetRecovery', { requires: ['open'] }));
      steps.push(action('verify', c('Verify the destination', '復旧先が本人のものだと確認する'), place,
        c(sms ? 'Select Verify by SMS. Read the SMS at your own phone and enter the code only in Proton, then select Verify account.' : 'Select Verify with email. Open that mailbox and follow Proton’s verification message. Keep access to the mailbox while doing this.', sms ? '「Verify by SMS」を選び、自分の端末でSMSを受け取ります。コードはProtonの画面だけに入力し、「Verify account」を選びます。' : '「Verify with email」を選び、そのメールを受け取る保管庫ではなく実際のメール受信画面を開いて、Protonの確認メールの案内を進めます。このメールを受け取れる状態は維持してください。'),
        c('Proton accepts the destination verification.', 'Protonで宛先の確認が受け付けられること。'), 'protonResetRecovery', { requires: ['destination'] }));
    }
    steps.push(action('ready', c('Check that the reset method is ready', '再設定方法が利用可能か確認する'), place,
      c(`Check that ${sms ? 'SMS verification' : 'Email verification'} is enabled and ready, without an action-needed label. Confirm you can use that ${sms ? 'phone line' : 'mailbox'} without relying only on Proton Pass. If it depends on the same locked account, leave it unfinished. Do not send a password-reset request merely to test it.`, `「${sms ? 'SMS verification' : 'Email verification'}」が有効で、要対応の表示がないか確認します。Proton Passだけに頼らず、その${sms ? '回線' : 'メール'}を利用できることも確かめてください。同じロックされたアカウントに依存するなら未完了で残します。確認のためだけのパスワード再設定は行いません。`),
      c('The additional reset method is verified, enabled and reachable.', '追加の再設定方法が確認済み・有効で、本人が利用できること。'), 'protonResetRecovery', { requires: [existing ? 'open' : 'verify'], extraControls: [{ targetRef: root.id, controlId: 'passwordResetRecovery' }] }));
  } else if (!nord && phase === 'cloud-file') {
    const existing = cloudAnswer(data, root.id, 'file') === 'existing';
    steps.push(action('open', c('Open Proton recovery-file settings', 'Protonの復旧ファイル設定を開く'), place,
      c('In Proton Account settings open Recovery → Data recovery options → Recovery file. Keep trusted devices and existing files. Do not select Void all recovery files.', 'Proton Account設定の「Recovery」→「Data recovery options」→「Recovery file」を開きます。既存の信頼済み端末やファイルは残し、「Void all recovery files」は選びません。'),
      c('The recovery-file setting for this account is open.', 'このアカウントの復旧ファイル設定が開いていること。'), 'protonRecoveryFile', { url: 'https://account.proton.me/' }));
    if (!existing) steps.push(action('download', c('Download the recovery file', '復旧ファイルをダウンロードする'), place,
      c('Select Download in Proton’s recovery-file setting and save the file privately. This encrypted backup keychain is separate from this app’s encrypted backup. Do not import it into this app.', 'Protonの復旧ファイル設定で「Download」を選び、ファイルを本人の保管先へ保存します。この暗号化した鍵の控えは、このアプリの暗号化バックアップとは別のものです。このアプリへ取り込まないでください。'),
      c('The official recovery file has been saved successfully.', '正規の復旧ファイルを正常に保存できたこと。'), 'protonRecoveryFile', { requires: ['open'] }));
    steps.push(action('store', c('Keep the recovery file separately', '復旧ファイルを別の場所へ保管する'), place,
      c('Locate the current recovery file, keep it somewhere private and reachable without Proton, and separate it from the account password. Check that its setting is ready rather than outdated. Together with the reset method it can help recover old encrypted data. Do not void files, reset the account or consume a recovery method to test this.', '現在の復旧ファイルを取り出せるか確認し、Protonを使わずに取り出せる私的な保管場所へ、アカウントのパスワードとは分けて置きます。設定も期限切れではなく利用可能か確かめます。再設定方法と組み合わせて、既存の暗号化データの復旧に使うものです。確認のためにファイルを失効させたり、アカウントをリセットしたりしません。'),
      c('The current file is private, accessible and separated from the account password.', '現在のファイルを、本人がパスワードとは分けて安全に取り出せること。'), 'protonRecoveryFile', { requires: [existing ? 'open' : 'download'], extraControls: [{ targetRef: root.id, controlId: 'recoveryFile' }], button: c('I stored the recovery file', '復旧ファイルを保管しました') }));
  } else return;
  return { id: phase, title: c(nord ? 'Prepare NordPass vault recovery' : 'Prepare Proton account and data recovery', nord ? 'NordPassの保管庫の復旧に備える' : 'Protonのアカウントとデータの復旧に備える'), steps };
}
