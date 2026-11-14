import type { Asset, Dataset, Language, RecoveryDependency } from './models';
import { authenticator, authenticatorReady } from './authenticatorGuide';
import { evaluateAccess, type SecurityEntity } from './securityModel';
import { nordSsoStore } from './nordSsoSchemas';
import { cloudInstallation, cloudManagerReady, cloudVault } from './cloudManagers';

export type MapItem = Asset & { entityKind?: SecurityEntity['kind'] };
export type MapConnection = RecoveryDependency & { typed?: boolean };
export const entityKindLabel = (kind: SecurityEntity['kind'], language: Language) => ({
  session: ['Signed-in session', 'ログイン中の状態'], person: ['Person', '利用者・協力者'], organization: ['Organization', '組織'], installation: ['App on a device', '端末上のアプリ'], vault: ['Password store', 'パスワード保管庫'], credential: ['Authentication or recovery method', '認証・復旧の手段'], identifier: ['Identifier', '識別子'], 'phone-line': ['Phone line', '電話回線'], 'security-key': ['Security key', 'セキュリティキー'], 'data-set': ['Stored data', '保存データ'], grant: ['Access permission', 'アクセス権限'], 'recovery-arrangement': ['Recovery arrangement', '復旧の取り決め'], })[kind][language === 'ja' ? 1 : 0];
