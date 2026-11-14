import type { CurrentDataset, Dataset } from './models';
import { undoControl } from './controlRecords';
import { enteStore, enteConfiguration, enteParentTask, enteFactCurrent, enteReceiptCurrent, type EnteTask, type EnteReceipt } from './enteSchemas';
import { evaluateAccess, securityEntitySchema } from './securityModel';
import { enteTask, putEnteTask, putEnteEntity, makeEnteSecret, recordEnteRootSecret, recordEnteLink, recordEnteProof, recordEnteControl } from './enteData';

export function enteRecoveryRoot(data:Dataset,t:EnteTask){
  const root=enteStore(data)?.roots.find(r=>r.rootRef===t.rootRef);
  return root&&enteConfiguration(data,t.appRef)?.rootRef===root.rootRef?root:undefined;
}

export function enteRecoveryFactorInputs(data:Dataset,rootRef:string,ref:string):string[]|undefined{
  if(data.version!==2)return;
  const factor=data.securityModel.entities.find(e=>e.id===ref);
  if(factor?.kind!=='credential'||factor.subjectRef!==rootRef||!factor.roles.includes('second-step')||!['totp','passkey'].includes(factor.credentialType)||!factor.storageRef)return;
  const store=data.securityModel.entities.find(e=>e.id===factor.storageRef),host=store?.kind==='installation'?[store.deviceRef]:store?.kind==='vault'&&store.storageMode==='local'&&store.primaryDeviceRef?[store.primaryDeviceRef]:[];
  const refs=[factor.id,factor.storageRef,...host];
  return refs.every(id=>!['lost','deleted','revoked','unavailable','retired','transferred'].includes(data.securityModel.lifecycle[id]?.state??''))?refs:undefined;
}

export function recordEnteSignInFactor(data:CurrentDataset,t:EnteTask,r:EnteReceipt,type:'passkey'|'totp'):CurrentDataset{
  const root=enteRecoveryRoot(data,t),storeRef=t.resources.recoveryFactorStore;
  if(t.stepwiseSignInV1!==1||!root||!storeRef)throw Error('invalid-ente-signin-factor');
  let next=data,ref=t.resources.recoveryFactor;
  if(ref){const entity=data.securityModel.entities.find(e=>e.id===ref);if(entity?.kind!=='credential'||entity.subjectRef!==root.rootRef||entity.credentialType!==type||entity.storageRef!==storeRef||!enteRecoveryFactorInputs(data,root.rootRef,ref))throw Error('ente-signin-factor-mismatch');}
  else{
    ref=crypto.randomUUID();next=putEnteEntity(next,securityEntitySchema.parse({id:ref,kind:'credential',credentialType:type,subjectRef:root.rootRef,storageRef:storeRef,roles:['second-step'],label:next.settings.language==='ja'?type==='passkey'?'今回使ったEnte Accountのパスキー':'今回使ったEnte AccountのTOTP':type==='passkey'?'Ente Account passkey used in this check':'Ente Account TOTP used in this check',createdAt:r.at}));
  }
  if(!enteRecoveryFactorInputs(next,root.rootRef,ref))throw Error('ente-signin-factor-unavailable');
  next=recordEnteLink(next,r,ref,storeRef,'stored-in',['enteSignInSource']);next=recordEnteLink(next,r,ref,root.rootRef,'authenticates-to',['enteSignInSource']);
  return putEnteTask(next,{...enteTask(next,t.id)!,resources:{...t.resources,recoveryFactor:ref}});
}

export function enteRootReadProtected(data:Dataset,rootRef:string,deviceRef:string,withoutRefs:string[]=[]):boolean{
  if(data.version!==2)return false;const store=enteStore(data),root=store?.roots.find(r=>r.rootRef===rootRef);if(!store||!root)return false;
  const available=(ref:string)=>!['lost','unavailable','revoked','deleted','transferred','retired'].includes(data.securityModel.lifecycle[ref]?.state??'');
  const copied=(ref?:string)=>{const secret=store.secrets.find(s=>s.entityRef===ref);return !!secret&&available(secret.entityRef)&&secret.copies.some(c=>available(c.storageRef)&&enteReceiptCurrent(store,c.receiptRef));};
  return copied(root.passwordRef)&&copied(root.recoveryRef)&&store.proofs.some(p=>p.kind==='account-read'&&p.rootRef===root.rootRef&&data.securityModel.facts.some(f=>f.id===p.factRef&&f.requiredRefs.includes(deviceRef)&&f.requiredRefs.some(ref=>data.securityModel.entities.some(e=>e.id===ref&&e.kind==='credential'&&e.subjectRef===root.rootRef&&['totp','passkey'].includes(e.credentialType)&&e.roles.includes('second-step'))))&&data.securityModel.routes.some(r=>r.requirements.kind==='fact'&&r.requirements.factId===p.factRef&&evaluateAccess(data.securityModel,r.id,{context:'no-existing-session',now:new Date().toISOString(),unavailableRefs:withoutRefs}).state==='available'));
}

