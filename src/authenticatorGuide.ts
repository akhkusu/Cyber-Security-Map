import {createEnteApp,startEnteTask} from './enteData';
import {enteProfile,entePrepared,enteBackupCurrent,enteStore} from './enteSchemas';
import {enteAccountReady} from './enteEngine';
import {createTwofasApp,startTwofasTask} from './twofasEngine';
import {twofasProfile,twofasPrepared,twofasBackupCurrent,twofasStore,twofasReceiptCurrent,twofasLinkCurrent} from './twofasSchemas';
import { recordedUnavailable } from './recordAvailability';
import { makeAsset, upgradeDataset, type Asset, type CurrentDataset, type Dataset } from './models';
import { securityEntitySchema, type SecurityEntity } from './securityModel';
import { c, deviceRecipe, type GuideStep, type Recipe, type SourceId } from './guideCatalog';

export const AUTHENTICATORS = { 'ente-auth': c('Ente Auth','Ente Auth'), '2fas-auth': c('2FAS Auth', '2FAS Auth'), 'google-authenticator': c('Google Authenticator', 'Google 認証システム'), 'microsoft-authenticator': c('Microsoft Authenticator', 'Microsoft Authenticator'), 'bitwarden-authenticator': c('Bitwarden Authenticator (standalone)', 'Bitwarden Authenticator（単独アプリ）') };
export type AuthenticatorProduct = keyof typeof AUTHENTICATORS;
export type AuthenticatorInstallation = Extract<SecurityEntity, { kind: 'installation' }>;
export const authSources = (product: AuthenticatorProduct): SourceId[] => product === 'ente-auth' ? ['enteAuth','enteFaq','enteMobileSource'] : product === '2fas-auth' ? ['twofasTutorial','twofasIos','twofasAndroid'] : product === 'google-authenticator' ? ['googleAuth', 'googleAuthMenus'] : product === 'microsoft-authenticator' ? ['microsoftAuth', 'microsoftAuthFaq'] : ['bwAuthenticator'];
export function authenticator(data: Dataset, id?: string): AuthenticatorInstallation | undefined {
  if (data.version !== 2) return;
  const seen = new Set<string>(); let ref = id;
  while (ref && !seen.has(ref)) {
    seen.add(ref); const item = data.securityModel.entities.find(e => e.id === ref && e.kind === 'installation' && Object.hasOwn(AUTHENTICATORS, e.productId) && (e.productId!=='2fas-auth'||!!twofasProfile(data,e.id)) && (e.productId!=='ente-auth'||!!enteProfile(data,e.id)));
    if (item?.kind !== 'installation') return;
    if (!item.mergedIntoRef) return item;
    ref = item.mergedIntoRef as string;
  }
}
export const selectedAuthenticator = (data: Dataset, accountId: string) => authenticator(data, data.guide.answers[`auth:${accountId}:app`]);
export const authenticatorScan = (recipe: string, step: string) => (recipe === 'email-mfa' && ['auth-scan', 'scan'].includes(step)) || (recipe === 'manager' && step === 'auth-scan');
export const authenticatorConfirmation = (recipe: string, step: string) => (recipe === 'email-mfa' && ['auth-confirm', 'confirm'].includes(step)) || (recipe === 'manager' && step === 'auth-activate');
export function setAuthCursor(data: Dataset, cursor: string): Dataset { return { ...data, guide: { ...data.guide, cursor, history: [...data.guide.history, data.guide.cursor].slice(-200) } }; }
export function chooseAuthenticator(data: Dataset, accountId: string, product: AuthenticatorProduct, deviceId: string, returnCursor: string, reuse = true, scopePath = '/guide'): CurrentDataset {
  if (!Object.hasOwn(AUTHENTICATORS, product)) throw new Error('Unsupported authenticator');
  let next = upgradeDataset(data); const device = next.assets.find(a => a.id === deviceId && a.kind === 'device' && ['ios', 'android'].includes(a.operatingSystem ?? ''));
  if (!device) throw new Error('Select a supported physical device');
  const candidates = next.securityModel.entities.filter(e => e.kind === 'installation' && !e.mergedIntoRef && e.productId === product && e.deviceRef === deviceId);
  const existing = reuse && candidates.length === 1 ? candidates[0] : undefined;
  if(product==='ente-auth'){const made=createEnteApp(next,deviceId,existing?.id);next=made.data;const result=startEnteTask(next,{kind:'prepare',appRef:made.appRef,origin:'guide',accountRef:accountId,returnCursor,scopePath});return {...result.data,guide:{...result.data.guide,answers:{...result.data.guide.answers,[`auth:${accountId}:app`]:made.appRef,[`auth:${accountId}:task`]:returnCursor,[`auth:${accountId}:scope`]:scopePath}}};}
  if(product==='2fas-auth'){const made=createTwofasApp(next,deviceId,existing?.id);next=made.data;const result=startTwofasTask(next,{kind:'prepare',appRef:made.appRef,origin:'guide',accountRef:accountId,returnCursor,scopePath});return {...result.data,guide:{...result.data.guide,answers:{...result.data.guide.answers,[`auth:${accountId}:app`]:made.appRef,[`auth:${accountId}:task`]:returnCursor}}};}
  const item = existing ?? securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'installation', productId: product, deviceRef: device.id, label: `${AUTHENTICATORS[product][next.settings.language]} · ${device.name}`.slice(0, 80), createdAt: new Date().toISOString(), controls: {}, controlEvidence: {} });
  return { ...next, securityModel: { ...next.securityModel, entities: existing ? next.securityModel.entities : [...next.securityModel.entities, item] }, guide: { ...next.guide, answers: { ...next.guide.answers, [`auth:${accountId}:app`]: item.id, [`auth:${accountId}:task`]: returnCursor } } };
}
export function configureAuthenticator(data: Dataset, accountId: string, installationId: string, mode: 'local' | 'account', rootId?: string): Dataset {
  const install = authenticator(data, installationId); if (!install || data.version !== 2) return data;
  if (mode === 'account' && (install.productId !== 'google-authenticator' || !data.assets.some(a => a.id === rootId && a.provider === 'google' && a.purpose === 'personal'))) return data;
  rootId = mode === 'account' ? rootId : undefined;
  const matching = data.securityModel.entities.find(e => e.kind === 'installation' && !e.mergedIntoRef && e.productId === install.productId && e.deviceRef === install.deviceRef && e.codeStorage === mode && e.syncAccountRef === rootId);
  let chosen = matching?.kind === 'installation' ? matching : install;
  if (!matching && install.codeStorage && (install.codeStorage !== mode || install.syncAccountRef !== rootId)) chosen = securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'installation', productId: install.productId, deviceRef: install.deviceRef, codeStorage: mode, syncAccountRef: rootId, label: `${AUTHENTICATORS[install.productId as AuthenticatorProduct][data.settings.language]} · ${mode === 'account' ? data.assets.find(a => a.id === rootId)?.name : data.settings.language === 'ja' ? '端末内' : 'Local'} · ${data.assets.find(a => a.id === install.deviceRef)?.name}`.slice(0, 80), createdAt: new Date().toISOString(), controls: {}, controlEvidence: {} }) as AuthenticatorInstallation;
  chosen = { ...chosen, codeStorage: mode, syncAccountRef: rootId };
  const ids = [install.id];
  const referenced = JSON.stringify({ actions: data.actions, steps: data.guide.steps, dependencies: data.dependencies, workflows: data.deviceWorkflows, model: { ...data.securityModel, entities: data.securityModel.entities.filter(e => !ids.includes(e.id)) } }).includes(install.id);
  const alias = chosen.id !== install.id && !install.codeStorage && !Object.keys(install.controls ?? {}).length && !referenced;
  return { ...data, securityModel: { ...data.securityModel, entities: [...data.securityModel.entities.filter(e => e.id !== chosen.id).map(e => e.id === install.id && alias ? { ...e, mergedIntoRef: chosen.id } : e), chosen] }, guide: { ...data.guide, answers: { ...data.guide.answers, [`auth:${accountId}:app`]: chosen.id } } };
}
export function addAuthenticatorRoot(data: Dataset, accountId: string, installationId: string): Dataset {
  const root = { ...makeAsset({ kind: 'account', type: 'Identity provider', name: `Google Account ${data.assets.filter(a => a.provider === 'google').length + 1}`, importance: 'critical' }), provider: 'google' as const, purpose: 'personal' as const, services: [] };
  return configureAuthenticator({ ...data, assets: [...data.assets, root] }, accountId, installationId, 'account', root.id);
}

