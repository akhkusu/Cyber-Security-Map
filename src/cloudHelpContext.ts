import type { Dataset } from './models';
import type { Copy } from './guideCatalog';
import { cloudAnswer, cloudInstallation, cloudVault, selectedCloudInstallation, CLOUD_NAMES, CLOUD_PRODUCTS, type CloudProduct } from './cloudManagers';
import { cloudRouteSources } from './cloudSources';

const labels: Record<string, Copy> = {
  'cloud-choice': { en: 'Choose the actual password store', ja: '実際に使う保管庫を選ぶ' },
  'cloud-root': { en: 'Choose the backing account', ja: '保管庫の基盤アカウントを選ぶ' },
  'cloud-usage': { en: 'Check whether this vault already exists', ja: '既存の保管庫か確認する' },
  'cloud-device': { en: 'Select the physical device and profile', ja: '使う物理端末・プロファイルを選ぶ' },
  'cloud-device-os': { en: 'Confirm the selected device’s OS', ja: '選んだ端末のOSを確認する' },
  'cloud-ios': { en: 'Confirm the iOS version range', ja: 'iOSの世代を確認する' },
  'cloud-android': { en: 'Confirm the Android version range', ja: 'Androidの世代を確認する' },
  'cloud-browser': { en: 'Choose the actual browser', ja: '実際に使うブラウザーを選ぶ' },
  'cloud-profile': { en: 'Distinguish the browser profile', ja: 'ブラウザープロファイルを区別する' },
  'cloud-prerequisites': { en: 'Protect the backing account and recovery', ja: '基盤アカウントの認証と復旧を確保する' },
  'cloud-recovery': { en: 'Keep vault recovery available', ja: '保管庫の復旧用情報を確保する' },
  'cloud-phrase': { en: 'Keep Proton’s account/data recovery phrase', ja: 'Protonのアカウント・データ復旧フレーズを確保する' },
  'cloud-reset': { en: 'Verify an additional Proton password-reset method', ja: '追加のProtonパスワード再設定方法を確認する' },
  'cloud-file': { en: 'Keep Proton’s recovery file privately', ja: 'Protonの復旧ファイルを安全に確保する' },
  'cloud-password-choice': { en: 'Keep an existing unique password or change it', ja: '現在の固有パスワードを維持するか、変更するかを決める' },
  'cloud-account-method': { en: 'Identify the Nord Account sign-in method', ja: 'Nord Accountのログイン方法を確認する' },
  'cloud-sso-unavailable': { en: 'Preserve the connected sign-in and its dependencies', ja: '接続しているログイン方法とその依存先を維持する' },
  'cloud-master-review': { en: 'Check the current master password’s strength', ja: '現在のマスターの強度を確認する' },
  'cloud-master-needs-change': { en: 'Continue the existing-master change', ja: '既存マスターの変更を続ける' },
};
export function cloudHelpContext(data: Dataset, subjectRef?: string, recipeId?: string) {
  const [route, ref] = data.guide.cursor.split('/');
  const rootReturn = subjectRef && data.guide.answers[`return/${subjectRef}/${recipeId}`];
  if (!route.startsWith('cloud-') && !recipeId?.startsWith('cloud-') && !rootReturn?.startsWith('cloud-')) return;
  const bound = recipeId?.startsWith('cloud-password:') ? recipeId.slice('cloud-password:'.length) : subjectRef;
  const app = cloudInstallation(data, bound) ?? cloudInstallation(data, ref);
  const vault = cloudVault(data, app?.vaultRef ?? ref) ?? cloudVault(data, data.guide.managerId);
  const product = vault?.productId ?? (route === 'cloud-choice' && CLOUD_PRODUCTS.includes(ref as CloudProduct) ? ref : undefined);
  if (!product) return;
  const selected = app ?? (vault && selectedCloudInstallation(data, vault.id));
  const device = data.assets.find(a => a.id === selected?.deviceRef);
  const rawBrowser = selected && cloudAnswer(data, selected.id, 'browser');
  const browser = ({ chrome: 'Chrome', firefox: 'Firefox', edge: 'Edge', safari: 'Safari', brave: 'Brave', opera: 'Opera' } as Record<string, string>)[rawBrowser ?? ''];
  const osRange = ({ ios18plus: 'iOS / iPadOS 18+', ios17: 'iOS / iPadOS 17', android9plus: 'Android 9+' } as Record<string, string>)[selected ? cloudAnswer(data, selected.id, device?.operatingSystem === 'ios' ? 'ios' : 'android') ?? '' : ''];
  return { product: CLOUD_NAMES[product as CloudProduct], os: device?.operatingSystem, browser, osRange,
    title: labels[route] ?? { en: 'Continue the verified password-manager setup', ja: '確認済みのパスワード管理の手順を続ける' },
    expected: { en: 'The personal account, selected device/profile and official app settings match. Preserve existing data and working access.', ja: '個人用アカウント、選んだ端末・プロファイル、正規アプリの設定が一致すること。既存データと使えるログインを維持する。' },
    sources: cloudRouteSources(product, route),
  };
}