export function prepareEntePassword(data:CurrentDataset,t:EnteTask,r:EnteReceipt):CurrentDataset{
  const root=enteRecoveryRoot(data,t);if(!root||t.recoveryStateV1?.password?.requestedAt)throw Error('ente-password-already-requested');
  const made=makeEnteSecret(data,r,root.rootRef,'account-password',t.resources.recoveryPaper?{ref:t.resources.recoveryPaper}:'paper',undefined,['enteRecovery','effDice']);
  return putEnteTask(made.data,{...enteTask(made.data,t.id)!,resources:{...t.resources,recoveryPassword:made.secretRef},
    recoveryStateV1:{...t.recoveryStateV1,version:1,password:{candidateRef:made.secretRef,previousEpoch:root.epoch,phase:'prepared'}}});
}

export function requestEntePassword(data:CurrentDataset,t:EnteTask,r:EnteReceipt):CurrentDataset{
  const root=enteRecoveryRoot(data,t),state=t.recoveryStateV1?.password;
  if(!root||!state||state.previousEpoch!==root.epoch)throw Error('ente-password-request-scope');
  if(state.requestedAt)return data;
  return putEnteTask(data,{...t,recoveryStateV1:{...t.recoveryStateV1,version:1,password:{...state,phase:'requested',requestedAt:r.at}}});
}

export function applyEntePassword(data:CurrentDataset,t:EnteTask,r:EnteReceipt):CurrentDataset{
  const root=enteRecoveryRoot(data,t),state=t.recoveryStateV1?.password;
  if(!root||!state?.requestedAt)throw Error('ente-password-not-requested');
  if(state.appliedEpoch&&(state.appliedEpoch!==root.epoch||state.candidateRef!==root.passwordRef))throw Error('ente-password-replaced-later');
  if(!state.appliedEpoch&&root.epoch!==state.previousEpoch)throw Error('ente-password-root-changed');
  const next=recordEnteRootSecret(data,r,root.rootRef,state.candidateRef,root.passwordRef!==state.candidateRef,['enteRecovery','enteSharedSource']);
  const current=enteStore(next)!.roots.find(v=>v.rootRef===root.rootRef)!;
  return putEnteTask(next,{...enteTask(next,t.id)!,recoveryStateV1:{...t.recoveryStateV1,version:1,password:{...state,phase:'applied',appliedAt:state.appliedAt??r.at,appliedEpoch:current.epoch}}});
}

export function requestEnteFactorRecovery(data:CurrentDataset,t:EnteTask,r:EnteReceipt):CurrentDataset{
  const type=t.answers['recovery-screen'];if(!enteRecoveryRoot(data,t)||!['totp','passkey'].includes(type))throw Error('ente-factor-recovery-scope');
  if(t.recoveryStateV1?.factor)return data;
  return putEnteTask(data,{...t,recoveryStateV1:{...t.recoveryStateV1,version:1,factor:{type:type as 'totp'|'passkey',phase:'requested',requestedAt:r.at}}});
}

export function confirmEnteFactorRecovery(data:CurrentDataset,t:EnteTask,r:EnteReceipt):CurrentDataset{
  const root=enteRecoveryRoot(data,t),factor=t.recoveryStateV1?.factor;if(!root||!factor)throw Error('ente-factor-not-requested');
  let next=data;
  if(factor.type==='totp'&&factor.phase!=='recovered'){
    const affected=new Set(next.securityModel.entities.filter(e=>e.kind==='credential'&&e.credentialType==='totp'&&e.subjectRef===root.rootRef&&e.roles.includes('second-step')).map(e=>e.id));
    next={...next,securityModel:{...next.securityModel,lifecycle:{...next.securityModel.lifecycle,...Object.fromEntries([...affected].map(id=>[id,{...next.securityModel.lifecycle[id],state:'revoked' as const,evidence:'user-confirmed' as const,updatedAt:r.at,accessResetAt:r.at}]))}}};
    const store=enteStore(next)!;
    for(const action of next.actions){
      if(action.targetId!==root.rootRef||action.controlId!=='mfa'||typeof action.enteReceiptRef!=='string')continue;
      if(store.proofs.some(p=>p.directReceiptRef===action.enteReceiptRef&&next.securityModel.facts.some(f=>f.id===p.factRef&&f.requiredRefs.some(id=>affected.has(id)))))next=undoControl(next,action.id,root.rootRef,'mfa',{state:'unknown',evidence:'not-assessed'},r.at) as CurrentDataset;
    }
  }
  // Recovering a passkey login does not delete registered passkeys. The server
  // consumes that login session without disabling TOTP or removing passkeys.
  return putEnteTask(next,{...enteTask(next,t.id)!,recoveryStateV1:{...t.recoveryStateV1,version:1,factor:{...factor,phase:'recovered',recoveredAt:factor.recoveredAt??r.at}}});
}

