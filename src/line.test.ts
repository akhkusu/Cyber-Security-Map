import { describe, it, expect } from 'vitest';
import { makeAsset, newDataset, currentDatasetSchema, DataUpgradeConflict, type CurrentDataset } from './models';
import { createEncryptedVault, decryptVault } from './crypto';
import { startPhoneWorkflow, jumpPhoneStep, confirmPhoneStep, phoneBlockingSteps } from './phoneEngine';
import { phoneSteps } from './phoneCatalog';
import { startPhoneProducts, addPhoneProduct, reviewPhoneProducts, withdrawPhoneProduct } from './lineData';
import { lineStore, lineTask, lineMoveReady, lineRecorded, phoneProductsReady, lineReceiptCurrent } from './lineSchemas';
import { currentLineStep } from './lineCatalog';
import { answerLine, confirmLine, jumpLine, undoLineReceipt, lineHelpPrompt } from './lineEngine';
import { mapConnections, mapAffectedItems } from './securityMapViews';
import { evaluateAccess } from './securityModel';
import { canBeMailAccount } from './accountRoles';
import { emailRecipe } from './guideCatalog';
import { removeEntry } from './removeEntry';
import {startProtectionGuide} from './deviceProtection';
import {startAccessPlan} from './accessPlans';
import {setMapArchive} from './mapRecords';