export function authenticatorPrerequisiteRoute(data: Dataset, accountId: string): string | undefined {
  const app = selectedAuthenticator(data, accountId);
  if (!app) return `authenticator-product/${accountId}`;
  const device = data.assets.find(a => a.id === app.deviceRef);
  if (!device || !['ios', 'android'].includes(device.operatingSystem ?? '')) return `authenticator-device/${accountId}`;
  if(app.productId==='ente-auth'){if(!entePrepared(data,app.id)){const pending=enteStore(data)?.tasks.filter(t=>t.kind==='prepare'&&t.appRef===app.id&&t.accountRef===accountId&&t.returnCursor===data.guide.answers[`auth:${accountId}:task`]&&t.scopePath===(data.guide.answers[`auth:${accountId}:scope`]??'/guide')&&t.status!=='cancelled').at(-1);return pending?`ente/${pending.id}`:`authenticator-ente-start/${accountId}`;}return;}
  if(app.productId==='2fas-auth'){if(!twofasPrepared(data,app.id)){const pending=twofasStore(data)?.tasks.filter(t=>t.kind==='prepare'&&t.appRef===app.id&&t.accountRef===accountId&&t.returnCursor===data.guide.answers[`auth:${accountId}:task`]&&t.status!=='cancelled').at(-1);return pending?`twofas/${pending.id}`:`authenticator-twofas-start/${accountId}`;}return;}
  if (!app.codeStorage || (app.productId !== 'google-authenticator' && app.codeStorage !== 'local')) return `authenticator-mode/${accountId}`;
  if (app.codeStorage === 'account' && !data.assets.some(a => a.id === app.syncAccountRef && a.kind === 'account' && a.provider === 'google' && a.purpose === 'personal')) return `authenticator-root/${accountId}`;
}
export function authenticatorReady(data: Dataset, install?: AuthenticatorInstallation) {
  if(install?.productId==='ente-auth')return entePrepared(data,install.id);
  const device = data.assets.find(a => a.id === install?.deviceRef);
  const rootOK = install?.codeStorage === 'local' || (install?.productId === 'google-authenticator' && data.assets.some(a => a.id === install.syncAccountRef && a.kind === 'account' && a.provider === 'google' && a.purpose === 'personal'));
  return !recordedUnavailable(data,[install?.id]) && (install?.productId!=='2fas-auth'||twofasPrepared(data,install.id)) && !!install && rootOK && ['ios', 'android'].includes(device?.operatingSystem ?? '') && install.controls?.opened === 'verified' && install.controls?.storageChecked === 'verified' && ['implemented', 'verified'].includes(device?.controls.screenLock ?? 'unknown') && (install.productId !== 'microsoft-authenticator' || install.controls?.appLock === 'verified');
}
export function authenticatorSetupRoute(data: Dataset, accountId: string, returnCursor = data.guide.answers[`auth:${accountId}:task`]): string {
  const prerequisite = authenticatorPrerequisiteRoute(data, accountId); if (prerequisite) return prerequisite;
  const app = selectedAuthenticator(data, accountId)!;
  if (!authenticatorReady(data, app)) return `do/${accountId}/authenticator-setup:${app.id}/open`;
  if (!returnCursor || !authenticatorScan(returnCursor.split('/')[2], returnCursor.split('/')[3])) return returnCursor ?? `authenticator-product/${accountId}`;
  const method = data.guide.answers[`auth:${accountId}:input:${app.id}`];
  return method ? returnCursor : `authenticator-input/${accountId}`;
}
const step = (id: string, title: GuideStep['title'], place: GuideStep['place'], action: GuideStep['action'], expected: GuideStep['expected'], sources: SourceId[], extra: Partial<GuideStep> = {}): GuideStep => ({ id, title, place, action, expected, sources, button: c('I checked this', '確認しました'), ...extra });
export function authenticatorSetupRecipe(data: Dataset, account: Asset): Recipe | undefined {
  const app = selectedAuthenticator(data, account.id); if (!app || app.productId==='2fas-auth'||app.productId==='ente-auth') return;
  const device = data.assets.find(a => a.id === app.deviceRef); if (!device) return;
  const product = app.productId as AuthenticatorProduct, bw = product === 'bitwarden-authenticator', google = product === 'google-authenticator', ios = device.operatingSystem === 'ios';
  const source = authSources(product), place = c(`${device.name} · ${AUTHENTICATORS[product].en}`, `${device.name} · ${AUTHENTICATORS[product].ja}`);
  const url = bw ? ios ? 'https://apps.apple.com/us/app/bitwarden-authenticator/id6497335175' : 'https://play.google.com/store/apps/details?id=com.bitwarden.authenticator' : google ? ios ? 'https://apps.apple.com/app/google-authenticator/id388497605' : 'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2' : 'https://www.microsoft.com/security/mobile-authenticator-app';
  const steps: GuideStep[] = [step('open', c('Open the selected authenticator', '選んだ認証アプリを開く'), place, c(`Install or open the official ${AUTHENTICATORS[product].en}. Check its publisher. Keep existing codes and accounts. ${bw ? 'This is the standalone Authenticator app, separate from Password Manager.' : 'Do not delete or re-register existing accounts.'}`, `正規の${AUTHENTICATORS[product].ja}を入れるか、導入済みのアプリを開いてください。提供元を確かめ、今あるコードやアカウントは残します。${bw ? 'パスワード管理用のBitwardenとは別の、単独の認証アプリです。' : '既存のアカウントを削除・再登録しません。'}`), c('The intended app is open and existing items are preserved.', '正しいアプリが開き、既存の項目も残っていること。'), source, { url, extraControls: [{ targetRef: app.id, controlId: 'opened' }] })];
  const lock = deviceRecipe(device.operatingSystem!).steps.find(s => s.id === 'lock')!;
  const key = `do/${account.id}/authenticator-setup:${app.id}/device-lock`;
  if (!['implemented', 'verified'].includes(device.controls.screenLock) || data.guide.steps[key] || data.guide.cursor === key) steps.push({ ...lock, id: 'device-lock', control: undefined, extraControls: [{ targetRef: device.id, controlId: 'screenLock' }] });
  if (product === 'microsoft-authenticator') steps.push(step('app-lock', c('Check Authenticator App Lock', 'Authenticatorのアプリロックを確認する'), place, c('Open Authenticator Settings and enable App Lock if needed. Close and reopen the app, then confirm it asks for the device PIN or biometrics. This is separate from password autofill, which has ended.', 'Authenticatorの「Settings」で「App Lock」を確認し、必要ならオンにしてください。アプリを閉じて開き直し、端末のPIN・生体認証を求められるか確かめます。終了済みのパスワード自動入力とは別の機能です。'), c('Opening the app requires the configured local authentication.', 'アプリを開くと本人確認が必要になること。'), ['microsoftAuthFaq'], { extraControls: [{ targetRef: app.id, controlId: 'appLock' }] }));
  const storage = google ? app.codeStorage === 'account' ? c('In the profile menu, use the exact Google Account selected in this guide. On a fresh app, sign in to that account. Confirm its codes are synced. If another account or encrypted-data reset is shown, stop and use help; do not delete or switch existing data.', 'プロフィールで、このガイドで選んだGoogle アカウントを確認してください。初回なら、その既存アカウントへログインし、コードを同期する状態か確かめます。別アカウントやデータのリセットが表示された場合は止めて「うまくいかない」へ進み、既存の情報は削除・切り替えしません。') : c('For a fresh app choose Use without an account. For an existing app confirm it is already used without an account. Do not switch a synced app to this mode: that removes cloud codes. If its mode differs, go back and keep its existing storage.', '初回だけ「アカウントなしで使用」を選びます。導入済みなら、すでにアカウントなしで使っているか確認してください。同期中のアプリをこの方式へ切り替えるとクラウド側のコードが削除されるため、切り替えません。方式が違う場合は戻って、今の保存方法を選んでください。') : bw ? c('This guide adds the new code with Save here, outside the Bitwarden vault. Keep existing local and synced codes. No new Bitwarden account is required. Never put the vault’s only verification code inside that same vault.', '今回のコードは「Save here」で、Bitwarden保管庫の外へ保存します。既存のローカル・同期済みコードは残します。新しいBitwardenアカウントは不要です。保管庫自身の唯一の認証コードを、その保管庫へ入れないでください。') : c('This route adds a changing one-time code. It does not set up push approval, passwordless sign-in or work enrollment. Existing backups are retained; backup restoration is checked separately.', 'この経路では、一定時間で変わるコードを追加します。通知の承認・パスワードレス・組織の端末登録とは別です。既存のバックアップは残し、バックアップからの復元は別に確認します。');
  steps.push(step('storage', c('Check how this code will be stored', '今回のコードの保存方法を確認する'), place, storage, c('The chosen mode matches the actual app. Existing codes have not been removed.', '選んだ方式と実際のアプリが一致し、既存のコードも残っていること。'), source, { extraControls: [{ targetRef: app.id, controlId: 'storageChecked' }] }));
  return { id: `authenticator-setup:${app.id}`, title: c('Prepare your authenticator', '認証アプリを使える状態にする'), steps };
}
export function authenticatorScanStep(data: Dataset, account: Asset, original: GuideStep): GuideStep {
  const app = selectedAuthenticator(data, account.id); if (!app) return original;
  const product = app.productId as AuthenticatorProduct, manual = data.guide.answers[`auth:${account.id}:input:${app.id}`] === 'manual';
  const appAction = product==='ente-auth'?manual?c('Tap + → Enter details manually. Fill Issuer, Secret and Account from this official service’s setup information, then Save. Keep default TOTP parameters unless the service explicitly specifies otherwise. Preserve existing entries.','「＋」→「Enter details manually / 手動で詳細を入力する」で、正規サービスの設定情報を「Issuer / 発行者」「Secret / シークレット」「Account / アカウント」へ入れ、「Save / 保存」します。指定がない限りTOTPの詳細は既定のままにし、既存項目を残します。'):c('Tap + → Scan a QR code and scan this exact account’s QR on the other trusted screen. Keep existing entries and confirm the new item belongs to the intended account.','「＋」→「Scan a QR code / QRコードを読み取り」で、別の信頼できる画面にある今回の正しいQRを読み取ります。既存項目を残し、新しい項目が今回のAccountか確認します。'):product === '2fas-auth' ? manual ? c('Tap +, choose manual entry, and enter the service name and the setup key shown by the official service only in 2FAS. Keep TOTP and the default parameters unless the service specifies otherwise. Save the entry and keep existing codes.','「＋」から手入力を選び、正規サービスに表示されたサービス名と設定キーを2FASだけへ入力します。TOTPなどの詳細は、サービスに指定がない限り既定のまま保存し、既存コードも残してください。') : c('Tap + (top right on iOS, bottom right on Android) and scan this exact account’s QR on the other trusted screen. Confirm the new entry belongs to the intended account; keep existing tokens.','「＋」（iOSは右上、Androidは右下）から、別の信頼できる画面にある今回のQRを読み取ります。新しい項目が今回の正しいアカウントか確かめ、既存コードも残してください。') : product === 'bitwarden-authenticator' ? manual ? c('Tap + → Enter key manually. Enter the account name and the setup key shown by the official service. Keep time-based/default parameters unless the service specifies otherwise. Choose Save here, not Save to Bitwarden.', '「＋」→「Enter key manually」で、今回のアカウント名と、正規サービスに表示された手入力用キーを入れます。時間ベースなどの設定は、サービスの指定がない限り既定のままにし、「Save here」を選んでください。「Save to Bitwarden」は選びません。') : c('Tap + and scan the official service’s QR on the other screen. Choose Save here to keep this new code outside Password Manager.', '「＋」から、別の画面にある正規サービスのQRを読み取り、「Save here」で今回のコードをパスワード保管庫の外へ保存してください。') : product === 'google-authenticator' ? manual ? c('Tap + → Enter a setup key. Enter a distinct account name and the setup key from the official service. Use the time-based option and add it. This setup key is not a recovery code or the changing verification code.', '「＋」→「Enter a setup key」（設定キーの入力）で、区別できるアカウント名と正規サービスの手入力用キーを入れ、時間ベースの設定で追加してください。復旧コードや、一定時間で変わる確認コードを入れる操作ではありません。') : c('Tap + → Scan a QR code. Point the camera at this account’s QR on the other screen. Check that the new entry belongs to the exact account.', '「＋」→「Scan a QR code」（QRの読み取り）で、別の画面にある今回のQRを読み取ります。追加された項目が、別の同名アカウントではないことを確認してください。') : manual ? c('Tap + → Other account → Enter code manually. Enter the account name and setup key from the official service. Do not enter a one-use recovery code. Keep existing accounts.', '「＋」→「Other account」→「Enter code manually」で、正規サービスのアカウント名と手入力用キーを入れてください。一回用の復旧コードではありません。既存の項目は残します。') : c(`Tap + → ${account.provider === 'microsoft' ? 'Personal account → Scan a QR Code' : 'Other account'}. Scan this exact account’s QR on the other screen. Approve camera access only for this operation.`, `「＋」→${account.provider === 'microsoft' ? '「Personal account」→「Scan a QR Code」' : '「Other account」'}から、別の画面にある今回のQRを読み取ります。この操作のためのカメラ利用を許可してください。`);
  return { ...original, title: c('Add this account to the selected app', '選んだアプリへ今回のアカウントを追加する'), place: c(AUTHENTICATORS[product].en, AUTHENTICATORS[product].ja), action: appAction, expected: c('A changing code for the exact intended account appears. The service still needs to accept it next.', '今回の正しいアカウントのコードが表示されること。次に、サービス側で受け付けられるか確認します。'), sources: [...new Set([...original.sources, ...authSources(product)])] };
}

