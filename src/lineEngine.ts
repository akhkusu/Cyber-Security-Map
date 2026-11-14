import {canBeMailAccount} from './accountRoles';
import {PROVIDERS} from './guideCatalog';
import type { Dataset, CurrentDataset, Language } from './models';
import { makeAsset } from './models';
import { securityEntitySchema } from './securityModel';
import { currentLineStep, lineSteps, lineCanStartTransfer, type LineStep } from './lineCatalog';
import { LINE_SOURCES } from './lineSources';
import { applyLineCutover, createLineAccount, lineStoreFor, putLineStore, updateLineTask, recordLineSource, recordLineUse, putLineEntity, lineLink, lineAccountCandidate, ensureLineApp } from './lineData';
import { lineTask, lineRecorded, lineMoveReady, lineDeviceContextCurrent, type LineTask, type LineReceipt } from './lineSchemas';
import {lineAccessProfile,lineAccessRefs,lineKeyOperation,lineAccessStore} from './lineAccessSchemas';
import {lineAccessPrerequisites} from './lineAccessCatalog';
import {selectLineKeyStore,selectLineKeyRoot,requestLineKey,settleLineKey,observeLineKey,recordLineKeyStore,resetLineAccessSelection,updateLineAccess} from './lineAccessData';

const taskRefs = (t: LineTask, data?:CurrentDataset) => [...new Set([t.oldDeviceRef, t.newDeviceRef, t.accountRef, t.recoveryMailRef, t.sourceAppRef, t.sourceSessionRef, t.destinationAppRef, t.destinationSessionRef, t.dataRef, t.backupRef,...(data?lineAccessRefs(data,t):[])].filter((r): r is string => !!r))];
function revoke(data: CurrentDataset, t: LineTask, ids: string[], at: string) {
  const s = lineStoreFor(data), revoked = new Set(ids); let changed = true;
  while (changed) { changed = false; for (const r of s.receipts) if (r.taskRef === t.id && !revoked.has(r.id) && r.requires.some(id => revoked.has(id))) { revoked.add(r.id); changed = true; } }
  const records = Object.fromEntries(Object.entries(t.records).filter(([, id]) => !revoked.has(id)));
  t = { ...t, records, status: 'active', updatedAt: at };
  return { data: updateLineTask(putLineStore(data, { ...s, receipts: s.receipts.map(r => revoked.has(r.id) ? { ...r, revokedAt: r.revokedAt ?? at } : r) }), t), task: t };
}
function advance(data: CurrentDataset, t: LineTask, previous: string, at: string) {
  const steps = lineSteps(data, t), index = steps.findIndex(s => s.id === previous);
  const next = steps.slice(index+1).find(s=>!['question','action'].includes(s.kind)||!lineRecorded(data,t,s.id)) ?? steps.at(-1);
  return updateLineTask(data, { ...t, cursor: next?.id ?? '', history: previous === next?.id ? t.history : [...t.history, previous], updatedAt: at, status: 'active' });
}
function prerequisites(data: CurrentDataset, t: LineTask, s: LineStep):LineStep[] {
  const steps=lineSteps(data,t),available=new Map(steps.map(v=>[v.id,v])),id=s.id,post=s.phase==='use';
  const identity=post?[]:['account'],source=t.answers['destination-state']==='same'?[]:['source-account'];
  const access=lineAccessProfile(data,t.id)?lineAccessPrerequisites(t,s,steps):undefined;
  let keys:string[]=[];
  if(access)keys=access;
  else if(id==='account'||id==='cutover-result')keys=[];
  else if(id==='previous-app')keys=['account','destination-state'];
  else if(id==='source-account')keys=['account','source-app','source-state'];
  else if(id==='source-state')keys=['account','source-app'];
  else if(id==='destination-state'||id==='new-version'||id==='source-app'||id==='version')keys=['account'];
  else if(id.endsWith('access-home'))keys=post?['new-account']:['account',...source];
  else if(id.endsWith('access-settings'))keys=[id.replace('settings','home')];
  else if(id.endsWith('access-account'))keys=[id.replace('account','settings')];
  else if(id==='recovery-email')keys=[post?'current-access-account':'access-account'];
  else if(id==='recovery-mail')keys=['recovery-email'];
  else if(id==='recovery-provider')keys=['recovery-mail'];
  else if(id==='password-access')keys=[post?'current-access-account':'access-account'];
  else if(id==='future-access')keys=['recovery-email','recovery-mail','recovery-provider','password-access'];
  else if(id==='history')keys=post?['cutover-result']:['account'];
  else if(id==='coverage')keys=['history'];
  else if(id==='premium-state')keys=['history'];
  else if(id==='backup-home')keys=['account',...source];
  else if(id==='backup-settings')keys=['backup-home'];
  else if(id==='backup-open')keys=['backup-settings'];
  else if(id==='backup-account')keys=['backup-open'];
  else if(id.startsWith('backup-ios-')){
    const order=['backup-ios-settings','backup-ios-name','backup-cloud','backup-ios-icloud','backup-ios-capacity','backup-ios-drive','backup-ios-sync','backup-ios-return'],index=order.indexOf(id);
    keys=index>0?[order[index-1]]:['backup-account'];
  }else if(id==='backup-cloud')keys=['backup-account',...(data.assets.find(a=>a.id===t.oldDeviceRef)?.operatingSystem==='ios'?['backup-ios-name']:[])];
  else if(id==='pin-state')keys=['backup-cloud','backup-ios-return'];
  else if(id==='pin-create')keys=['pin-state'];
  else if(id==='backup-run')keys=['pin-state','pin-create','backup-account'];
  else if(id==='backup-result')keys=['coverage',...source,...(t.answers.history==='recent'||t.answers.history==='none'?[]:t.answers['premium-state']==='using'?['backup-open','premium-state']:['backup-run'])];
  else if(id==='transfer-ready')keys=steps.filter(v=>v.id!==id&&['question','action'].includes(v.kind)).map(v=>v.id);
  else if(id==='transfer-method')keys=['future-access','backup-result'];
  else if(id.startsWith('key-move:')){const prior=steps.slice(0,steps.findIndex(v=>v.id===id)).filter(v=>v.id.startsWith('key-move:'));keys=prior.length?[prior.at(-1)!.id]:['transfer-method','backup-result'];}
  else if(id.startsWith('key-login:')){const prior=steps.slice(0,steps.findIndex(v=>v.id===id)).filter(v=>v.id.startsWith('key-login:'));keys=id==='key-login:result'&&t.answers['key-login:already-operated']==='yes'?[]:prior.length?[prior.at(-1)!.id]:[];}
  else if(id==='native-login')keys=[];
  else if(id.startsWith('restore-screen:')){const n=Number(id.split(':')[1]);keys=n?['cutover-result',`restore-operation:${n-1}`]:['cutover-result','history'];}
  else if(id.startsWith('restore-operation:'))keys=[`restore-screen:${id.split(':')[1]}`];
  else if(id==='restore-omit')keys=['cutover-result','history'];
  else if(id==='new-account')keys=['cutover-result','previous-app',...(t.cutover?.passkeyBinding?['key-login:result']:[]),...(t.answers['cutover-result']==='restore'?steps.filter(v=>v.id.startsWith('restore-screen:')&&t.answers[v.id]==='home').map(v=>v.id):[])];
  else if(id==='data-read')keys=['new-account','history'];
  else if(id==='number-changed')keys=['new-account'];
  else if(id==='old-session')keys=['new-account','data-read','number-changed'];
  else if(id==='new-login')keys=['account','destination-state','new-version'];
  else if(id==='new-role')keys=['new-login'];
  else if(id==='new-qr')keys=['new-login','new-role'];
  else if(id==='new-scan')keys=['new-qr'];
  else if(id==='qr-old-home')keys=['backup-result'];
  else if(id==='qr-old-settings')keys=['qr-old-home'];
  else if(id==='qr-old-display')keys=['qr-old-settings','backup-result','future-access'];
  else if(id==='qr-scan')keys=['qr-old-display','new-scan'];
  else if(id==='qr-approve')keys=['qr-scan'];
  else if(id==='qr-unlock')keys=['qr-approve'];
  else if(id==='destination-match')keys=['qr-unlock'];
  else keys=identity;
  return [...new Set(keys)].flatMap(key=>{const v=available.get(key);return v?[v]:[];});
}
export function lineStepMissing(data: Dataset, t: LineTask, s: LineStep) {
  if (data.version !== 2) return [];
  if (!lineDeviceContextCurrent(data,t)) return [{ id:'context-changed', kind:'blocked' as const, title:{en:'The recorded phone OS changed. Reopen the current phone-change task.',ja:'記録した端末のOSが変わっています。現在の機種変更から開き直してください。'},sources:[],phase:s.phase }];
  const operation=lineKeyOperation(data,t.id);
  if(operation?.phase==='requested'&&['account','source-app','destination-state','access2:method','access2:store','access2:key-root','access2:key-state'].includes(s.id))return [{id:'access2:key-result',kind:'question' as const,title:{en:'Check the current passkey creation result first',ja:'先にパスキー作成の現在の結果を確認する'},sources:['linePasskey'],phase:s.phase}];
  if(s.effect==='key-request'){
    const actor=s.phase==='use'||t.answers['destination-state']==='same'?t.newDeviceRef:t.oldDeviceRef,p=lineAccessProfile(data,t.id);
    if(lineAccessStore(data)?.operations.some(o=>o.lineTaskRef===t.id&&o.accountRef===t.accountRef&&o.deviceRef===actor&&o.phase==='registered'&&o.storeRef!==p?.storeRef))return [{id:'access2:key-state',kind:'question' as const,title:{en:'Identify the existing key before creating another',ja:'新しく作る前に、既存の鍵を確認する'},sources:['linePasskey'],phase:s.phase}];
  }
  const actors=[t.accountRef,s.phase==='use'||t.answers['destination-state']==='same'?t.newDeviceRef:t.oldDeviceRef,...(!t.cutover&&t.answers['destination-state']!=='same'&&s.id!=='source-account'?[t.sourceSessionRef]:[])].filter((r):r is string=>!!r);
  if(s.id.startsWith('access2:key-')||s.id.startsWith('key-login:')||s.id==='future-access'||s.id==='transfer-ready')actors.push(...lineAccessRefs(data,t));
  if(s.id.startsWith('access2:key-new-')||s.id.startsWith('access2:new-root'))actors.push(...(t.newDeviceRef?[t.newDeviceRef]:[]));
  const unavailable=[...new Set(actors)].filter(ref=>['lost','unavailable','revoked','deleted','retired','transferred'].includes(data.securityModel.lifecycle[ref]?.state??''));
  return [...prerequisites(data, t, s).filter(v => !lineRecorded(data, t, v.id)),...unavailable.map(ref=>({id:`actor:${ref}`,kind:'blocked' as const,title:{en:'A required account or device is unavailable',ja:'必要なアカウント・端末が利用不能の記録になっています'},sources:[],phase:s.phase}))];
}
function receipt(data: CurrentDataset, t: LineTask, step: LineStep, at: string) {
  const existing = t.records[step.id];
  if (existing && lineRecorded(data, t, step.id)) return { data, task: t, record: lineStoreFor(data).receipts.find(r => r.id === existing)! };
  const r: LineReceipt = { id: crypto.randomUUID(), taskRef: t.id, stepId: step.id, at, requires: prerequisites(data, t, step).map(v => t.records[v.id]).filter(Boolean), refs: taskRefs(t,data), titleEn: step.title.en, titleJa: step.title.ja };
  t = { ...t, records: { ...t.records, [step.id]: r.id }, updatedAt: at };
  const s = lineStoreFor(data);
  return { data: updateLineTask(putLineStore(data, { ...s, receipts: [...s.receipts, r] }), t), task: t, record: r };
}
export function answerLine(data: Dataset, taskRef: string, value: string, at = new Date().toISOString()): Dataset {
  if (data.version !== 2) return data;
  let t = lineTask(data, taskRef); if (!t) return data;
  const step = currentLineStep(data, t); if (step.kind !== 'question' || !step.choices?.some(c => c.value === value) || lineStepMissing(data, t, step).length) return data;
  let next = data;
  if(step.id==='source-app' && t.sourceAppRef && value!==`app:${t.sourceAppRef}`){
    const result=revoke(next,t,['source-account','source-state','version'].map(id=>t!.records[id]).filter(Boolean),at);next=result.data;t={...result.task,sourceAppRef:undefined,sourceSessionRef:undefined,backupRef:undefined,dataRef:undefined};
  }
  if (t.answers[step.id] && t.answers[step.id] !== value) {
    const result = revoke(next, t, t.records[step.id]?[t.records[step.id]]:[], at);next=result.data;t=result.task;
    t={...t,answers:{...t.answers,[step.id]:''}};
    if(step.id==='account'){const answers={...t.answers};delete answers['source-app'];for(const key of Object.keys(answers))if(key.startsWith('access2:'))delete answers[key];t={...t,answers,recoveryMailRef:undefined};next=resetLineAccessSelection(next,t);}
    if(step.id==='access2:method'&&!t.cutover){const answers={...t.answers};delete answers['transfer-method'];t={...t,answers};}
    if (['history','backup-account','premium-state'].includes(step.id))t={...t,backupRef:undefined,...(step.id==='history'?{dataRef:undefined}:{})};
    if (step.id === 'account') t = { ...t, accountRef: undefined, sourceAppRef: undefined, sourceSessionRef: undefined, dataRef: undefined, backupRef: undefined };
  }
  if (step.id === 'account') {
    if (value === 'add') { const result = createLineAccount(next, at); next = result.data; value = `account:${result.id}`; }
    const accountRef = value.slice('account:'.length);
    const account=next.assets.find(a=>a.id===accountRef&&a.kind==='account');
    if(!account || !lineAccountCandidate(next,account))return data;
    if(account.provider!=='line')next={...next,assets:next.assets.map(a=>a.id===accountRef?{...a,provider:'line',type:'Messaging',updatedAt:at}:a)};
    t = { ...t, accountRef };
  }
  if(step.id==='previous-app'&&value.startsWith('app:')){
    const app=ensureLineApp(next,t.oldDeviceRef,t.accountRef!,value.slice(4),at);next=app.data;t={...t,sourceAppRef:app.appRef};
  }
  if(['recovery-mail','access2:mail-account'].includes(step.id)&&value.startsWith('account:')){const id=value.slice(8),mail=next.assets.find(a=>a.id===id);if(!mail||!canBeMailAccount(mail))return data;t={...t,recoveryMailRef:id};}
  if(['recovery-mail','access2:mail-account'].includes(step.id)&&value==='add'&&t.answers[step.id]!==value)t={...t,recoveryMailRef:undefined};
  if(['recovery-provider','access2:mail-provider'].includes(step.id)&&(!t.recoveryMailRef||t.answers[step.id]!==value)){
    const provider=value as NonNullable<CurrentDataset['assets'][number]['provider']>,mail={...makeAsset({kind:'account',type:'Primary email',name:`${PROVIDERS[provider]} ${next.assets.filter(a=>a.provider===provider).length+1}`,importance:'critical'}),provider,purpose:'personal' as const,services:['mail' as const],createdAt:at,updatedAt:at};next={...next,assets:[...next.assets,mail]};t={...t,recoveryMailRef:mail.id};
  }
  if(step.id==='access2:store'&&(!lineAccessProfile(next,t.id)?.storeRef||t.answers[step.id]!==value))next=selectLineKeyStore(next,t,value);
  if(step.id==='access2:key-root'&&(!lineAccessProfile(next,t.id)?.storeRef||t.answers[step.id]!==value))next=selectLineKeyRoot(next,t,value,at);
  if(step.id==='access2:key-record'){
    const p=lineAccessProfile(next,t.id)!;
    if(value==='add'&&t.answers[step.id]!==value)next=updateLineAccess(next,{...p,keyRef:undefined});
    else if(value.startsWith('key:')){const key=next.securityModel.entities.find(e=>e.id===value.slice(4)&&e.kind==='credential'&&e.credentialType==='passkey'&&e.subjectRef===t!.accountRef&&e.storageRef===p.storeRef);if(!key)return data;next=updateLineAccess(next,{...p,keyRef:key.id});}
  }
  if(step.id==='access2:key-result'&&['registered','cancelled'].includes(value))next=settleLineKey(next,t,value as 'registered'|'cancelled',at);
  if (step.id === 'backup-account' && value.startsWith('add:')) {
    const provider = value === 'add:apple' ? 'apple' : 'google', a = { ...makeAsset({ kind: 'account', type: 'Identity provider', name: `${provider === 'apple' ? 'Apple Account' : 'Google Account'} ${next.assets.filter(v => v.provider === provider).length + 1}`, importance: 'critical' }), provider: provider as 'apple' | 'google', purpose: 'personal' as const, createdAt: at, updatedAt: at };
    next = { ...next, assets: [...next.assets, a] }; value = `account:${a.id}`;
  }
  t = { ...t, answers: { ...t.answers, [step.id]: value }, cursor: step.id }; next = updateLineTask(next, t);
  const r = receipt(next, t, step, at); return advance(r.data, r.task, step.id, at);
}
export function confirmLine(data: Dataset, taskRef: string, at = new Date().toISOString()): Dataset {
  if (data.version !== 2) return data; let t = lineTask(data, taskRef); if (!t) return data;
  const step = currentLineStep(data, t); if (step.kind !== 'action' || lineStepMissing(data, t, step).length) return data;
  if (step.effect === 'request' && !lineCanStartTransfer(data, t)) return data;
  if(lineRecorded(data,t,step.id))return advance(data,t,step.id,at);
  let next = data;
  const saved = receipt(next, t, step, at); next = saved.data; t = saved.task; const r = saved.record;
  if(step.id==='future-access'&&t.recoveryMailRef&&t.accountRef)next=lineLink(next,r,t.recoveryMailRef,t.accountRef,'recovers',['lineAccount']);
  if (step.effect === 'source') { const source = recordLineSource(next, t, r); next = source.data; t = source.task; }
  const accessActor=step.phase==='use'||t.answers['destination-state']==='same'?t.newDeviceRef!:t.oldDeviceRef;
  if(step.effect==='key-request')next=requestLineKey(next,t,at,accessActor);
  if(step.effect==='key-observed'){next=recordLineKeyStore(next,t,r,accessActor,accessActor===t.newDeviceRef);next=observeLineKey(next,t,r);}
  if(step.effect==='key-new-store')next=recordLineKeyStore(next,t,r,t.newDeviceRef!,true);
  if (step.effect === 'backup' || step.effect === 'request' || step.effect==='read') {
    if (!t.dataRef && t.answers.history !== 'none') {
      const entity = securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'data-set', dataType: 'messages', ownerRef: t.accountRef, label: next.settings.language==='ja' ? `LINE · ${t.answers.history==='recent'?'直近14日分の履歴':'選んだトーク履歴'}` : `LINE · ${t.answers.history==='recent'?'selected last 14 days':'selected chat history'}`, createdAt: at });
      next = putLineEntity(next, entity); t = { ...t, dataRef: entity.id }; next = updateLineTask(next, t);
    }
    const selectedTask = t;
    const mode = selectedTask.answers.history === 'recent' || t.answers.history === 'none' ? 'qr' : next.assets.find(d => d.id === selectedTask.oldDeviceRef)?.operatingSystem === next.assets.find(d => d.id === selectedTask.newDeviceRef)?.operatingSystem && t.answers.history === 'text' ? 'standard' : 'premium';
    if (step.effect === 'backup' && mode !== 'qr' && !t.backupRef) {
      const backup = securityEntitySchema.parse({ id: crypto.randomUUID(), kind: 'data-set', dataType: 'messages', ownerRef: t.accountRef, label: next.settings.language==='ja'?`LINE · ${mode==='standard'?'文章のバックアップ':'プレミアムバックアップ'}`:`LINE · ${mode==='standard'?'Standard Backup (text)':'Premium Backup'}`, createdAt: at });
      next = putLineEntity(next, backup); t = { ...t, backupRef: backup.id }; next = updateLineTask(next, t);
      next = lineLink(next, r, backup.id, t.dataRef!, 'backs-up', [mode === 'standard' ? 'lineBackup' : 'linePremium']);
      const root = t.answers['backup-account']?.startsWith('account:') ? t.answers['backup-account'].slice(8) : undefined;
      if (mode === 'standard' && root) next = lineLink(next, r, backup.id, root, 'stored-in', ['lineBackup']);
    }
  }
  if (step.effect === 'request') {
    const p=lineAccessProfile(next,t.id);t = { ...t, cutover: { phase: 'requested', requestedAt: at, epoch: crypto.randomUUID(),...(t.answers['transfer-method']==='passkey'&&p?.keyRef&&p.storeRef&&p.rootRef&&p.newStoreAppRef?{passkeyBinding:{keyRef:p.keyRef,storeRef:p.storeRef,rootRef:p.rootRef,appRef:p.newStoreAppRef}}:{}) } }; next = updateLineTask(next, t);
  }
  if (step.effect === 'sign-in') { const applied = applyLineCutover(next, t, at); next = applied.data; t = applied.task; next = recordLineUse(next, t, r, 'sign-in'); }
  if (step.effect === 'read' && t.answers.history !== 'none') next = recordLineUse(next, t, r, 'read');
  const s = lineStoreFor(next); next = putLineStore(next, { ...s, receipts: s.receipts.map(v => v.id === r.id ? { ...v, refs: taskRefs(t,next) } : v) });
  return advance(next, t, step.id, at);
}
export function backLine(data: Dataset, taskRef: string): Dataset {
  if (data.version !== 2) return data; const t = lineTask(data, taskRef); if (!t) return data;
  const legal = new Set(lineSteps(data, t).map(s => s.id)), history = [...t.history]; let cursor: string | undefined;
  while (history.length && !cursor) { const previous = history.pop()!; if (legal.has(previous)) cursor = previous; }
  return cursor ? updateLineTask(data, { ...t, cursor, history }) : data;
}
export function jumpLine(data: Dataset, taskRef: string, cursor: string): Dataset {
  if (data.version !== 2) return data; const t = lineTask(data, taskRef); if (!t || !lineSteps(data, t).some(s => s.id === cursor)) return data;
  return updateLineTask(data, { ...t, cursor, history: [...t.history, t.cursor] });
}
export function undoLineReceipt(data: Dataset, taskRef: string, receiptRef: string, at = new Date().toISOString()): Dataset {
  if (data.version !== 2) return data; const t = lineTask(data, taskRef); if (!t || !Object.values(t.records).includes(receiptRef)) return data;
  const result = revoke(data, t, [receiptRef], at), step = currentLineStep(result.data, result.task);
  // The actual main-device switch and old-session revocation survive correction.
  return updateLineTask(result.data, { ...result.task, cursor: t.cutover ? 'cutover-result' : step.id, history: [] });
}
export function deferLine(data: Dataset, taskRef: string): Dataset {
  if (data.version !== 2) return data; const t = lineTask(data, taskRef); return t ? updateLineTask(data, { ...t, status: 'deferred' }) : data;
}
export function finishLine(data: Dataset, taskRef: string): Dataset {
  if (data.version !== 2) return data; const t = lineTask(data, taskRef);
  return t && lineMoveReady(data, t) ? updateLineTask(data, { ...t, status: 'completed', cursor: 'finished' }) : data;
}
export function lineHelpPrompt(data: Dataset, taskRef: string, problem: number, language: Language): string {
  const t = lineTask(data, taskRef); if (!t || data.version !== 2) return '';
  const safe: CurrentDataset = { ...data, assets: data.assets.map(a => ({ ...a, name: a.kind === 'device' ? a.operatingSystem === 'ios' ? 'iPhone' : 'Android phone' : a.provider === 'line' ? 'Selected LINE account' : 'Selected cloud account' })), securityModel: { ...data.securityModel, entities: data.securityModel.entities.map(e => ({ ...e, label: 'Selected app or security item' })) } };
  const step = currentLineStep(safe, t), os = (id?: string) => data.assets.find(a => a.id === id)?.operatingSystem === 'ios' ? 'iOS' : data.assets.find(a => a.id === id)?.operatingSystem === 'android' ? 'Android' : 'unconfirmed';
  const problems = language === 'ja' ? ['画面が違う', '項目が見つからない', '権限がない', 'データ・復旧手段が使えない', '対応する手順がない'] : ['The screen differs', 'The item is missing', 'Permission is missing', 'Data or recovery is unavailable', 'No supported recipe'];
  return [language === 'ja' ? '最新の公式情報を確認し、一度に一つの質問または操作を案内してください。最新情報を確認できない場合は明示してください。既存のLINEアカウントとバックアップを保持し、切替を繰り返させないでください。パスワード・PIN・QR・認証番号・会話・個人情報は求めないでください。' : 'Check current official information and guide one question or action at a time. State if you cannot verify current information. Preserve the existing LINE account and backups; do not repeat a main-device switch. Do not request passwords, PINs, QR codes, authentication codes, chats or personal details.',
    'Service: LINE', `Passkey capability: ${t.answers['access2:key-version']==='supported'?'user reports LINE26.17+':'unconfirmed'}`, `Passkey creation state: ${lineKeyOperation(data,t.id)?.phase??'none'}`, `Prepared method: ${['password','passkey'].includes(t.answers['access2:method'])?t.answers['access2:method']:'legacy / unconfirmed'}`, `Transfer method: ${t.cutover?.passkeyBinding?'passkey':'QR / already-used / unconfirmed'}`, `OS: ${os(t.oldDeviceRef)} → ${os(t.newDeviceRef)}`, `Version: ${t.answers.version === 'current' ? 'user reports current app on iOS18+ / Android11+' : 'unconfirmed'}`, `Task: ${t.cutover ? 'Check main-device transfer and selected data' : 'Prepare existing LINE for phone change'}`, `Step: ${step.title[language]}`, `Expected: ${step.expected?.[language] ?? step.text?.[language] ?? 'A supported route'}`, `Problem: ${problems[problem] ?? problems[0]}`, 'Official sources:', ...step.sources.map(s => LINE_SOURCES[s]?.url).filter(Boolean)].join('\n');
}