export function mapItems(data: Dataset, language: Language): MapItem[] {
  if (data.version !== 2) return data.assets;
  return [...data.assets, ...data.securityModel.entities.filter(e => !((e.kind === 'vault' || e.kind === 'installation') && e.mergedIntoRef)).map((e): MapItem => {
    const installs = e.kind === 'vault' ? data.securityModel.entities.filter(i => i.kind === 'installation' && i.vaultRef === e.id) : [];
    const controls = e.kind === 'vault' ? Object.fromEntries(['opened', 'storageChecked', 'autofill', 'loginUse'].map(c => [c, installs.some(i => i.kind === 'installation' && i.controls?.[c] === 'verified') ? 'verified' as const : 'unknown' as const])) : e.kind === 'installation' ? e.controls ?? {} : {};
    return { id: e.id, name: e.label, entityKind: e.kind, kind: e.kind === 'installation' || e.kind === 'security-key' ? 'device' : e.kind === 'vault' || e.kind === 'data-set' ? 'backup' : 'identity', type: entityKindLabel(e.kind, language), importance: 'important', createdAt: e.createdAt, updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : e.createdAt, controls, controlEvidence: e.kind === 'vault' || e.kind === 'installation' ? e.controlEvidence ?? {} : {}, services: [] };
  })];
}
export function mapConnections(data: Dataset): MapConnection[] {
  if (data.version !== 2) return data.dependencies;
  const known = new Map<string, MapConnection>();
  for (const r of data.securityModel.relations.filter(r => r.evidence === 'user-confirmed')) {
    const key = JSON.stringify([r.fromRef, r.toRef, r.kind]);
    if (!known.has(key)) known.set(key, { id: r.id, assetId: r.toRef, recoveryAssetId: r.fromRef, relation: r.kind, createdAt: r.checkedAt, typed: true });
  }
  return [...data.dependencies, ...known.values()];
}
export function typedMapStatus(data: Dataset, node: MapItem, language: Language) {
  const yes = language === 'ja';
  const entity = data.version === 2 ? data.securityModel.entities.find(e => e.id === node.id) : undefined;
  if(entity&&(entity.kind==='session'||entity.kind==='grant')&&entity.expiresAt&&Date.parse(entity.expiresAt)<=Date.now())return {tone:'needs-work',label:yes?'記録した有効期限を過ぎています':'Recorded expiry has passed',reason:yes?'正規の設定で現在の状態を確認する':'Check the current state in official settings'};
  const app = authenticator(data, node.id);
  if (app) {
    const used = data.version === 2 && app.controls?.codeUse === 'verified' && data.securityModel.routes.some(r => r.purpose === 'second-step' && r.contexts.includes('new-device') && data.securityModel.facts.some(f => f.id === (r.requirements.kind === 'fact' ? r.requirements.factId : '') && f.requiredRefs.includes(app.id)) && evaluateAccess(data.securityModel, r.id, { context: 'new-device', now: new Date().toISOString() }).state === 'available');
    const recorded = used || (authenticatorReady(data, app) && app.controls?.codeAccepted === 'verified');
    return { tone: recorded ? 'recorded' : 'unknown', label: yes ? used ? '新端末でコード利用の記録あり' : recorded ? 'コード登録の記録あり' : 'コードの確認待ち' : used ? 'Code used on new phone' : recorded ? 'Code registration recorded' : 'Code check needed', reason: yes ? used ? '新端末のコードを正規サービスが受け付けた記録' : 'この端末のアプリと、サービス側の登録確認' : used ? 'Official service accepted the new phone’s code' : 'App on this device and service-side registration' };
  }
  if (entity?.kind === 'grant' && entity.nordSsoGrant === 'v1' && data.version === 2 && data.securityModel.revision >= 5) {
    const binding = nordSsoStore(data)?.bindings.find(b => b.id === entity.nordSsoBindingRef), life = data.securityModel.lifecycle[entity.id];
    const revoked = life?.evidence === 'user-confirmed' && ['revoked', 'deleted', 'retired', 'transferred'].includes(life.state);
    const connected = !revoked && binding?.grantRef === entity.id && !!binding.records.connection && data.securityModel.relations.some(r => r.nordSsoEvidence === 'v1' && r.nordSsoBindingRef === binding.id && r.evidence === 'user-confirmed');
    const used = connected && data.securityModel.routes.some(r => r.targetRef === binding?.rootRef && r.requirements.kind === 'fact' && data.securityModel.facts.some(f => f.id === (r.requirements.kind === 'fact' ? r.requirements.factId : '') && f.nordSsoEvidence === 'v1' && f.requiredRefs.includes(entity.id)) && evaluateAccess(data.securityModel, r.id, { context: r.contexts.includes('new-device') ? 'new-device' : 'normal', now: new Date().toISOString() }).state === 'available');
    return { tone: used ? 'recorded' : 'unknown', label: yes ? revoked ? '接続権限の失効を記録' : used ? '接続ログインの利用記録あり' : connected ? '接続済み・ログイン試験は別' : '接続の確認待ち' : revoked ? 'Permission revoked' : used ? 'Connected sign-in used' : connected ? 'Connected; sign-in check separate' : 'Connection unconfirmed', reason: yes ? '実際の提供元・接続先と、設定・利用の記録を区別' : 'Exact provider, destination, configuration and use are separate' };
  }
  if (entity?.kind === 'credential' && entity.nordRecoveryCredential === 'v1' && data.version === 2 && data.securityModel.revision >= 4) {
    const revoked = ['revoked', 'deleted', 'retired', 'transferred'].includes(data.securityModel.lifecycle[entity.id]?.state ?? '');
    const read = entity.credentialType === 'password' && data.securityModel.routes.some(r => r.purpose === 'decrypt' && r.requirements.kind === 'fact' && data.securityModel.facts.some(f => f.id === (r.requirements.kind === 'fact' ? r.requirements.factId : '') && f.nordRecoveryEvidence === 'v1' && f.nordRecoveryPurpose === 'master-read' && f.requiredRefs.includes(entity.id)) && evaluateAccess(data.securityModel, r.id, { context: 'normal', now: new Date().toISOString() }).state === 'available');
    const copied = !revoked && entity.credentialType === 'recovery-code' && data.securityModel.facts.some(f => f.nordRecoveryEvidence === 'v1' && f.nordRecoveryPurpose === 'code-copy' && f.requiredRefs.includes(entity.id) && f.state === 'available' && f.evidence === 'user-confirmed');
    return { tone: read || copied ? 'recorded' : 'unknown', label: yes ? revoked ? '無効化した手段' : read ? '新マスターの利用記録あり' : copied ? '控えの記録あり・復旧試験は別' : '確認待ち' : revoked ? 'Revoked method' : read ? 'New master used' : copied ? 'Copy recorded; recovery test separate' : 'Unconfirmed', reason: yes ? '実際の値は保存せず、作業と現在の失効状態を区別' : 'No secret stored; work records and revocation are separate' };
  }
  if (entity?.kind === 'credential' && entity.protonPassExtraCredential === 'v1' && typeof entity.protonPassExtraAccount === 'string' && data.version === 2) {
    const used = data.securityModel.routes.some(r => r.purpose === 'sign-in' && r.requirements.kind === 'fact' && data.securityModel.facts.some(f => f.id === (r.requirements.kind === 'fact' ? r.requirements.factId : '') && f.protonPassExtraEvidence === 'v1' && f.requiredRefs.includes(entity.id)) && evaluateAccess(data.securityModel, r.id, { context: 'normal', now: new Date().toISOString() }).state === 'available');
    return { tone: used ? 'recorded' : 'unknown', label: yes ? used ? '追加パスワードの利用記録あり' : '追加パスワードの利用は未確認' : used ? 'Extra-password use recorded' : 'Extra-password use unconfirmed', reason: yes ? '設定・紙の控えと、新しいログインでの利用は別の確認' : 'Configuration, paper copy and fresh sign-in are separate checks' };
  }
  if (entity?.kind === 'installation' || entity?.kind === 'vault') {
    const cloud = cloudVault(data, entity.kind === 'installation' ? entity.vaultRef : entity.id);
    if (cloud && data.version === 2) {
      const apps = entity.kind === 'installation' ? [cloudInstallation(data, entity.id)!] : data.securityModel.entities.filter(e => e.kind === 'installation' && !e.mergedIntoRef && e.vaultRef === cloud.id);
      const ready = apps.some(app => !!app && cloudManagerReady(data, cloud.id, app.id));
      const used = apps.some(app => !!app && cloudManagerReady(data, cloud.id, app.id) && data.securityModel.routes.some(r => r.purpose === 'sign-in' && (r.contexts.includes('normal') || r.contexts.includes('new-device')) && data.securityModel.facts.some(f => f.id === (r.requirements.kind === 'fact' ? r.requirements.factId : '') && f.requiredRefs.includes(app.id) && f.requiredRefs.includes(cloud.id) && f.id === `${f.observationActionId}:cloud:password-use` && data.securityModel.entities.some(e => e.kind === 'credential' && e.cloudObservationOwner === f.observationActionId && f.requiredRefs.includes(e.id))) && evaluateAccess(data.securityModel, r.id, { context: r.contexts.includes('new-device') ? 'new-device' : 'normal', now: new Date().toISOString() }).state === 'available'));
      return { tone: used ? 'recorded' : 'unknown', label: yes ? used ? '保存パスワードの利用記録あり' : ready ? '保存パスワードの利用待ち' : '設定と復旧の確認待ち' : used ? 'Saved-password use recorded' : ready ? 'Saved-password use needed' : 'Setup and recovery checks needed', reason: yes ? 'この端末・プロファイルと基盤アカウントの記録を確認' : 'Checks for this app/profile and its backing account' };
    }
    const required = ['opened', 'storageChecked', 'autofill', 'loginUse'];
    const completeOnOneDevice = entity.kind === 'vault' && data.version === 2 ? data.securityModel.entities.some(e => e.kind === 'installation' && e.vaultRef === entity.id && required.every(c => e.controls?.[c] === 'verified')) : required.every(c => node.controls[c] === 'verified');
    const missing = completeOnOneDevice ? [] : required.filter(c => node.controls[c] !== 'verified').concat(['device-context']);
    return { tone: missing.length ? 'unknown' : 'recorded', label: yes ? missing.length ? '利用確認待ち' : '利用の記録あり' : missing.length ? 'Use check needed' : 'Use recorded', reason: yes ? entity.kind === 'vault' ? missing.length ? 'アプリと保存情報の利用を確認する' : '少なくとも1台で利用を確認した記録' : missing.length ? 'この端末での設定・ログインを確認する' : 'この端末で保存情報を利用した記録' : entity.kind === 'vault' ? 'Checks for at least one device; see each app separately' : 'Checks for this device only' };
  }
  const confirmed = data.version === 2 && data.securityModel.relations.some(r => (r.fromRef === node.id || r.toRef === node.id) && r.evidence === 'user-confirmed');
  return { tone: confirmed ? 'recorded' : 'unknown', label: yes ? confirmed ? 'つながりの記録あり' : '関係は未確認' : confirmed ? 'Connection recorded' : 'Connection unconfirmed', reason: node.type };
}