export function lineFixture(oldOS: 'ios'|'android'='ios', newOS: 'ios'|'android'='ios', planned=false) {
  let data=newDataset('ja'); data.assets=['old','fresh'].map(id=>({...makeAsset({kind:'device',type:'Smartphone',name:id==='old'?'旧スマホ':'新スマホ',operatingSystem:id==='old'?oldOS:newOS,importance:'critical'}),id}));
  data.guide={...data.guide,cursor:'manager-select',history:['start','provider'],answers:{private:'leave main alone'},steps:{unrelated:{status:'done',updatedAt:new Date().toISOString()}}};
  data=startPhoneWorkflow(data,'/guide','old','phone');Object.assign(data.deviceWorkflows[0],{newDeviceRef:planned?undefined:'fresh',answers:{stage:planned?'planning':'using',availability:'available',ownership:'personal',setup:'ready',authenticator:'none','special-apps':'yes','phone-line':'no-line','old-fate':'sell','ios-generation':'18','sale-theft-menu':'older','android-maker':'pixel'}});
  const inventory=startPhoneProducts(data,'phone');data=addPhoneProduct(inventory.data,inventory.id,'line');data=reviewPhoneProducts(data,inventory.id) as CurrentDataset;
  return {data,inventoryRef:inventory.id,id:lineStore(data)!.tasks[0].id};
}
export function driveLine(data:CurrentDataset,id:string,answers:Record<string,string>={},until?:string) {
  for(let i=0;i<160;i++){
    const t=lineTask(data,id)!,s=currentLineStep(data,t);if(s.id===until||['finished','prepared','blocked'].includes(s.kind))return data;
    let next:CurrentDataset;
    if(s.kind==='question'){
      const defaults:Record<string,string>={account:'add','destination-state':'login','new-version':'current','source-state':'usable',version:'current','recovery-email':'available','recovery-mail':'add','recovery-provider':'google','password-access':'known',history:'recent','destination-match':'yes','cutover-result':'home','number-changed':'no','premium-state':'using','pin-state':'ready'};
      const value=answers[s.id]??(s.id.startsWith('restore-screen:')?'home':['source-app','previous-app'].includes(s.id)?s.choices![0].value:s.id==='backup-account'?data.assets.find(a=>a.id===t.oldDeviceRef)?.operatingSystem==='ios'?'add:apple':'add:google':defaults[s.id]);if(!value)throw Error('Missing test choice '+s.id);
      next=answerLine(data,id,value) as CurrentDataset;
    }else next=confirmLine(data,id) as CurrentDataset;
    if(next===data)throw Error('No progress '+s.id);
    const valid=currentDatasetSchema.safeParse(next);if(!valid.success)throw Error(s.id+' '+JSON.stringify(valid.error.issues));data=next;
  }throw Error('LINE did not finish');
}
describe('personal LINE phone moves',()=>{
  it.each([['ios','ios'],['ios','android'],['android','ios'],['android','android']] as const)('moves selected recent history %s → %s without completing MFA or retiring the old phone',(oldOS,newOS)=>{
    const f=lineFixture(oldOS,newOS),main=structuredClone(f.data.guide);let d=driveLine(f.data,f.id);const t=lineTask(d,f.id)!;
    expect(currentLineStep(d,t).id).toBe('finished');expect(lineMoveReady(d,t)).toBe(true);expect(phoneProductsReady(d,'phone')).toBe(true);
    expect(d.securityModel.lifecycle[t.sourceSessionRef!].state).toBe('revoked');expect(d.securityModel.lifecycle.old).toBeUndefined();expect(d.guide).toEqual(main);
    expect(d.assets.find(a=>a.id===t.accountRef)!.controls.mfa).toBe('unknown');expect(canBeMailAccount(d.assets.find(a=>a.id===t.accountRef)!)).toBe(false);expect(emailRecipe('line','web').steps).toHaveLength(0);
    expect(phoneSteps(d,d.deviceWorkflows[0]).some(s=>s.id===`signin:${t.accountRef}`)).toBe(false);
    expect(mapConnections(d).some(r=>r.recoveryAssetId===t.destinationSessionRef&&r.assetId===t.accountRef)).toBe(true);
    for(const route of d.securityModel.routes.filter(r=>r.targetRef===t.accountRef||r.targetRef===t.dataRef))expect(evaluateAccess(d.securityModel,route.id,{context:'new-device',now:new Date().toISOString(),unavailableRefs:['old']}).state).toBe('available');
    expect(mapAffectedItems(d,'old','ja').some(a=>a.id===t.accountRef)).toBe(false);
    const count=d.securityModel.entities.length;d=confirmLine(jumpLine(d,f.id,'new-account'),f.id) as CurrentDataset;expect(d.securityModel.entities).toHaveLength(count);
  });
  it('separates selection, source use, backup and new-phone proof',()=>{
    const f=lineFixture();let d=answerLine(f.data,f.id,'add') as CurrentDataset;const t=lineTask(d,f.id)!;
    expect(d.securityModel.facts).toHaveLength(0);expect(d.securityModel.relations).toHaveLength(0);expect(lineMoveReady(d,t)).toBe(false);
    d=driveLine(d,f.id,{},'transfer-ready');expect(lineTask(d,f.id)!.cutover).toBeUndefined();expect(d.securityModel.facts).toHaveLength(0);expect(phoneProductsReady(d,'phone')).toBe(false);
    const old=lineTask(d,f.id)!.sourceSessionRef;d=confirmLine(d,f.id) as CurrentDataset;expect(lineTask(d,f.id)!.cutover?.phase).toBe('requested');expect(d.securityModel.lifecycle[old!]).toBeUndefined();
    d=driveLine(d,f.id,{},'data-read');expect(lineTask(d,f.id)!.cutover?.phase).toBe('applied');expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(false);
  });
  it('keeps an unrelated product unfinished after LINE succeeds, including direct erase attempts',()=>{
    const f=lineFixture();let d=addPhoneProduct(f.data,f.inventoryRef,'eid');d=reviewPhoneProducts(d,f.inventoryRef) as CurrentDataset;d=driveLine(d,f.id);
    expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(phoneProductsReady(d,'phone')).toBe(false);
    for(const a of d.assets.filter(a=>a.kind==='account'&&a.provider!=='line'))d.deviceWorkflows[0].answers[`use:${a.id}`]='elsewhere';
    for(const step of phoneSteps(d,d.deviceWorkflows[0]))if(step.kind==='action'&&!step.productPhoneRef)d=confirmPhoneStep(jumpPhoneStep(d,'phone',step.id),'phone') as CurrentDataset;
    expect(phoneBlockingSteps(d,d.deviceWorkflows[0]).some(s=>s.productPhoneRef==='phone')).toBe(true);
    const erase=jumpPhoneStep(d,'phone','erase-old');expect(confirmPhoneStep(erase,'phone')).toBe(erase);expect(d.securityModel.lifecycle.old).toBeUndefined();
  });
  it('withdraws child proof without resurrecting the old LINE or another app',()=>{
    const f=lineFixture();let d=driveLine(f.data,f.id);const t=lineTask(d,f.id)!,oldReset=structuredClone(d.securityModel.lifecycle[t.sourceSessionRef!]);
    d=confirmPhoneStep(jumpPhoneStep(d,'phone','special-app-move'),'phone') as CurrentDataset;
    d=undoLineReceipt(d,f.id,t.records['data-read']) as CurrentDataset;expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(false);expect(phoneProductsReady(d,'phone')).toBe(false);
    expect(d.securityModel.lifecycle[t.sourceSessionRef!]).toEqual(oldReset);expect(lineTask(d,f.id)!.cutover?.phase).toBe('applied');expect(d.securityModel.lifecycle.old).toBeUndefined();
    expect(currentLineStep(d,lineTask(d,f.id)!).id).toBe('cutover-result');d=driveLine(d,f.id);expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(d.securityModel.lifecycle[t.sourceSessionRef!]).toEqual(oldReset);
  });
  it('resumes an uncertain native cutover from encrypted storage without repeating or inventing success',async()=>{
    const f=lineFixture();let d=driveLine(f.data,f.id,{},'transfer-ready');d=confirmLine(d,f.id) as CurrentDataset;const before=structuredClone(d);
    const {envelope}=await createEncryptedVault('test storage phrase for LINE records',d);d=(await decryptVault(envelope,'test storage phrase for LINE records')).data as CurrentDataset;
    expect(d).toEqual(before);expect(currentLineStep(d,lineTask(d,f.id)!).id).toBe('native-login');d=confirmLine(d,f.id) as CurrentDataset;d=answerLine(d,f.id,'waiting') as CurrentDataset;
    expect(currentLineStep(d,lineTask(d,f.id)!).kind).toBe('blocked');expect(lineTask(d,f.id)!.cutover?.phase).toBe('requested');expect(phoneProductsReady(d,'phone')).toBe(false);
    expect(d.securityModel.facts).toHaveLength(0);expect(d.securityModel.lifecycle.old).toBeUndefined();
  });
  it.each(['ios','android'] as const)('records actual Standard Backup separately from restoration on %s',os=>{
    const f=lineFixture(os,os),d=driveLine(f.data,f.id,{history:'text'}),t=lineTask(d,f.id)!;
    expect(lineMoveReady(d,t)).toBe(true);expect(t.backupRef).toBeTruthy();expect(d.securityModel.entities.find(e=>e.id===t.backupRef)?.label).toContain('文章のバックアップ');
    const root=t.answers['backup-account'].slice(8);expect(d.assets.find(a=>a.id===root)?.provider).toBe(os==='ios'?'apple':'google');expect(mapConnections(d).some(r=>r.recoveryAssetId===t.backupRef&&r.assetId===root)).toBe(true);
  });
  it('requires an existing completed Premium backup for older cross-OS history',()=>{
    const f=lineFixture('ios','android');const no=driveLine(f.data,f.id,{history:'all','premium-state':'no'});expect(currentLineStep(no,lineTask(no,f.id)!).id).toBe('premium-needed');expect(lineTask(no,f.id)!.cutover).toBeUndefined();
    const done=driveLine(f.data,f.id,{history:'all'});expect(lineMoveReady(done,lineTask(done,f.id)!)).toBe(true);expect(done.securityModel.entities.find(e=>e.id===lineTask(done,f.id)!.backupRef)?.label).toContain('プレミアム');
  });
  it('checks an already-used new phone without requiring the old LINE session',()=>{
    const f=lineFixture(),d=driveLine(f.data,f.id,{'destination-state':'same',history:'text'}),t=lineTask(d,f.id)!;
    expect(lineMoveReady(d,t)).toBe(true);expect(t.sourceAppRef).toBeUndefined();expect(t.records['source-account']).toBeUndefined();expect(t.backupRef).toBeUndefined();expect(t.records['native-login']).toBeUndefined();
  });
  it('does not create an actual new phone or migration proof while planning',()=>{
    const f=lineFixture('ios','ios',true);let d=driveLine(f.data,f.id),t=lineTask(d,f.id)!;
    expect(currentLineStep(d,t).id).toBe('prepared');expect(t.newDeviceRef).toBeUndefined();expect(t.cutover).toBeUndefined();expect(d.securityModel.facts).toHaveLength(0);
    const backup=t.records['backup-result'];d={...d,deviceWorkflows:d.deviceWorkflows.map(w=>({...w,newDeviceRef:'fresh',answers:{...w.answers,stage:'using'}}))};const next=startPhoneProducts(d,'phone');d=next.data;
    expect(next.id).toBe(f.inventoryRef);t=lineTask(d,f.id)!;expect(t.records['backup-result']).toBe(backup);expect(t.newDeviceRef).toBe('fresh');expect(currentLineStep(d,t).id).toBe('destination-state');
    d=driveLine(d,f.id);expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);
  });
  it('does not reuse a completed task after the parent selects another new phone',()=>{
    const f=lineFixture();let d=driveLine(f.data,f.id);const t=structuredClone(lineTask(d,f.id)!);d.assets.push({...d.assets[1],id:'different',name:'同じ呼び名'});d.deviceWorkflows[0].newDeviceRef='different';
    expect(phoneProductsReady(d,'phone')).toBe(false);const next=startPhoneProducts(d,'phone');expect(next.id).not.toBe(f.inventoryRef);expect(lineTask(next.data,f.id)).toEqual(t);
  });
  it('stops wrong-account confirmation before the native switch',()=>{
    const f=lineFixture(),d=driveLine(f.data,f.id,{'destination-match':'no'}),t=lineTask(d,f.id)!;
    expect(currentLineStep(d,t).id).toBe('wrong-account');expect(t.cutover).toBeUndefined();expect(d.securityModel.facts).toHaveLength(0);
  });
  it('does not bypass missing old access, password access, versions or changed numbers',()=>{
    const cases=[['source-state','unavailable','source-unavailable'],['password-access','missing','password-needed'],['new-version','other','new-version-needed'],['number-changed','yes','number-update']] as const;
    for(const [key,value,blocked] of cases){const f=lineFixture(),d=driveLine(f.data,f.id,{[key]:value});expect(currentLineStep(d,lineTask(d,f.id)!).id).toBe(blocked);expect(phoneProductsReady(d,'phone')).toBe(false);}
  });
  it('keeps known LINE usage and unfinished items from being withdrawn as a selection mistake',()=>{
    const f=lineFixture();let d=driveLine(f.data,f.id,{},'transfer-ready');const item=lineStore(d)!.inventories[0].items[0];expect(withdrawPhoneProduct(d,f.inventoryRef,item.id)).toBe(d);
    d.deviceWorkflows[0].answers['special-apps']='none';for(const a of d.assets.filter(a=>a.kind==='account'&&a.provider!=='line'))d.deviceWorkflows[0].answers[`use:${a.id}`]='elsewhere';expect(phoneSteps(d,d.deviceWorkflows[0]).some(s=>s.productPhoneRef==='phone')).toBe(true);expect(phoneProductsReady(d,'phone')).toBe(false);
  });
  it('does not reuse proof after the new phone is reset or retired',()=>{
    const f=lineFixture(),d=driveLine(f.data,f.id);d.securityModel.lifecycle.fresh={state:'retired',evidence:'user-confirmed',updatedAt:new Date().toISOString(),accessResetAt:new Date().toISOString()};
    expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(false);const check=jumpLine(d,f.id,'data-read');expect(confirmLine(check,f.id)).toBe(check);
  });
  it('preserves previous revisions, opaque fields, ordinary guide records and deletion guards',()=>{
    for(let revision=1;revision<=12;revision++){const f=lineFixture();const original=newDataset('ja');original.assets=structuredClone(f.data.assets.filter(a=>a.kind==='device'));original.guide={...original.guide,answers:{opaque:'kept'}};original.securityModel={...original.securityModel,revision:revision as CurrentDataset['securityModel']['revision'],opaque:{kept:true}};const phone=startPhoneWorkflow(original,'/guide','old','legacy');const next=startPhoneProducts(phone,'legacy').data;expect(next.guide).toEqual(original.guide);expect(next.securityModel.opaque).toEqual({kept:true});expect(next.securityModel.revision).toBe(13);expect(currentDatasetSchema.safeParse(next).success).toBe(true);}
    const f=lineFixture(),d=driveLine(f.data,f.id);expect(removeEntry(d,lineTask(d,f.id)!.accountRef!)).toBeUndefined();
    const foreign=newDataset();foreign.securityModel={...foreign.securityModel,revision:12,linePhoneV1:{opaque:'do not overwrite'}};const parent=startPhoneWorkflow(foreign,'/guide');expect(()=>startPhoneProducts(parent,parent.deviceWorkflows[0].id)).toThrow(DataUpgradeConflict);
  });
  it('bounds receipt cycles and rejects invalid cross-account or cross-device state',()=>{
    const f=lineFixture(),d=driveLine(f.data,f.id),s=lineStore(d)!,t=lineTask(d,f.id)!;const receipt=s.receipts.find(r=>r.id===t.records['data-read'])!;receipt.requires.push(receipt.id);expect(lineReceiptCurrent(s,receipt.id)).toBe(false);
    const bad=structuredClone(d);(bad.securityModel.linePhoneV1 as typeof s).tasks[0].destinationSessionRef=t.sourceSessionRef;expect(currentDatasetSchema.safeParse(bad).success).toBe(false);
  });
  it('copies only allowlisted context, never private labels, raw answers or secrets',()=>{
    const f=lineFixture();f.data.assets[0].name='PRIVATE PHONE NAME';let d=driveLine(f.data,f.id,{},'native-login');const t=lineTask(d,f.id)!;t.answers.sensitive='PRIVATE TOKEN';d.securityModel.linePhoneV1={...lineStore(d),tasks:[t]};
    const prompt=lineHelpPrompt(d,f.id,0,'ja');expect(prompt).toContain('Service: LINE');expect(prompt).toContain('https://help.line.me/');expect(prompt).not.toContain('PRIVATE');expect(prompt).toContain('一度に一つ');
    expect(lineRecorded(d,t,'new-account')).toBe(false);
  });
  it('leaves chat preservation unconfirmed for account-only scope, without inventing a messages read proof',()=>{
    const f=lineFixture(),d=driveLine(f.data,f.id,{history:'none'}),t=lineTask(d,f.id)!;
    expect(lineMoveReady(d,t)).toBe(true);expect(t.dataRef).toBeUndefined();expect(t.backupRef).toBeUndefined();expect(lineStore(d)!.proofs.some(p=>p.kind==='read')).toBe(false);
  });
  it('follows actual restoration screens one operation at a time without treating a running restore as readable data',()=>{
    const f=lineFixture('android','android'),answers={history:'text','cutover-result':'restore','restore-screen:0':'cloud','restore-screen:1':'restore','restore-screen:2':'pin','restore-screen:3':'progress','restore-screen:4':'home'};
    let d=driveLine(f.data,f.id,answers,'restore-operation:3');expect(lineRecorded(d,lineTask(d,f.id)!,'data-read')).toBe(false);expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(false);
    d=driveLine(d,f.id,answers);expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(lineRecorded(d,lineTask(d,f.id)!,'restore-operation:2')).toBe(true);
    const other=driveLine(f.data,f.id,{...answers,'restore-screen:0':'other'});expect(currentLineStep(other,lineTask(other,f.id)!).kind).toBe('blocked');
  });
  it('reuses an explicitly identified unclassified account, and keeps another same-name account separate',()=>{
    const f=lineFixture();f.data.assets.push({...makeAsset({kind:'account',type:'Account',name:'同じ名前',importance:'important'}),id:'unclassified',provider:'other',opaque:'kept'});
    let d=answerLine(f.data,f.id,'account:unclassified') as CurrentDataset;expect(lineTask(d,f.id)!.accountRef).toBe('unclassified');expect(d.assets.find(a=>a.id==='unclassified')!.opaque).toBe('kept');expect(d.securityModel.facts).toHaveLength(0);
    d=driveLine(d,f.id);d=addPhoneProduct(d,f.inventoryRef,'line');const second=lineStore(d)!.tasks.at(-1)!;expect(currentLineStep(d,second).choices!.some(c=>c.value==='account:unclassified')).toBe(false);
    d=answerLine(d,second.id,'add') as CurrentDataset;const other=lineTask(d,second.id)!;d.assets.find(a=>a.id===other.accountRef)!.name='同じ名前';expect(other.accountRef).not.toBe('unclassified');expect(lineMoveReady(d,other)).toBe(false);expect(phoneProductsReady(d,'phone')).toBe(false);
  });
  it('keeps revision13 and LINE history when older guide features write their records',()=>{
    const f=lineFixture(),d=driveLine(f.data,f.id),before=structuredClone(lineStore(d)),t=lineTask(d,f.id)!;
    const next=setMapArchive(startAccessPlan(startProtectionGuide(d,'fresh').data,t.accountRef!).data,t.destinationAppRef!,true);
    expect(next.securityModel.revision).toBe(13);expect(lineStore(next)).toEqual(before);expect(currentDatasetSchema.safeParse(next).success).toBe(true);
  });
  it('corrects the registered mailbox without discarding a completed unrelated chat backup',()=>{
    const f=lineFixture();let d=driveLine(f.data,f.id,{history:'text'},'transfer-ready'),t=lineTask(d,f.id)!;
    const backup=t.records['backup-result'],backupRef=t.backupRef,mail={...makeAsset({kind:'account',type:'Primary email',name:'別の登録メール',importance:'critical'}),provider:'proton' as const,services:['mail' as const]};d.assets.push(mail);
    d=answerLine(jumpLine(d,f.id,'recovery-mail'),f.id,`account:${mail.id}`) as CurrentDataset;t=lineTask(d,f.id)!;
    expect(t.records['backup-result']).toBe(backup);expect(lineRecorded(d,t,'backup-result')).toBe(true);expect(t.backupRef).toBe(backupRef);expect(lineRecorded(d,t,'future-access')).toBe(false);
    d=driveLine(d,f.id,{history:'text'});expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(lineTask(d,f.id)!.recoveryMailRef).toBe(mail.id);
    expect(mapConnections(d).filter(r=>r.assetId===t.accountRef&&r.relation==='recovers').map(r=>r.recoveryAssetId)).toEqual([mail.id]);
  });
  it('reconfirms an added mailbox after undo without creating another account or repeating its backup',()=>{
    const f=lineFixture();let d=driveLine(f.data,f.id,{history:'text'},'transfer-ready');const before=lineTask(d,f.id)!,count=d.assets.length;
    d=undoLineReceipt(d,f.id,before.records['recovery-mail']) as CurrentDataset;
    d=answerLine(jumpLine(d,f.id,'recovery-mail'),f.id,'add') as CurrentDataset;
    d=answerLine(jumpLine(d,f.id,'recovery-provider'),f.id,'google') as CurrentDataset;
    expect(d.assets).toHaveLength(count);expect(lineTask(d,f.id)!.recoveryMailRef).toBe(before.recoveryMailRef);expect(lineRecorded(d,lineTask(d,f.id)!,'backup-result')).toBe(true);
    d=driveLine(d,f.id,{history:'text'});expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);
  });
  it('corrects current readable-data scope after the switch without repeating login or resurrecting the old session',()=>{
    const f=lineFixture();let d=driveLine(f.data,f.id);const before=lineTask(d,f.id)!,reset=structuredClone(d.securityModel.lifecycle[before.sourceSessionRef!]),signins=lineStore(d)!.proofs.filter(p=>p.kind==='sign-in').length;
    d=answerLine(jumpLine(d,f.id,'history'),f.id,'all') as CurrentDataset;expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(false);expect(lineTask(d,f.id)!.cutover).toEqual(before.cutover);
    d=driveLine(d,f.id,{history:'all'});expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(true);expect(lineTask(d,f.id)!.dataRef).not.toBe(before.dataRef);expect(lineTask(d,f.id)!.backupRef).toBeUndefined();
    expect(d.securityModel.lifecycle[before.sourceSessionRef!]).toEqual(reset);expect(lineStore(d)!.proofs.filter(p=>p.kind==='sign-in')).toHaveLength(signins);
  });
  it('keeps OS-specific proof historical when the same phone record is corrected to another OS',()=>{
    const f=lineFixture();let d=driveLine(f.data,f.id);const before=structuredClone(lineTask(d,f.id)!);d.assets.find(a=>a.id==='fresh')!.operatingSystem='android';
    expect(lineMoveReady(d,lineTask(d,f.id)!)).toBe(false);expect(phoneProductsReady(d,'phone')).toBe(false);const stale=jumpLine(d,f.id,'data-read');expect(confirmLine(stale,f.id)).toBe(stale);
    const next=startPhoneProducts(d,'phone');expect(next.id).not.toBe(f.inventoryRef);expect(lineTask(next.data,f.id)).toEqual(before);expect(currentDatasetSchema.safeParse(next.data).success).toBe(true);
  });
  it('ends only the known old main session for the same account when checking an already-used destination',()=>{
    const f=lineFixture();let d=driveLine(f.data,f.id,{},'transfer-ready');const old=lineTask(d,f.id)!,source=old.sourceSessionRef!;
    d=startPhoneWorkflow(d,'/guide','old','second-phone-task');Object.assign(d.deviceWorkflows.at(-1)!,{newDeviceRef:'fresh',answers:{stage:'using'}});
    const next=startPhoneProducts(d,'second-phone-task');d=reviewPhoneProducts(next.data,next.id) as CurrentDataset;const second=lineStore(d)!.tasks.at(-1)!;
    d=driveLine(d,second.id,{account:`account:${old.accountRef}`,'destination-state':'same'});
    expect(d.securityModel.lifecycle[source].state).toBe('revoked');expect(lineTask(d,second.id)!.records['source-account']).toBeUndefined();expect(d.securityModel.lifecycle.old).toBeUndefined();expect(phoneProductsReady(d,'second-phone-task')).toBe(true);expect(lineTask(d,f.id)!.records['source-account']).toBe(old.records['source-account']);
  });
  it('does not reuse source use or backup after choosing another LINE profile on the old phone',()=>{
    const f=lineFixture();let d=driveLine(f.data,f.id,{history:'text'},'transfer-ready'),t=lineTask(d,f.id)!;const source=t.sourceAppRef,backup=t.records['backup-result'];
    d.securityModel.entities.push({...d.securityModel.entities.find(e=>e.id===source)!,id:'other-line-profile',label:'別プロフィールのLINE'});
    d=answerLine(jumpLine(d,f.id,'source-app'),f.id,'app:other-line-profile') as CurrentDataset;t=lineTask(d,f.id)!;
    expect(lineRecorded(d,t,'source-account')).toBe(false);expect(lineRecorded(d,t,'backup-result')).toBe(false);expect(t.backupRef).toBeUndefined();expect(t.cutover).toBeUndefined();
    d=driveLine(d,f.id,{history:'text'});t=lineTask(d,f.id)!;expect(t.sourceAppRef).toBe('other-line-profile');expect(t.records['backup-result']).not.toBe(backup);expect(lineMoveReady(d,t)).toBe(true);
  });
  it('does not repurpose the main guide’s unclassified email account as a LINE account',()=>{
    const f=lineFixture(),mail={...makeAsset({kind:'account',type:'Account',name:'主メールの記録',importance:'critical'}),provider:'other' as const};f.data.assets.push(mail);f.data.guide.accountId=mail.id;
    expect(currentLineStep(f.data,lineTask(f.data,f.id)!).choices!.some(c=>c.value===`account:${mail.id}`)).toBe(false);expect(answerLine(f.data,f.id,`account:${mail.id}`)).toBe(f.data);
  });
});