export function recordEnteRecoveryRead(data:CurrentDataset,t:EnteTask,r:EnteReceipt):CurrentDataset{
  const root=enteRecoveryRoot(data,t),source=data.securityModel.entities.find(e=>e.id===t.appRef),deviceRef=t.answers['recovery-place']==='app'&&source?.kind==='installation'?source.deviceRef:t.newDeviceRef;
  if(!root?.passwordRef||!deviceRef)throw Error('ente-recovery-read-scope');
  const factorRef=t.resources.recoveryFactor;
  const factorInputs=factorRef?enteRecoveryFactorInputs(data,root.rootRef,factorRef):[];if(!factorInputs)throw Error('ente-recovery-factor-unavailable');
  const mail=t.stepwiseSignInV1===1&&t.answers['signin/recovery/entry']==='email'?t.resources.recoveryMail:undefined;
  const refs=[root.rootRef,deviceRef,root.passwordRef,...factorInputs,...(mail?[mail]:[]),...(t.answers['recovery-used-factor']==='recovery'&&root.recoveryRef?[root.recoveryRef]:[])];
  const sourceApp=data.securityModel.entities.find(e=>e.id===t.appRef),without=t.answers['recovery-place']==='web'&&sourceApp?.kind==='installation'&&sourceApp.deviceRef!==deviceRef?[sourceApp.deviceRef,...(t.stepwiseSignInV1===1&&!refs.includes(sourceApp.id)?[sourceApp.id]:[])]:[];
  let next=data;
  if(factorRef){const credential=data.securityModel.entities.find(e=>e.id===factorRef);if(credential?.kind!=='credential'||credential.subjectRef!==root.rootRef||!['totp','passkey'].includes(credential.credentialType))throw Error('ente-recovery-factor-mismatch');
    next=recordEnteProof(next,r,{kind:credential.credentialType==='passkey'?'account-passkey':'account-auth',rootRef:root.rootRef,rootEpoch:root.epoch},{targetRef:root.rootRef,purpose:'second-step',context:'no-existing-session',requiredRefs:refs.filter(ref=>ref!==root.passwordRef),withoutRefs:without,label:'Ente additional authentication after recovery'},['entePasskey','enteRecovery']);
    next=recordEnteControl(next,r,root.rootRef,'mfa');
  }
  for(const purpose of ['sign-in','decrypt'] as const)next=recordEnteProof(next,r,{kind:purpose==='sign-in'?'account-auth':'account-read',rootRef:root.rootRef,rootEpoch:root.epoch},{targetRef:root.rootRef,purpose,context:'no-existing-session',requiredRefs:refs,withoutRefs:without,label:purpose==='sign-in'?'Ente Account sign-in after recovery':'Ente Account data read after recovery'},['enteRecovery','entePasskey','enteSharedSource']);
  if(factorRef)next=recordEnteLink(next,r,factorRef,root.rootRef,'authenticates-to',['enteRecovery']);
  return next;
}

export function enteRecoveryPasswordCurrent(data:Dataset,t:EnteTask):boolean{
  const root=enteRecoveryRoot(data,t),state=t.recoveryStateV1?.password;
  return !!root&&state?.phase==='applied'&&root.passwordRef===state.candidateRef&&root.epoch===state.appliedEpoch;
}

export function enteRecoveredForParent(data:Dataset,parent:EnteTask):boolean{
  if(data.version!==2)return false;const store=enteStore(data),root=store?.roots.find(r=>r.rootRef===(parent.rootRef??enteConfiguration(data,parent.appRef)?.rootRef)),app=data.securityModel.entities.find(e=>e.id===parent.appRef);
  if(!store||!root||app?.kind!=='installation')return false;
  return store.tasks.some(t=>t.kind==='recovery'&&t.status==='completed'&&enteParentTask(data,t.id)?.id===parent.id&&enteRecoveryPasswordCurrent(data,t))&&store.proofs.some(p=>p.kind==='account-read'&&p.rootRef===root.rootRef&&data.securityModel.facts.some(f=>f.id===p.factRef&&f.requiredRefs.includes(app.deviceRef)&&f.requiredRefs.includes(root.passwordRef??'')&&f.requiredRefs.some(ref=>data.securityModel.entities.some(e=>e.id===ref&&e.kind==='credential'&&e.subjectRef===root.rootRef&&['passkey','totp'].includes(e.credentialType)&&e.roles.includes('second-step')))&&enteFactCurrent(data.securityModel,f)&&data.securityModel.routes.some(r=>r.requirements.kind==='fact'&&r.requirements.factId===f.id&&evaluateAccess(data.securityModel,r.id,{context:'no-existing-session',now:new Date().toISOString()}).state==='available')));
}