export function mapAffectedItems(data: Dataset, missing: string, language: Language): MapItem[] {
  const affected = new Set([missing]);
  let changed = true;
  while (changed) { changed = false; for (const d of data.dependencies) if (affected.has(d.recoveryAssetId) && !affected.has(d.assetId)) { affected.add(d.assetId); changed = true; } }
  if (data.version === 2) {
    const reverse = new Set(['installed-on','stored-in','synced-via','restores-from']);
    const forward = new Set(['authenticates-to','unlocks','decrypts','session-for','grants-access-to','delegated-to','recovers','requires-for-restore','backs-up','hosts','routes','manages-domain']);
    let expanded=true;
    while(expanded){expanded=false;for(const relation of data.securityModel.relations){if(relation.evidence!=='user-confirmed')continue;const from=reverse.has(relation.kind)?relation.toRef:relation.fromRef,to=reverse.has(relation.kind)?relation.fromRef:relation.toRef;if((reverse.has(relation.kind)||forward.has(relation.kind))&&affected.has(from)&&!affected.has(to)){affected.add(to);expanded=true;}}for(const edge of data.dependencies)if(affected.has(edge.recoveryAssetId)&&!affected.has(edge.assetId)){affected.add(edge.assetId);expanded=true;}}
    const now = new Date().toISOString();
    for (const r of data.securityModel.routes) {
      const context = r.contexts.includes('enrollment') ? 'enrollment' : r.contexts.includes('new-device') ? 'new-device' : 'normal';
      const before = evaluateAccess(data.securityModel, r.id, { context, now });
      const after = evaluateAccess(data.securityModel, r.id, { context, now, unavailableRefs: [missing] });
      if (before.state === 'available' && after.state !== 'available') affected.add(r.targetRef);
    }
  }
  return mapItems(data, language).filter(a => a.id !== missing && affected.has(a.id));
}

