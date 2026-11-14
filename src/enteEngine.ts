import { makeAsset, type CurrentDataset, type Dataset, type Language } from './models';
import { enteSteps, enteTargets, enteApp, type EnteStep } from './enteCatalog';
import { enteStore, enteParentTask, entePrepared, enteBackupCurrent, enteConfiguration, enteLock, enteReceiptCurrent, enteSnapshot, enteFactCurrent, entePasswordPending, type EnteTask, type EnteReceipt } from './enteSchemas';
import { prepareEntePassword, requestEntePassword, applyEntePassword, requestEnteFactorRecovery, confirmEnteFactorRecovery, recordEnteRecoveryRead, enteRecoveryRoot } from './enteRecoveryData';
import { enteTask, startEnteTask, putEnteTask, putEnteStore, putEnteEntity, createEnteApp, createEnteRoot, appendEnteReceipt, withdrawEnteReceipt, recordEnteControl, recordEnteLink, recordEnteStorage, recordEnteLock, makeEnteSecret, recordEnteRootSecret, saveEnteFile, copyEnteFile, confirmEnteExternalFile, recordEnteProof } from './enteData';
import { securityEntitySchema, evaluateAccess } from './securityModel';
import { PHONE_SOURCES } from './phoneCatalog';
import { SOURCES, PROVIDERS } from './guideCatalog';
const nowString=()=>new Date().toISOString();
export { enteTask } from './enteData';
const stepAppRef=(data:Dataset,t:EnteTask,s:EnteStep)=>s.appRef??s.refs.find(ref=>!!enteApp(data,ref))??(['move','restore'].includes(t.kind)&&t.destinationRef?t.destinationRef:t.appRef);
const available=(data:CurrentDataset,ref:string)=>!['lost','unavailable','revoked','deleted','transferred','retired'].includes(data.securityModel.lifecycle[ref]?.state??'');
export function enteStepRecorded(data:Dataset,t:EnteTask,stepId:string):boolean{
  if(data.version!==2)return false;const s=enteStore(data),r=s?.receipts.find(r=>r.id===t.records[stepId]);if(!s||!r||!enteReceiptCurrent(s,r.id))return false;
  const step=enteSteps(data,t).find(v=>v.id===stepId);if(!step||step.refs.some(ref=>!r.refs.includes(ref)))return false;
  const appRef=stepAppRef(data,t,step),app=enteApp(data,appRef);
  if(['storage-account','storage-offline'].includes(step.effect??''))return r.configRef===enteConfiguration(data,appRef!)?.id;
  if(step.effect==='lock-test')return r.lockRef===enteLock(data,appRef!)?.id&&!!appRef&&entePrepared(data,appRef);
  if(step.effect==='code'||step.effect==='account-factor-use'||step.effect==='account-data-read'||step.effect==='recovery-data-read'){
    const proofs=s.proofs.filter(p=>p.directReceiptRef===r.id&&(step.effect!=='code'||p.kind==='totp-code'));
    return proofs.length>0&&proofs.every(p=>data.securityModel.routes.some(route=>route.requirements.kind==='fact'&&route.requirements.factId===p.factRef&&evaluateAccess(data.securityModel,route.id,{context:step.effect==='code'?(data.securityModel.facts.find(f=>f.id===p.factRef)?.contexts.includes('new-device')?'new-device':'normal'):'no-existing-session',now:nowString()}).state==='available'));
  }
  if(app?.kind==='installation'&&['open','device-lock'].includes(step.effect??'')){
    const target=step.effect==='device-lock'?data.assets.find(a=>a.id===app.deviceRef):app,control=step.effect==='device-lock'?'screenLock':'opened';
    if(!target||!['implemented','verified'].includes(target.controls?.[control]??'unknown'))return false;
  }
  return true;
}
function done(data:Dataset,t:EnteTask,step:EnteStep):boolean{
 if(step.child?.kind==='backup')return enteBackupCurrent(data,step.child.appRef);
 if(step.child?.kind==='prepare')return entePrepared(data,step.child.appRef)&&(!step.child.rootRef||enteConfiguration(data,step.child.appRef)?.rootRef===step.child.rootRef);
 if(step.child?.kind==='account'){const old=enteApp(data,t.appRef),target=enteApp(data,step.child.appRef),without=old?.kind==='installation'&&target?.kind==='installation'&&old.deviceRef!==target.deviceRef&&(t.kind==='recovery'?t.resources.protectionDevice??t.newDeviceRef:t.newDeviceRef)===target.deviceRef?[old.deviceRef]:[];return (t.kind!=='recovery'||!!enteStore(data)?.tasks.some(child=>child.kind==='account'&&child.appRef===step.child!.appRef&&child.status==='completed'&&enteParentTask(data,child.id)?.id===t.id))&&enteAccountReady(data,step.child.appRef,without);}
 return step.kind==='action'?enteStepRecorded(data,t,step.id):step.kind==='question'?!!step.choices?.some(c=>c.value===t.answers[step.id]):false;
}
export function currentEnteStep(data:Dataset,t:EnteTask):EnteStep{
  const steps=enteSteps(data,t).filter(s=>!(s.child&&done(data,t,s))),missing=steps.findIndex(s=>!done(data,t,s)),cursor=steps.findIndex(s=>s.id===t.cursor);
  if(t.status==='completed'&&missing<0)return {id:'finished',kind:'finished',title:{en:'These checks are recorded',ja:'ここまでの確認を記録しました'},refs:[],sources:[],requires:[]};
  if(cursor>=0&&(missing<0||cursor<=missing))return steps[cursor];
  return steps[missing>=0?missing:steps.length-1];
}
function progress(data:CurrentDataset,id:string,previous:string,at:string):CurrentDataset{
  let t=enteTask(data,id)!,steps=enteSteps(data,t),complete=steps.length>0&&steps.every(s=>done(data,t,s));
  if(complete&&['move','restore'].includes(t.kind)){
    const r=appendEnteReceipt(data,id,{stepId:'move-finished',refs:[t.destinationRef!,t.newDeviceRef!],requires:steps.filter(s=>s.kind==='action').map(s=>t.records[s.id])},at);
    data=r.data;t=enteTask(data,id)!;t={...t,sourceSnapshot:enteSnapshot(data.securityModel,t.appRef)};
  }
  const index=steps.findIndex(s=>s.id===previous),next=(index>=0?steps[index+1]:undefined)??steps.find(s=>!done(data,t,s));
  return putEnteTask(data,{...t,cursor:complete?'finished':next?.id??previous,status:complete?'completed':'active',history:[...t.history,previous].slice(-500),updatedAt:at});
}
export function answerEnte(data:Dataset,id:string,value:string,at=nowString()):Dataset{
  if(data.version!==2)return data;const task=enteTask(data,id);if(!task)return data;const step=currentEnteStep(data,task);if(step.kind!=='question'||!step.choices?.some(c=>c.value===value))return data;
  let next=data,t=task;const steps=enteSteps(data,t),index=steps.findIndex(s=>s.id===step.id),answers={...t.answers,[step.id]:value};
  if(t.answers[step.id]!==undefined&&t.answers[step.id]!==value){
    for(const s of steps.slice(index+1)){if(s.kind==='action')next=withdrawEnteReceipt(next,id,s.id,at) as CurrentDataset;else if(s.kind==='question')delete answers[s.id];}
  }
  t={...enteTask(next,id)!,answers,updatedAt:at,status:'active'};
  const resources={...t.resources};
  if(step.question==='recovery-device'||step.question==='recovery-protection-device'){
    let ref=value.startsWith('device:')?value.slice(7):undefined;
    if(!ref){const os=value.slice(4) as NonNullable<CurrentDataset['assets'][number]['operatingSystem']>,asset=makeAsset({kind:'device',type:['ios','android'].includes(os)?'Smartphone':'Computer',name:os==='ios'?'iPhone / iPad':os==='macos'?'Mac':os==='ubuntu'?'Linux':os==='windows'?'Windows':'Android',importance:'critical',operatingSystem:os});next={...next,assets:[...next.assets,asset]};ref=asset.id;}
    if(step.question==='recovery-device')t={...t,newDeviceRef:ref};
    else{if(resources.protectionDevice!==ref)t={...t,destinationRef:undefined};resources.protectionDevice=ref;}
  }
  if(step.question==='recovery-protection-app'){
    const made=createEnteApp(next,resources.protectionDevice!,value.startsWith('installation:')?value.slice(13):t.destinationRef,at);next=made.data;t={...t,destinationRef:made.appRef,answers:{...t.answers,[step.id]:`installation:${made.appRef}`}};
  }
  if(step.question==='recovery-paper'){if(value.startsWith('paper:'))resources.recoveryPaper=value.slice(6);else delete resources.recoveryPaper;}
  if(step.question==='recovery-mail'){
    if(value.startsWith('account:'))resources.recoveryMail=value.slice(8);else delete resources.recoveryMail;
  }
  if(step.question==='recovery-used-factor'){
    delete resources.recoveryFactor;delete resources.recoveryFactorStore;
    if(value.startsWith('credential:')){const entity=next.securityModel.entities.find(e=>e.id===value.slice(11)&&e.kind==='credential');if(entity?.kind==='credential'){resources.recoveryFactor=entity.id;if(entity.storageRef)resources.recoveryFactorStore=entity.storageRef;}}
  }
  if((step.id.endsWith('version'))&&value==='supported'){const ref=step.id.startsWith('new-')?t.destinationRef:t.appRef,app=enteApp(next,ref);if(app?.kind==='installation')next=putEnteEntity(next,{...app,appVersion:'4.4.26'});}
  if(step.question==='destination'){
    const made=createEnteApp(next,t.newDeviceRef!,value.startsWith('installation:')?value.slice(13):t.answers.destination===task.answers.destination?task.destinationRef:undefined,at);next=made.data;t={...t,destinationRef:made.appRef};
  }
  if(step.question==='root'){
    const root=createEnteRoot(next,value.startsWith('account:')?value.slice(8):undefined,at);next=root.data;t.answers[step.id]=`account:${root.rootRef}`;resources[step.id]=root.rootRef;
  }
  if(step.question==='location'){
    let ref=value.startsWith('location:')?value.slice(9):undefined;
    if(!ref){const asset={...makeAsset({kind:'backup',type:'Backup disk',name:next.settings.language==='ja'?'Ente用の別のバックアップドライブ':'Separate Ente backup drive',importance:'critical'}),createdAt:at,updatedAt:at};next={...next,assets:[...next.assets,asset]};ref=asset.id;t.answers[step.id]=`location:${ref}`;}
    resources.fileStorage=ref;
  }
  if(step.question==='file'){
    const file=enteStore(next)?.files.find(f=>f.entityRef===value.slice(5)&&f.appRef===t.appRef);if(!file&&value!=='new'&&value!=='unrecorded')return data;
    if(file){resources.fileRef=file.entityRef;resources.fileSecret=file.secretRef;}else{delete resources.fileRef;delete resources.sourceFileRef;delete resources.transferFileRef;}
  }
  if(step.question==='secret'){
    if(value.startsWith('secret:'))resources.fileSecret=value.slice(7);else delete resources.fileSecret;
  }
  if(step.question==='factor-store'){
    let ref=value.startsWith('store:')?value.slice(6):undefined;
    if(value==='local'){const app=enteApp(next,t.appRef);if(app?.kind!=='installation')return data;ref=app.deviceRef;}
    if(value==='store'){ref=crypto.randomUUID();next=putEnteEntity(next,securityEntitySchema.parse({id:ref,kind:'vault',productId:'other',label:next.settings.language==='ja'?'Enteで選んだパスキーの保存先':'Passkey store selected in Ente',createdAt:at}));}
    if(ref)resources.factorStore=ref;
  }
  if(step.question==='target-provider'){
    const provider=value as NonNullable<CurrentDataset['assets'][number]['provider']>,asset={...makeAsset({kind:'account',type:'Identity provider',name:`${PROVIDERS[provider]} ${next.assets.filter(a=>a.provider===provider).length+1}`,importance:'critical'}),provider,purpose:'personal' as const,createdAt:at,updatedAt:at};next={...next,assets:[...next.assets,asset]};t.answers[`target-more:${step.id.slice('target-provider:'.length)}`]=`account:${asset.id}`;
  }
  next=putEnteTask(next,{...t,resources});
  if(step.id==='recovery-result'&&value==='changed'){
    try{const root=enteRecoveryRoot(next,enteTask(next,id)!),candidate=enteTask(next,id)!.recoveryStateV1?.password?.candidateRef;if(!root||!candidate)return data;
      const receipt=appendEnteReceipt(next,id,{stepId:'recovery-change-confirmed',refs:[root.rootRef,candidate],titleEn:'Ente confirmed the password change',titleJa:'Enteでパスワード変更の結果を確認'},at);next=applyEntePassword(receipt.data,enteTask(receipt.data,id)!,receipt.receipt);
    }catch{return data;}
  }
  return progress(next,id,step.id,at);
}
function applyEffect(data:CurrentDataset,t:EnteTask,s:EnteStep,r:EnteReceipt):CurrentDataset{
  if(t.kind==='recovery'){
    if(s.effect==='recovery-candidate')return prepareEntePassword(data,t,r);
    if(s.effect==='recovery-request')return requestEntePassword(data,t,r);
    if(s.effect==='recovery-new-password')return applyEntePassword(data,t,r);
    if(s.effect==='recovery-factor-request')return requestEnteFactorRecovery(data,t,r);
    if(s.effect==='recovery-factor-confirmed')return confirmEnteFactorRecovery(data,t,r);
    if(s.effect==='recovery-data-read')return recordEnteRecoveryRead(data,t,r);
    const root=enteRecoveryRoot(data,t);
    if(root&&s.effect==='recovery-key-keep'){const stored=enteStore(data)!.secrets.find(v=>v.entityRef===root.recoveryRef)?.copies.find(v=>available(data,v.storageRef)&&enteReceiptCurrent(enteStore(data)!,v.receiptRef)),made=makeEnteSecret(data,r,root.rootRef,'recovery-key',stored?{ref:stored.storageRef}:'paper',root.recoveryRef,s.sources);return recordEnteRootSecret(made.data,r,root.rootRef,made.secretRef,false,s.sources);}
    if(root&&s.effect==='recovery-current-password'){const made=makeEnteSecret(data,r,root.rootRef,'account-password','paper',root.passwordRef,s.sources);return recordEnteRootSecret(made.data,r,root.rootRef,made.secretRef,false,s.sources);}
    if(root&&s.effect==='recovery-mail-access'&&t.resources.recoveryMail)return recordEnteLink(data,r,t.resources.recoveryMail,root.rootRef,'recovers',s.sources);
    if(root&&s.effect==='recovery-shared'){const store=enteStore(data)!;return putEnteStore(data,{...store,roots:store.roots.map(v=>v.rootRef===root.rootRef?{...v,products:[...new Set([...v.products,...(t.answers['recovery-photos']==='yes'?['photos' as const]:[]),...(t.answers['recovery-locker']==='yes'?['locker' as const]:[])])],sharedScope:['recovery-photos','recovery-locker'].every(k=>t.answers[k]!=='unknown')?'confirmed':'unknown'}:v)});}
    if(s.webDeviceRef)return data;
  }
  let next=data;const appRef=stepAppRef(next,t,s),app=enteApp(next,appRef);if(app?.kind!=='installation')return data;
  let resources={...t.resources};const prefix=s.id.startsWith('new-')?'new-':'',rootRef=t.kind==='prepare'&&t.rootRef?t.rootRef:t.answers[`${prefix}root`]?.slice(8);
  if(s.effect==='open'){next=recordEnteControl(next,r,app.id,'opened');next=recordEnteLink(next,r,app.id,app.deviceRef,'installed-on',s.sources);}
  if(s.effect==='device-lock')next=recordEnteControl(next,r,app.deviceRef,'screenLock');
  if(s.effect==='storage-account'||s.effect==='storage-offline')next=recordEnteStorage(next,r,app.id,s.effect==='storage-account'?'account':'offline',s.effect==='storage-account'?rootRef:undefined,s.sources);
  if(s.effect==='lock-test')next=recordEnteLock(next,r,app.id,t.answers[`${prefix}lock-mode`]==='off'?'device':t.answers[`${prefix}lock-mode`] as 'device'|'pin'|'password',false,s.sources);
  if(s.effect==='root-password'&&rootRef){const secret=makeEnteSecret(next,r,rootRef,'account-password','paper',undefined,s.sources);next=secret.data;resources[`${prefix}rootPassword`]=secret.secretRef;}
  if(s.effect==='root-password-set'&&rootRef&&resources[`${prefix}rootPassword`])next=recordEnteRootSecret(next,r,rootRef,resources[`${prefix}rootPassword`],false,s.sources);
  if(s.effect==='secret-export'||s.effect==='secret-automatic'){const secret=makeEnteSecret(next,r,t.appRef,s.effect==='secret-export'?'export':'automatic','paper',undefined,s.sources);next=secret.data;resources.fileSecret=secret.secretRef;}
  if(s.effect==='automatic-folder'){
    const id=crypto.randomUUID();next=putEnteEntity(next,securityEntitySchema.parse({id,kind:'data-set',dataType:'other',ownerRef:t.appRef,label:next.settings.language==='ja'?'Enteの自動バックアップ管理フォルダー':'Ente automatic-backup managed folder',createdAt:r.at}));resources.automaticFolder=id;next=recordEnteLink(next,r,id,app.deviceRef,'stored-in',s.sources);
  }
  if(s.effect==='file-saved'){delete resources.sourceFileRef;delete resources.fileRef;delete resources.transferFileRef;}
  if(s.effect==='file-save-auto'){
    const automatic=s.effect==='file-save-auto',storage=automatic?resources.automaticFolder:app.deviceRef;
    if(!storage||!resources.fileSecret)throw Error('missing-ente-file-input');
    const file=saveEnteFile(next,r,t.appRef,resources.fileSecret,storage,automatic?'automatic':'export',s.sources);next=file.data;resources.sourceFileRef=file.fileRef;resources.fileRef=file.fileRef;
    if(automatic){const store=enteStore(next)!;next=putEnteStore(next,{...store,automaticSettings:[...store.automaticSettings,{appRef:t.appRef,enabled:true,secretRef:resources.fileSecret,folderRef:storage,receiptRef:r.id}]});}
  }
  if(s.effect==='backup-coverage'){const fileRef=t.answers['destination-backup']?.slice(5);if(!fileRef)throw Error('missing-coverage-file');const store=enteStore(next)!;next=putEnteStore(next,{...store,receipts:store.receipts.map(v=>v.id===r.id?{...v,enteBackupCoverageV1:{appRef:app.id,fileRef,snapshot:enteSnapshot(next.securityModel,app.id)}}:v)});next=recordEnteLink(next,r,fileRef,app.id,'backs-up',s.sources);}
  if(s.effect==='file-copy'){
    if(!resources.fileStorage||!resources.fileSecret)throw Error('missing-ente-copy');
    if(!resources.sourceFileRef){const saved=saveEnteFile(next,r,t.appRef,resources.fileSecret,t.answers['save-place']==='external'?resources.fileStorage:app.deviceRef,'export',s.sources);next=saved.data;resources.sourceFileRef=saved.fileRef;}
    if(t.answers['backup-kind']==='manual'&&t.answers['save-place']==='external'){next=confirmEnteExternalFile(next,r,resources.sourceFileRef);resources.fileRef=resources.sourceFileRef;}
    else {const copy=copyEnteFile(next,r,resources.sourceFileRef,resources.fileStorage,'permanent',s.sources);next=copy.data;resources.fileRef=copy.fileRef;}
  }
  if(s.effect==='restore-file-record'&&!resources.fileRef){const secret=makeEnteSecret(next,r,t.appRef,'export','paper',undefined,s.sources);next=secret.data;resources.fileSecret=secret.secretRef;const disk={...makeAsset({kind:'backup',type:'Backup disk',name:next.settings.language==='ja'?'既存のEnte暗号化ファイルの保管先':'Existing Ente encrypted-export storage',importance:'critical'}),createdAt:r.at,updatedAt:r.at};next={...next,assets:[...next.assets,disk]};const file=saveEnteFile(next,r,t.appRef,secret.secretRef,disk.id,'export',s.sources);next=file.data;const store=enteStore(next)!;next=putEnteStore(next,{...store,files:store.files.map(f=>f.entityRef===file.fileRef?{...f,role:'permanent',snapshot:'unverified-export-coverage'}:f)});resources.fileRef=file.fileRef;}
  if(s.effect==='receive-file'){
    if(!resources.fileRef||!t.newDeviceRef)throw Error('missing-ente-transfer');
    const file=copyEnteFile(next,r,resources.fileRef,t.newDeviceRef,'transfer',s.sources);next=file.data;resources.transferFileRef=file.fileRef;
  }
  if(s.effect==='restore-file'||s.effect==='restore-sync'){
    const config=enteConfiguration(next,app.id)!,origin=s.effect==='restore-sync'?config.datasetRef:resources.transferFileRef??resources.fileRef;
    if(!origin)throw Error('missing-ente-restore');next=recordEnteLink(next,r,app.id,origin,'restores-from',s.sources,true);
    next=recordEnteProof(next,r,{kind:'restore',appRef:app.id,configRef:config.id},{label:next.settings.language==='ja'?'Enteの項目を読めた確認（コード利用は別）':'Ente entries read; code use is separate',targetRef:app.id,purpose:'restore',context:'new-device',requiredRefs:[app.id,app.deviceRef,origin,...(s.effect==='restore-file'?[resources.fileSecret]:[])]},s.sources);
  }
  if(s.effect==='code'&&s.subjectRef){
    const existing=next.securityModel.entities.filter(e=>e.kind==='credential'&&e.credentialType==='totp'&&e.subjectRef===s.subjectRef&&e.storageRef===app.id&&available(next,e.id));
    if(existing.length>1)throw Error('ambiguous-ente-code');
    const originals=next.securityModel.entities.filter(e=>e.kind==='credential'&&e.credentialType==='totp'&&e.subjectRef===s.subjectRef&&e.storageRef===t.appRef&&available(next,e.id));
    const original=t.appRef!==app.id&&originals.length===1&&(t.answers['codes-state']!=='present'||t.answers['present-origin']==='copy')?originals[0]:undefined;
    const group=original?.kind==='credential'?original.replicaGroupId??crypto.randomUUID():undefined;
    if(original?.kind==='credential')next=putEnteEntity(next,{...original,replicaGroupId:group});
    const token=existing[0]??securityEntitySchema.parse({id:crypto.randomUUID(),kind:'credential',credentialType:'totp',subjectRef:s.subjectRef,storageRef:app.id,roles:['second-step'],replicaGroupId:group,label:`Ente Auth · ${next.assets.find(a=>a.id===s.subjectRef)?.name??'TOTP'}`.slice(0,80),createdAt:r.at});
    if(!existing.length)next=putEnteEntity(next,token);
    const requiredRefs=[app.id,app.deviceRef,s.subjectRef,token.id,...(enteLock(next,app.id)?.credentialRef?[enteLock(next,app.id)!.credentialRef!]:[])],config=enteConfiguration(next,app.id)!;
    next=recordEnteProof(next,r,{kind:'totp-code',appRef:app.id,configRef:config.id},{label:next.settings.language==='ja'?'新しいEnteコードの受け付け':'New Ente code accepted',targetRef:s.subjectRef,purpose:'second-step',context:t.kind==='restore'&&t.appRef===app.id?'normal':'new-device',requiredRefs},s.sources);
    next=recordEnteProof(next,r,{kind:'service-signin',appRef:app.id,configRef:config.id},{label:next.settings.language==='ja'?'新しいEnteコードによるログイン':'Sign-in with the new Ente code',targetRef:s.subjectRef,purpose:'sign-in',context:t.kind==='restore'&&t.appRef===app.id?'normal':'new-device',requiredRefs},s.sources);
    next=recordEnteLink(next,r,token.id,app.id,'stored-in',s.sources);next=recordEnteLink(next,r,token.id,s.subjectRef,'authenticates-to',s.sources);next=recordEnteControl(next,r,app.id,'codeUse');next=recordEnteControl(next,r,s.subjectRef,'mfa');
  }
  const accountRootRef=t.rootRef??enteConfiguration(next,t.appRef)?.rootRef,accountRoot=enteStore(next)?.roots.find(v=>v.rootRef===accountRootRef);
  if(s.effect==='account-password-existing'&&accountRoot){const secret=makeEnteSecret(next,r,accountRoot.rootRef,'account-password','paper',accountRoot.passwordRef,s.sources);next=recordEnteRootSecret(secret.data,r,accountRoot.rootRef,secret.secretRef,false,s.sources);}
  if(s.effect==='account-recovery-key'&&accountRoot){const selected=t.answers['root-key-copy'],secret=makeEnteSecret(next,r,accountRoot.rootRef,'recovery-key',selected?.startsWith('paper:')?{ref:selected.slice(6)}:'paper',accountRoot.recoveryRef,s.sources);next=recordEnteRootSecret(secret.data,r,accountRoot.rootRef,secret.secretRef,false,s.sources);next=recordEnteControl(next,r,accountRoot.rootRef,'recovery');}
  if(s.effect==='account-mail'&&accountRoot&&s.subjectRef)next=recordEnteLink(next,r,s.subjectRef,accountRoot.rootRef,'recovers',s.sources);
  if(s.effect==='account-passkey-registration'&&accountRoot&&resources.factorStore){
    const selected=t.answers['root-passkey-record'],existing=selected?.startsWith('credential:')?next.securityModel.entities.find(v=>v.id===selected.slice(11)&&v.kind==='credential'&&v.subjectRef===accountRoot.rootRef&&v.credentialType==='passkey'):undefined;
    if(existing?.kind==='credential'){
      if(existing.storageRef!==resources.factorStore){next=putEnteEntity(next,{...existing,storageRef:resources.factorStore});next={...next,securityModel:{...next.securityModel,lifecycle:{...next.securityModel.lifecycle,[existing.id]:{state:'in-use',evidence:'user-confirmed',updatedAt:r.at,accessResetAt:r.at}}}};}
      resources.factorCredential=existing.id;
    }else{const id=crypto.randomUUID();next=putEnteEntity(next,securityEntitySchema.parse({id,kind:'credential',credentialType:'passkey',subjectRef:accountRoot.rootRef,storageRef:resources.factorStore,roles:['second-step'],label:next.settings.language==='ja'?'Ente Accountのパスキー':'Ente Account passkey',createdAt:r.at}));resources.factorCredential=id;}
    next=recordEnteLink(next,r,resources.factorCredential,resources.factorStore,'stored-in',s.sources);next=recordEnteLink(next,r,resources.factorCredential,accountRoot.rootRef,'authenticates-to',s.sources);next=recordEnteControl(next,r,accountRoot.rootRef,'mfa');
  }
  const parent=enteParent(next,t.id),previous=parent?enteApp(next,parent.appRef):undefined,without=previous?.kind==='installation'&&app.deviceRef===(parent?.kind==='recovery'?parent.resources.protectionDevice??parent.newDeviceRef:parent?.newDeviceRef)&&previous.deviceRef!==app.deviceRef?[previous.deviceRef]:[];
  const factorHost=next.securityModel.entities.find(e=>e.id===resources.factorStore),factorHostRefs=factorHost?.kind==='installation'?[factorHost.deviceRef]:factorHost?.kind==='vault'&&factorHost.storageMode==='local'&&factorHost.primaryDeviceRef?[factorHost.primaryDeviceRef]:[];
  if(s.effect==='account-factor-use'&&accountRoot&&resources.factorStore){
    if(t.answers['root-mfa']==='totp'){
      const known=next.securityModel.entities.filter(v=>v.kind==='credential'&&v.credentialType==='totp'&&v.subjectRef===accountRoot.rootRef&&v.storageRef===resources.factorStore&&available(next,v.id));if(known.length>1)throw Error('ambiguous-root-totp');
      if(known.length)resources.factorCredential=known[0].id;else{const id=crypto.randomUUID();next=putEnteEntity(next,securityEntitySchema.parse({id,kind:'credential',credentialType:'totp',subjectRef:accountRoot.rootRef,storageRef:resources.factorStore,roles:['second-step'],label:next.settings.language==='ja'?'Ente Accountの既存TOTP':'Existing Ente Account TOTP',createdAt:r.at}));resources.factorCredential=id;}
      next=recordEnteLink(next,r,resources.factorCredential,resources.factorStore,'stored-in',s.sources);next=recordEnteLink(next,r,resources.factorCredential,accountRoot.rootRef,'authenticates-to',s.sources);next=recordEnteControl(next,r,accountRoot.rootRef,'mfa');
    }
    if(!resources.factorCredential)throw Error('missing-ente-root-factor');
    next=recordEnteProof(next,r,{kind:t.answers['root-mfa']==='totp'?'account-auth':'account-passkey',rootRef:accountRoot.rootRef,rootEpoch:accountRoot.epoch},{label:next.settings.language==='ja'?'Ente Accountの追加認証を使えた記録':'Ente Account additional authentication used',targetRef:accountRoot.rootRef,purpose:'second-step',context:'no-existing-session',requiredRefs:[accountRoot.rootRef,app.deviceRef,resources.factorCredential,resources.factorStore,...factorHostRefs],withoutRefs:without},s.sources);
  }
  if(s.effect==='account-data-read'&&accountRoot&&resources.factorCredential&&accountRoot.passwordRef){
    const requiredRefs=[accountRoot.rootRef,app.deviceRef,accountRoot.passwordRef,resources.factorCredential,resources.factorStore,...factorHostRefs,...(t.answers['root-email-mode']==='on'?[t.answers['root-mail'].slice(8)]:[])];
    for(const purpose of ['sign-in','decrypt'] as const)next=recordEnteProof(next,r,{kind:purpose==='sign-in'?'account-auth':'account-read',rootRef:accountRoot.rootRef,rootEpoch:accountRoot.epoch},{label:next.settings.language==='ja'?purpose==='sign-in'?'新しいEnte Accountログイン':'Ente Accountのデータを読めた確認':purpose==='sign-in'?'Fresh Ente Account sign-in':'Ente Account data read',targetRef:accountRoot.rootRef,purpose,context:'no-existing-session',requiredRefs,withoutRefs:without},s.sources);
  }
  if(s.effect==='cleanup'&&resources.transferFileRef){const ref=resources.transferFileRef;next={...next,securityModel:{...next.securityModel,lifecycle:{...next.securityModel.lifecycle,[ref]:{state:'deleted',evidence:'user-confirmed',updatedAt:r.at,accessResetAt:r.at}}}};}
  return putEnteTask(next,{...enteTask(next,t.id)!,resources});
}
export function confirmEnte(data:Dataset,id:string,at=nowString(),repeat=false):Dataset{
  if(data.version!==2)return data;const t=enteTask(data,id);if(!t)return data;const step=currentEnteStep(data,t);if(step.kind!=='action')return data;
  const steps=enteSteps(data,t),index=steps.findIndex(s=>s.id===step.id);if(steps.slice(0,index).some(s=>!done(data,t,s)))return data;
  if(enteStepRecorded(data,t,step.id)&&!repeat)return progress(data,id,step.id,at);
  const appRef=stepAppRef(data,t,step),app=enteApp(data,appRef),root=t.kind==='prepare'&&t.rootRef?t.rootRef:t.answers[`${step.id.startsWith('new-')?'new-':''}root`]?.slice(8);
  if(step.webDeviceRef){if(t.kind!=='recovery'||step.webDeviceRef!==t.newDeviceRef||!data.assets.some(d=>d.id===step.webDeviceRef&&d.kind==='device')||!available(data,step.webDeviceRef)||!enteRecoveryRoot(data,t))return data;}
  else if(app?.kind!=='installation'||![app.id,app.deviceRef].every(ref=>available(data,ref)))return data;
  if(step.refs.some(ref=>!available(data,ref)))return data;
  const extraRoot=root&&step.effect?.startsWith('root-')||root&&step.effect==='storage-account'?root:undefined;
  if(extraRoot&&!available(data,extraRoot))return data;
  try{
    const r=appendEnteReceipt(data,id,{stepId:step.id,refs:[...new Set([...step.refs,...(step.webDeviceRef?[]:[app!.id,(app as {deviceRef:string}).deviceRef]),...(extraRoot?[extraRoot]:[])])],requires:step.requires.map(k=>t.records[k]).filter(Boolean),titleEn:step.title.en,titleJa:step.title.ja},at);
    const next=applyEffect(r.data,enteTask(r.data,id)!,step,r.receipt);return progress(next,id,step.id,at);
  }catch{return data;}
}
export function navigateEnte(data:Dataset,id:string,direction:'back'|'defer'|'cancel'|string,at=nowString()):Dataset{
  if(data.version!==2)return data;const t=enteTask(data,id);if(!t)return data;
  if(direction==='defer'||direction==='cancel')return putEnteTask(data,{...t,status:direction==='defer'?'deferred':'cancelled',updatedAt:at});
  const history=[...t.history],steps=enteSteps(data,t);let cursor=direction==='back'?history.pop():direction;while(direction==='back'&&cursor&&!steps.some(s=>s.id===cursor))cursor=history.pop();if(!cursor||!steps.some(s=>s.id===cursor))return data;
  return putEnteTask(data,{...t,cursor,history,status:'active',updatedAt:at});
}
export function enteMoveReady(data:Dataset,phoneRef:string,appRef:string,newDeviceRef:string):boolean{
  if(data.version!==2)return false;const store=enteStore(data),w=data.deviceWorkflows.find(w=>w.id===phoneRef),app=enteApp(data,appRef);
  if(!store||!w||app?.kind!=='installation'||w.oldDeviceRef!==app.deviceRef||w.newDeviceRef!==newDeviceRef)return false;
  return store.tasks.some(t=>{
    if(!['move','restore'].includes(t.kind)||t.phoneRef!==phoneRef||t.appRef!==appRef||t.newDeviceRef!==newDeviceRef||t.status!=='completed'||!t.records['move-finished']||!enteReceiptCurrent(store,t.records['move-finished'])||!t.destinationRef||!entePrepared(data,t.destinationRef))return false;
    const dest=enteApp(data,t.destinationRef);if(dest?.kind!=='installation'||dest.deviceRef!==newDeviceRef||!enteBackupCurrent(data,dest.id))return false;if(enteConfiguration(data,dest.id)?.rootRef&&!enteAccountReady(data,dest.id,[app.deviceRef]))return false;
    const targets=enteTargets(data,t);return targets.length>0&&targets.every(ref=>{
      const receipt=t.records[`code:${ref}`],proof=store.proofs.find(p=>p.directReceiptRef===receipt&&p.kind==='totp-code'),f=data.securityModel.facts.find(f=>f.id===proof?.factRef);
      return !!f&&f.evidence==='user-confirmed'&&f.state==='available'&&enteFactCurrent(data.securityModel,f)&&f.requiredRefs.every(id=>available(data,id)&&(!data.securityModel.lifecycle[id]?.accessResetAt||Date.parse(data.securityModel.lifecycle[id].accessResetAt!)<Date.parse(f.checkedAt)));
    });
  });
}
export function enteHelpPrompt(data:Dataset,t:EnteTask,problem:number,language:Language):string{
  const step=currentEnteStep(data,t),app=enteApp(data,stepAppRef(data,t,step)),deviceRef=step.webDeviceRef??(app?.kind==='installation'?app.deviceRef:undefined),os=data.assets.find(d=>d.id===deviceRef)?.operatingSystem??'unknown';
  const problems=language==='ja'?['画面が違う','項目がない','非対応・権限がない','解除情報が使えない','同期・取込みが終わらない','別の認証方法で通過した']:['Different screen','Missing item','Unsupported / no permission','Unlock or recovery information unavailable','Sync or import not completed','Another sign-in method was used'];
  const sources=step.sources.map(id=>{const s=SOURCES[id as keyof typeof SOURCES]??PHONE_SOURCES[id];return s?`${s.title}: ${s.url} (${s.checked})`:'';}).filter(Boolean);
  const target=step.id.startsWith('code:')?step.subjectRef:step.id.startsWith('code-open:')?step.id.slice(10):undefined,provider=data.assets.find(a=>a.id===target)?.provider,operation=target?{ja:`選んだ${provider?PROVIDERS[provider]:'サービス'}で、新端末のコードを使う`,en:`Use the new-phone code at the selected ${provider?PROVIDERS[provider]:'service'}`}:step.title;
  return language==='ja'?`最新の公式情報を確認し、一度に一つの質問または操作だけを案内してください。最新情報を確認できなければ、その旨を明示してください。\nサービス: Ente Auth / Ente Account\nOS: ${os}\n適用版: 4.4.26\n作業: ${t.kind}\n現在の操作: ${operation.ja}\n想定する表示: ${step.expected?.ja??step.action?.ja??'未確認のため作業を保留'}\n困りごと: ${problems[problem]??problems[0]}\n根拠:\n${sources.join('\n')}\n実際のメール、パスワード、QR、認証・復旧コード、一時URLやトークンを要求しないでください。画像ではこれらを隠します。`:`Check current official sources and give one question or operation at a time. If you cannot verify current information, say so.\nService: Ente Auth / Ente Account\nOS: ${os}\nApplicable version: 4.4.26\nTask: ${t.kind}\nCurrent operation: ${operation.en}\nExpected: ${step.expected?.en??step.action?.en??'Unconfirmed; keep unfinished'}\nProblem: ${problems[problem]??problems[0]}\nSources:\n${sources.join('\n')}\nDo not request actual email addresses, passwords, QR secrets, authentication/recovery codes, temporary URLs or tokens. Hide these in images.`;
}