export function manualSetupHint(provider: Asset['provider']) {
  if (provider === 'proton') return c('On Proton select Enter key manually instead. The displayed key belongs only in your authenticator’s manual-entry screen.', 'Protonの「Enter key manually instead」を選ぶと、手入力用キーを表示できます。入力先は、認証アプリの手入力画面だけです。');
  if (provider === 'mailcom' || provider === 'gmx') return c('Below the official QR select Copy code, then paste the key only into your authenticator’s manual setup.', '正規のQRの下にある「Copy code」で設定キーを取り出し、認証アプリの手入力画面だけへ貼り付けます。');
}

export function unprotectedAuthenticatorRoot(data: Dataset, accountId: string): Asset | undefined {
  const visited = new Set<string>(); let current = accountId;
  while (!visited.has(current)) {
    visited.add(current);
    const app = selectedAuthenticator(data, current);
    if(!app||app.controls?.storageChecked!=='verified')return;
    const rootId=app.productId==='google-authenticator'&&app.codeStorage==='account'?app.syncAccountRef:app.productId==='2fas-auth'?twofasSyncRoot(data,app.id):undefined;
    const root = data.assets.find(a => a.id === rootId && a.kind === 'account'); if (!root) return;
    if (!['mfa', 'recovery'].every(c => ['implemented', 'verified'].includes(root.controls[c]))) return root;
    current = root.id;
  }
}
export function requireAuthenticatorRoots(data: Dataset, accountId: string, returnTo: string): Dataset {
  const selected=selectedAuthenticator(data,accountId);
  if(selected?.productId==='ente-auth'){const kind=!enteBackupCurrent(data,selected.id)?'backup':selected.codeStorage==='account'&&!enteAccountReady(data,selected.id)?'account':undefined;if(kind){const started=startEnteTask(data,{kind,appRef:selected.id,origin:'guide',accountRef:accountId,returnCursor:returnTo,scopePath:data.guide.answers[`auth:${accountId}:scope`]??'/guide',...(kind==='account'?{rootRef:selected.syncAccountRef}:{})});return setAuthCursor(started.data,`ente/${started.id}`);}}
  if(selected?.productId==='2fas-auth'&&!twofasBackupCurrent(data,selected.id)){const started=startTwofasTask(data,{kind:'backup',appRef:selected.id,origin:'guide',accountRef:accountId,returnCursor:returnTo,scopePath:'/guide'});return setAuthCursor(started.data,`twofas/${started.id}`);}
  const root = unprotectedAuthenticatorRoot(data, accountId), key = `authenticator-root-security/${accountId}`;
  if (root) return setAuthCursor({ ...data, guide: { ...data.guide, answers: { ...data.guide.answers, [`auth:${accountId}:security-return`]: returnTo } } }, key);
  const step = data.guide.steps[key];
  const next = step?.status === 'later' ? { ...data, guide: { ...data.guide, steps: { ...data.guide.steps, [key]: { ...step, status: 'done' as const, updatedAt: new Date().toISOString() } } } } : data;
  return setAuthCursor(next, returnTo);
}

export function twofasSyncRoot(data:Dataset,appRef:string):string|undefined{
  if(data.version!==2)return;const store=twofasStore(data);
  return store?.clouds.filter(c=>c.appRef===appRef&&twofasReceiptCurrent(store,c.receiptRef)&&data.securityModel.relations.some(r=>r.kind==='synced-via'&&r.fromRef===appRef&&r.toRef===c.rootRef&&r.evidence==='user-confirmed'&&twofasLinkCurrent(data.securityModel,r.id))).at(-1)?.rootRef;
}