export function mapRelationLabel(language: Language, kind: string): string {
  const labels: Record<string, [string, string]> = {
    authentication: ['Authenticates', '認証に使う'], 'recovery-email': ['Recovery email', '復旧用メール'], backup: ['Backup destination', 'バックアップ先'], 'offline-recovery': ['Independent recovery', '独立した復旧手段'],
    owns: ['Owns', '所有する'], administers: ['Administers', '管理する'], 'installed-on': ['App on this device', 'この端末上のアプリ'], identifies: ['Identifies', '識別に使う'], 'authenticates-to': ['Used to sign in', 'ログインに使う'], unlocks: ['Opens this store', 'この保管庫を開く'], decrypts: ['Decrypts', '暗号化を解除する'], 'stored-in': ['Stored in', '保存先'], 'synced-via': ['Synchronization account', '同期に使うアカウント'], 'session-for': ['Signed-in session', 'ログイン済みの状態'], 'grants-access-to': ['Permits access', 'アクセスを許可する'], 'delegated-to': ['Delegated to', '操作を委任する'], 'shared-with': ['Shared with', '共有する'], recovers: ['Helps recover', '復旧に使う'], 'requires-for-restore': ['Needed for restoration', '復元に必要'], 'backs-up': ['Backs up', 'バックアップする'], 'restores-from': ['Restored from', '復元元'], hosts: ['Hosts', '保存・提供する'], routes: ['Routes', '届け先へつなぐ'], 'manages-domain': ['Manages domain', 'ドメインを管理する'], replaces: ['Replaces', '置き換える'],
  };
  return labels[kind]?.[language === 'ja' ? 1 : 0] ?? (language === 'ja' ? '記録された関係' : 'Recorded connection');
}