export function enteAccountReady(data:Dataset,appRef:string,withoutRefs:string[]=[]):boolean{
 if(data.version!==2)return false;const store=enteStore(data),root=store?.roots.find(v=>v.rootRef===enteConfiguration(data,appRef)?.rootRef);if(!store||!root||entePasswordPending(data.securityModel,root.rootRef))return false;
 const copied=(ref?:string)=>{const secret=store.secrets.find(v=>v.entityRef===ref);return !!secret&&available(data,secret.entityRef)&&secret.copies.some(v=>available(data,v.storageRef)&&enteReceiptCurrent(store,v.receiptRef));};
 return copied(root.passwordRef)&&copied(root.recoveryRef)&&store.proofs.some(p=>p.kind==='account-read'&&p.rootRef===root.rootRef&&data.securityModel.facts.some(f=>f.id===p.factRef&&f.requiredRefs.some(ref=>data.securityModel.entities.some(e=>e.id===ref&&e.kind==='credential'&&e.subjectRef===root.rootRef&&['totp','passkey'].includes(e.credentialType)&&e.roles.includes('second-step')))&&f.requiredRefs.includes(enteApp(data,appRef)?.kind==='installation'?enteApp(data,appRef)!.deviceRef as string:''))&&data.securityModel.routes.some(r=>r.requirements.kind==='fact'&&r.requirements.factId===p.factRef&&evaluateAccess(data.securityModel,r.id,{context:'no-existing-session',now:nowString(),unavailableRefs:withoutRefs}).state==='available'));
}
export const enteParent=enteParentTask;
export function reconcileEnteTask(data:Dataset,id:string,at=nowString()):Dataset{
 if(data.version!==2)return data;const t=enteTask(data,id);return t&&enteSteps(data,t).every(s=>done(data,t,s))?progress(data,id,t.cursor,at):data;
}

