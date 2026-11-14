import {expect,type Page} from '@playwright/test';
import {makeAsset,newDataset,type CurrentDataset,type Language} from '../src/models';
import {startPhoneWorkflow,jumpPhoneStep} from '../src/phoneEngine';
import {startPhoneProducts,addPhoneProduct,reviewPhoneProducts} from '../src/lineData';
import {lineStore,lineTask,lineRecorded} from '../src/lineSchemas';
import {currentLineStep} from '../src/lineCatalog';
import {openTwofasData,readTwofasData} from './twofas-driver';
import {advance} from './helpers';
export function fixture(language:Language='ja',oldOS:'ios'|'android'='ios',newOS:'ios'|'android'='android',extra=false){
 let data=newDataset(language);data.assets=['old','fresh'].map(id=>({...makeAsset({kind:'device',type:'Smartphone',name:id==='old'?'これまでのスマホ':'新しいスマホ',operatingSystem:id==='old'?oldOS:newOS,importance:'critical'}),id}));
 data.guide={...data.guide,cursor:'manager-select',history:['start','provider'],answers:{original:'main guide remains exactly'}};
 data=startPhoneWorkflow(data,'/guide','old','move');Object.assign(data.deviceWorkflows[0],{newDeviceRef:'fresh',answers:{stage:'using',availability:'available',ownership:'personal',setup:'ready',authenticator:'none','special-apps':'yes','phone-line':'no-line','old-fate':'sell','ios-generation':'18','sale-theft-menu':'older','android-maker':'pixel'}});
 const i=startPhoneProducts(data,'move');data=addPhoneProduct(i.data,i.id,'line');if(extra)data=addPhoneProduct(data,i.id,'eid');data=reviewPhoneProducts(data,i.id) as CurrentDataset;data=jumpPhoneStep(data,'move','special-app-move') as CurrentDataset;
 return {data,id:lineStore(data)!.tasks[0].id,inventoryRef:i.id,main:structuredClone(data.guide)};
}
export async function open(page:Page,data:CurrentDataset,id:string){
 await openTwofasData(page,data);await page.getByRole('link',{name:data.settings.language==='ja'?'機種変更を再開する':'Resume phone-change task',exact:false}).first().click();await advance(page,data.settings.language==='ja'?'引き継ぐアプリ・サービスを確認する':'Open the apps to move');await page.locator(`a[href$="/line/${id}"]`).first().click();await expect(page.locator('.line-content')).toBeVisible();
}
export async function drive(page:Page,id:string,answers:Record<string,string>={},until?:string){
 for(let count=0;count<160;count++){
  const data=await readTwofasData(page),t=lineTask(data,id)!;if(!await page.locator('.line-content').count())return data;
  const s=currentLineStep(data,t),card=page.locator('.line-content'),lang=data.settings.language;await expect(card.locator('h1')).toHaveText(s.title[lang]);if(s.id===until)return data;
  if(s.kind==='question'){
   const defaults:Record<string,string>={account:'add','destination-state':'login','new-version':'current','source-state':'usable',version:'current','recovery-email':'available','recovery-mail':'add','recovery-provider':'google','access2:mail-state':'available','access2:mail-account':'add','access2:mail-provider':'google','access2:method':'password','access2:mail-editable':'yes','access2:mail-verification':'code','access2:key-version':'supported','access2:key-root':'add','access2:key-state':'existing','access2:key-record':'add','access2:key-result':'registered','transfer-method':'passkey','key-login:result':'passkey','key-move:pin-state':'ready','password-access':'known',history:'recent','destination-match':'yes','cutover-result':'home','number-changed':'no','premium-state':'using','pin-state':'ready'};
   const value=answers[s.id]??(s.id.startsWith('restore-screen:')?'home':['source-app','previous-app'].includes(s.id)?s.choices![0].value:s.id==='access2:store'?data.assets.find(a=>a.id===t.oldDeviceRef)?.operatingSystem==='ios'?'apple':'google':s.id==='backup-account'?data.assets.find(a=>a.id===t.oldDeviceRef)?.operatingSystem==='ios'?'add:apple':'add:google':defaults[s.id]);const option=s.choices?.find(c=>c.value===value);if(!option)throw Error(`Missing choice ${value} at ${s.id}`);await card.getByRole('button',{name:option.label[lang],exact:true}).click();
  }else if(s.kind==='action')await card.getByRole('button',{name:lineRecorded(data,t,s.id)?lang==='ja'?'この確認で続ける':'Continue with this confirmation':s.button?.[lang]??(lang==='ja'?'確認しました':'I checked this'),exact:true}).click();
  else if(s.kind==='finished'){await card.getByRole('button',{name:lang==='ja'?'機種変更の続きを進める':'Continue phone change',exact:true}).click();return await readTwofasData(page);}
  else throw Error('Unexpected '+s.id);
  await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
 }throw Error('LINE UI did not finish');
}
