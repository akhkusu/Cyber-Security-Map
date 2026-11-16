import {expect,type Page} from '@playwright/test';
import {currentDatasetSchema,makeAsset,newDataset,type CurrentDataset} from '../src/models';
import {decryptVault} from '../src/crypto';
import {chooseAuthenticator,selectedAuthenticator} from '../src/authenticatorGuide';
import {completeStep,move} from '../src/guideEngine';
import {answerTwofas,confirmTwofas,currentTwofasStep,twofasTask,twofasStepRecorded} from '../src/twofasEngine';
import {twofasStore} from '../src/twofasSchemas';
import {startPhoneWorkflow,jumpPhoneStep,confirmPhoneStep} from '../src/phoneEngine';
import {passphrase,readSavedVault,sealRawVault,writeSavedVault,advance} from './helpers';
export const readTwofasData=async(page:Page)=>currentDatasetSchema.parse((await decryptVault(await readSavedVault(page),passphrase)).data);
export function initialTwofas(os:'ios'|'android'='ios',language:'ja'|'en'='ja'){
  const data=newDataset(language);data.assets=[{...makeAsset({kind:'account',type:'Primary email',name:'本人のProton',importance:'critical'}),id:'mail',provider:'proton',purpose:'personal'},...(['old','fresh'] as const).map(id=>({...makeAsset({kind:'device',type:'Smartphone',name:id==='old'?'これまでのスマホ':'新しいスマホ',importance:'critical',operatingSystem:os}),id}))];data.guide.accountId='mail';data.guide.cursor='do/mail/email-mfa/scan';return data;
}
export function phoneTwofasFixture(oldOS:'ios'|'android',newOS:'ios'|'android'){
  let data=chooseAuthenticator(initialTwofas(oldOS),'mail','2fas-auth','old','do/mail/email-mfa/scan'),appRef=selectedAuthenticator(data,'mail')!.id;const taskId=twofasStore(data)!.tasks[0].id;
  for(let i=0;i<30&&twofasTask(data,taskId)!.status!=='completed';i++){const s=currentTwofasStep(data,twofasTask(data,taskId)!);data=(s.kind==='question'?answerTwofas(data,taskId,s.id==='version'?'supported':'on'):confirmTwofas(data,taskId)) as CurrentDataset;}
  const app=selectedAuthenticator(data,'mail')!;data.guide.answers[`auth:mail:input:${app.id}`]='camera';
  for(const cursor of ['do/mail/email-mfa/scan','do/mail/email-mfa/confirm','do/mail/email-mfa/verify'])data=completeStep(move(data,cursor)) as CurrentDataset;
  data.assets=data.assets.map(a=>a.id==='fresh'?{...a,operatingSystem:newOS}:a);data.guide={...data.guide,cursor:'manager-select',history:['start','provider'],answers:{...data.guide.answers,original:'main guide remains exactly'}};
  const main=structuredClone(data.guide);data=startPhoneWorkflow(data,'/guide','old','move');Object.assign(data.deviceWorkflows[0],{newDeviceRef:'fresh',answers:{stage:'using',availability:'available',ownership:'personal',authenticator:'none'}});
  data=confirmPhoneStep(jumpPhoneStep(data,'move','prepare-recovery'),'move') as CurrentDataset;data=jumpPhoneStep(data,'move',`auth:${appRef}:twofas`) as CurrentDataset;
  return {data,appRef,main};
}
export async function openTwofasData(page:Page,data:CurrentDataset){const ja=data.settings.language==='ja';await page.goto('./');await page.locator('.language-picker select').selectOption(data.settings.language);await writeSavedVault(page,await sealRawVault(data));await page.reload();await page.getByLabel(ja?'アプリの保存用パスフレーズ':'App passphrase',{exact:true}).fill(passphrase);await advance(page,ja?'開いて再開する':'Unlock and continue');}
export async function driveTwofasUI(page:Page,taskId:string,answers:Record<string,string>={},stopAt?:string){
  for(let i=0;i<160;i++){
    const data=await readTwofasData(page),task=twofasTask(data,taskId);if(!task)throw new Error('Saved 2FAS task missing');if(task.status==='completed')return data;
    const step=currentTwofasStep(data,task);await expect(page.locator('.twofas-content h1')).toHaveText(step.title[data.settings.language]);if(step.id===stopAt)return data;
    const card=page.locator('.twofas-content');
    if(step.kind==='question'){
      let value=answers[step.id];if(!value){if(step.id.includes('version'))value='supported';else if(step.id.endsWith('pin-state'))value='on';else if(step.id==='cloud-state')value='off';else if(step.id==='file-location')value='new-offline';else if(step.id==='destination')value='add';else if(step.id==='token-types')value='totp';else if(step.id==='new-state')value='missing';else if(step.id==='method')value='file';else if(step.id.startsWith('target-more:'))value='done';else if(step.id.endsWith('cross-share'))value='pixel';else if(step.id==='file-secret-mode')value='new';else if(step.id==='file-choice')value='new';else if(step.id==='present-origin')value='copy';else throw new Error(`Missing UI choice at ${step.id}`);}
      const choice=step.choices?.find(c=>c.value===value);if(!choice)throw new Error(`Choice ${value} missing at ${step.id}`);await card.getByRole('button',{name:choice.label[data.settings.language],exact:true}).click();
    }else if(step.kind==='action')await card.getByRole('button',{name:twofasStepRecorded(data,task,step.id)?(data.settings.language==='ja'?'この確認で続ける':'Continue with this confirmation'):step.button?.[data.settings.language]??(data.settings.language==='ja'?'確認しました':'I checked this'),exact:true}).click();
    else throw new Error(`Unexpected ${step.kind} at ${step.id}`);
    await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
  }throw new Error('2FAS UI did not finish');
}