export function entePhoneSignInRecorded(data:Dataset,phoneRef:string,accountRef:string,newDeviceRef:string):boolean{
 if(data.version!==2)return false;const store=enteStore(data);return !!store&&store.tasks.some(t=>t.origin==='phone'&&t.phoneRef===phoneRef&&t.newDeviceRef===newDeviceRef&&enteMoveReady(data,phoneRef,t.appRef,newDeviceRef)&&store.proofs.some(p=>p.kind==='service-signin'&&p.directReceiptRef===t.records[`code:${accountRef}`]&&data.securityModel.facts.some(f=>f.id===p.factRef&&f.requiredRefs.includes(newDeviceRef)&&f.requiredRefs.includes(accountRef))&&data.securityModel.routes.some(r=>r.targetRef===accountRef&&r.purpose==='sign-in'&&r.requirements.kind==='fact'&&r.requirements.factId===p.factRef&&evaluateAccess(data.securityModel,r.id,{context:'new-device',now:nowString()}).state==='available')));
}

export function beginEnteChild(data:Dataset,id:string):{data:CurrentDataset;id:string}{
 if(data.version!==2)throw Error('no-ente-parent');const parent=enteTask(data,id),step=parent&&currentEnteStep(data,parent);if(!parent||!step?.child)throw Error('no-ente-child-step');
 const known=enteStore(data)?.tasks.find(t=>enteParent(data,t.id)?.id===parent.id&&t.kind===step.child!.kind&&t.appRef===step.child!.appRef&&t.rootRef===step.child!.rootRef&&['active','deferred'].includes(t.status));
 if(known)return {data:putEnteTask(data,{...known,status:'active'}),id:known.id};
 const created=startEnteTask(data,{...step.child,origin:'map'},undefined,true);
 return {data:putEnteTask(created.data,{...enteTask(created.data,created.id)!,...(step.child.kind==='recovery'&&parent.answers['root-password-state']==='forgot'?{answers:{'recovery-purpose':'forgot'}}:{}),enteReturnV1:{taskRef:parent.id,createdAt:parent.createdAt,appRef:parent.appRef,destinationRef:parent.destinationRef,newDeviceRef:parent.newDeviceRef}}),id:created.id};
}
