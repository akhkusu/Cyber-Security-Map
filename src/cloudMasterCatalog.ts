import type { Dataset } from './models';
import { c, type Copy, type GuideStep, type Recipe } from './guideCatalog';
import { privatePassphraseStep } from './passphraseCatalog';
import { cloudInstallation, cloudVault } from './cloudManagers';

export function cloudMasterRecipe(data: Dataset, installationId: string, phase: string): Recipe | undefined {
  const app = cloudInstallation(data, installationId), vault = cloudVault(data, app?.vaultRef);
  const device = data.assets.find(a => a.id === app?.deviceRef);
  if (!phase.startsWith('cloud-master-change:') || !app || vault?.productId !== 'nordpass' || !device) return;
  const mobile = ['ios', 'android'].includes(device.operatingSystem ?? ''), place = c('Your existing NordPass personal vault', '現在のNordPassの個人用保管庫');
  const step = (id: string, title: Copy, action: Copy, expected: Copy, requires: string[], extra: Partial<GuideStep> = {}): GuideStep => ({ id, title, place, action, expected, requires, sources: ['nordMasterStrength', 'nordAccount', 'nordRecovery'], button: c('I checked this', '確認しました'), ...extra });
  return { id: phase, title: c('Strengthen an existing NordPass Master Password', '現在のNordPassのマスターを強くする'), steps: [
    step('open', c('Keep access and recovery before changing the master', '変更する前に、現在の利用・復旧手段を残す'),
      c('Keep a working vault session, the current Master Password, the independent Nord Account sign-in and its MFA recovery, and the current 24-symbol vault Recovery Code. This flow changes a known current master. If you cannot supply the current master, stop here; do not reset a populated account.', '使える保管庫の画面、現在のMaster Password、独立したNord Accountのログイン・MFAの復旧手段、現在の24文字の保管庫用Recovery Codeを残します。ここでは現在のマスターを使って変更します。現在のマスターが分からなければ止まり、情報の入ったアカウントのリセットは行いません。'),
      c('You can use the current master and retrieve the independent recovery information.', '現在のマスターが使え、独立した復旧用情報を取り出せること。'), []),
    { ...privatePassphraseStep('phrase', c('the replacement NordPass Master Password', '変更後のNordPassのMaster Password'), place, 'nordMasterStrength'), requires: ['open'] },
    step('paper', c('Keep the replacement outside NordPass', '変更候補をNordPassの外へ控える'),
      c('Privately write the new master on paper, labeled as a pending NordPass Master Password change. Keep the current master and recovery copy too. Keep the paper in locked storage away from the phone; do not put the only copy inside the vault being changed.', '新しい候補を「NordPassのMaster Password・変更前の候補」と区別して紙へ控えます。現在のマスターと復旧用の控えも残し、紙は端末と離れた施錠できる場所へ置いてください。変更する保管庫の中だけには置きません。'),
      c('The replacement can be retrieved even if NordPass requires unlocking again.', 'NordPassの再解除を求められても、変更候補を取り出せること。'), ['phrase']),
    step('form', c('Open Change Master Password', 'Master Passwordの変更画面を開く'),
      c(mobile ? 'In the existing NordPass app open Profile → Settings → Change Master Password. Do not select Reset account.' : 'Open the official web vault, sign in to the existing account, then Settings → Security → Change Master Password. This is the vault master, separate from the Nord Account password.', mobile ? '現在のNordPassアプリの「Profile」→「Settings」→「Change Master Password」を開きます。「Reset account」は選びません。' : '正規のWeb保管庫で現在のアカウントへログインし、「Settings」→「Security」→「Change Master Password」を開きます。Nord Account用のパスワードとは別の、保管庫用マスターの変更です。'),
      c('The current and replacement master fields appear for the existing vault.', '既存の保管庫の、現在・変更後のマスターを入力する欄が表示されること。'), ['paper'], mobile ? {} : { url: 'https://app.nordpass.com/' }),
    step('apply', c('Confirm the master change in NordPass', 'NordPassでマスターの変更を確定する'),
      c('Enter the current Master Password and the privately prepared replacement only in NordPass. Confirm the change; desktop/web uses Change password. Keep all working sessions and recovery copies until the next check. Changing this master does not change the Nord Account password.', '現在のMaster Passwordと控えてある新しい候補を、NordPassの画面だけに入力して変更を確定します。PC・Webでは「Change password」です。次の確認が済むまで、使えるログインと復旧用の控えを残してください。この変更でNord Account用のパスワードは変わりません。'),
      c('NordPass accepts the change for the existing vault.', '既存の保管庫で、NordPassに変更が受け付けられること。'), ['form'], { button: c('NordPass accepted the change', '変更が受け付けられました') }),
    step('test', c('Unlock the same vault with the new master', '新しいマスターで同じ保管庫を開く'),
      c('Keep another working session if available. Use NordPass’s normal vault lock, then unlock using the new Master Password; choose Use Master Password if biometric unlock is offered. Read a familiar item without copying it here. An already-open or biometric-only unlock does not test the new master. Keep the current recovery information; do not rotate or reset it merely for this check.', '別の使えるログインがあれば残します。NordPassの通常の保管庫ロックを使い、新しいMaster Passwordで解除してください。生体認証が提示された場合は「Use Master Password」で進みます。見覚えのある項目を開き、内容はここへ写しません。開いたままの画面や生体認証だけでは、新しいマスターの確認にはなりません。現在の復旧用情報も残し、確認のためだけの再発行やリセットは行いません。'),
      c('The new master opens the same existing vault and its contents. The private copy matches it.', '新しいマスターで、同じ既存保管庫と内容を開け、私的な控えも一致すること。'), ['apply'], { extraControls: [{ targetRef: vault.id, controlId: 'masterStrength' }, { targetRef: vault.id, controlId: 'masterChanged' }], button: c('I unlocked it with the new master', '新しいマスターで開けました') }),
  ] };
}
