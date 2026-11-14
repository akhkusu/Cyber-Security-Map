import type {Dataset} from './models';
import {c,type Copy,type Source} from './guideCatalog';
import type {ProtectionFeature,ProtectionTask,ProtectionValue} from './deviceProtectionSchemas';

const source=(title:string,url:string,scope:string):Source=>({title,url,scope,checked:'2026-11-14',reviewMethod:'official-documentation'});
export const PROTECTION_SOURCES={
  appleFind:source('Apple · Turn on Find My','https://support.apple.com/ja-jp/102648','iPhone / iPad / settings and region differences'),
  appleFindUse:source('Apple · Find a device','https://support.apple.com/ja-jp/104978','Device list versus location and erase'),
  appleFindAccess:source('Apple · Find Devices access','https://support.apple.com/ja-jp/120837','iCloud.com/find / no ordinary 2FA-code requirement'),
  appleTheft:source('Apple · Stolen Device Protection','https://support.apple.com/ja-jp/120340','iPhone / iOS 17.3+ / prerequisites and delay'),
  appleFace:source('Apple · Face ID','https://support.apple.com/ja-jp/108411','Compatible iPhone / enrolled versus new face'),
  appleTouch:source('Apple · Touch ID','https://support.apple.com/ja-jp/102528','Compatible iPhone / actual sensor'),
  googleFind:source('Google · Be ready to find a device','https://support.google.com/accounts/answer/3265955?hl=ja','Google-enabled Android / some steps 14+ / main profile'),
  googleTheft:source('Google · Theft protection','https://support.google.com/android/answer/15146908?hl=ja','Supported Android phones / individual feature availability'),
  applePasscode:source('Apple · Device passcode','https://support.apple.com/ja-jp/119586','iPhone / iPad / preserve an existing strong code'),
  pixelLock:source('Google · Pixel screen lock','https://support.google.com/pixelphone/answer/2819522?hl=ja','Pixel / Security and privacy / Device unlock'),
  galaxyLock:source('Samsung · Screen lock','https://www.samsung.com/jp/support/mobile-devices/how-to-set-up-a-screen-lock-for-galaxy/','Galaxy / Lock screen and AOD / actual menu variant'),
  galaxyLockEn:source('Samsung · Screen lock (English)','https://www.samsung.com/us/support/answer/ANS10001343/','Galaxy / English / Screen lock type variant'),
  galaxyAccounts:source('Samsung · Account settings','https://www.samsung.com/au/support/mobile-devices/remove-accounts-and-screen-lock/','View account list only; no removal in this guide'),
  galaxyAccountsJa:source('Samsung · Galaxy Google Account settings','https://www.samsung.com/jp/support/mobile-devices/how-to-create-or-remove-the-google-account-on-your-galaxy-phone/','Japanese account-list labels only; no addition or removal in this guide'),
  googleLock:source('Google · Screen lock','https://support.google.com/android/answer/9079129?hl=ja','Android / device-specific settings'),
} satisfies Record<string,Source>;
export type ProtectionSource=keyof typeof PROTECTION_SOURCES;
export type ProtectionChoice={value:string;label:Copy};
export type ProtectionStep={
  id:string;kind:'question'|'text'|'multi'|'operation'|'check'|'blocked'|'finished';
  title:Copy;action:Copy;place?:Copy;expected?:Copy;button?:Copy;choices?:ProtectionChoice[];
  sources:ProtectionSource[];url?:string;urlLabel?:Copy;explanation?:Copy;
  diagram?:Copy[];
  recordValues?:string[];recordValueMap?:Record<string,ProtectionValue>;historical?:boolean;accountRecipe?:'email-mfa'|'recovery';value?:ProtectionValue;
  recordKind?:'navigation'|'prerequisite'|'configuration'|'management-use';
  feature?:ProtectionFeature;featureValues?:ProtectionValue[];requires?:string[];control?:'screenLock';
};
export const protectionChoice=(value:string,en:string,ja:string):ProtectionChoice=>({value,label:c(en,ja)});
export const protectionProvider=(task:ProtectionTask):'apple'|'google'|undefined=>['iphone','ipad'].includes(task.answers.form)?'apple':task.answers.form?.startsWith('android')?'google':undefined;
export const protectionFeatureLabel=(feature:ProtectionFeature):Copy=>({
  'device-location':c('Device location services','端末の位置情報サービス'),
  'significant-locations':c('Significant Locations','利用頻度の高い場所'),
  'device-biometrics':c('Working biometrics','使える生体認証'),
  'find-enabled':c('Device finding','端末を探す設定'),
  'find-offline':c('Offline finding','オフラインの探索'),
  'find-last-location':c('Send last location','最後の位置情報の送信'),
  'stolen-device-protection':c('Stolen Device Protection','盗難デバイスの保護'),
  'stolen-delay':c('When extra protection applies','追加の保護を適用する場所'),
  'theft-detection':c('Theft Detection Lock','盗難検出ロック'),
  'offline-lock':c('Offline Device Lock','オフライン デバイスロック'),
  'failed-auth-lock':c('Failed Authentication Lock','認証失敗時のロック'),
  'remote-lock':c('Remote Lock','リモートロック'),
  'remote-question':c('Remote Lock security question','リモートロックの秘密の質問'),
  'identity-check':c('Identity Check','ID チェック'),
})[feature];
export function protectionSources(task:ProtectionTask):ProtectionSource[]{
  const provider=protectionProvider(task);return provider==='apple'?['appleFind','appleFindUse','appleFindAccess','appleTheft']:provider==='google'?['googleFind','googleTheft','googleLock']:['appleFind','googleFind'];
}
export function protectionFormChoices(data:Dataset,task:ProtectionTask):ProtectionChoice[]{
  const device=data.assets.find(a=>a.id===task.deviceRef),os=device?.operatingSystem;
  return [
    ...(['ios','unknown','other',undefined].includes(os)?[protectionChoice('iphone','iPhone','iPhone'),protectionChoice('ipad','iPad','iPad')]:[]),
    ...(['android','unknown','other',undefined].includes(os)?[protectionChoice('android-phone','Android phone with Google services','GoogleサービスのあるAndroidスマホ'),protectionChoice('android-tablet','Android tablet with Google services','GoogleサービスのあるAndroidタブレット'),protectionChoice('android-go','Android Go phone','Android Goのスマホ'),protectionChoice('android-no-google','Android without Google services','GoogleサービスのないAndroid')]:[]),
    protectionChoice('other','Something else / not sure','上記以外・まだ分からない'),
  ];
}

export type ProtectionBuilder={
  steps:ProtectionStep[];
  question:(id:string,title:Copy,choices:ProtectionChoice[],action?:Copy,extra?:Partial<ProtectionStep>)=>boolean;
  text:(id:string,title:Copy)=>boolean;
  multi:(id:string,title:Copy,choices:ProtectionChoice[],action:Copy)=>boolean;
  operation:(id:string,title:Copy,place:Copy,action:Copy,expected:Copy,extra?:Partial<ProtectionStep>)=>void;
  check:(id:string,title:Copy,place:Copy,action:Copy,feature:ProtectionFeature,choices?:ProtectionChoice[],extra?:Partial<ProtectionStep>)=>boolean;
  blocked:(id:string,title:Copy,action:Copy,extra?:Partial<ProtectionStep>)=>void;
};
export const protectionRefValue=(ref:string)=>`ref:${encodeURIComponent(ref)}`;
export function protectionRefFromValue(value:string):string|undefined{if(!value.startsWith('ref:'))return;try{return decodeURIComponent(value.slice(4));}catch{return;}}
export const PROTECTION_BROWSERS=['chrome','edge','safari','firefox','chromium','browser-other'];
export const protectionBrowserCandidates=(data:Dataset,deviceRef:string)=>data.version===2?data.securityModel.entities.filter(e=>e.kind==='installation'&&e.deviceRef===deviceRef&&!e.mergedIntoRef&&PROTECTION_BROWSERS.some(p=>e.productId===p||e.productId===`browser.${p}`)):[];
export function makeProtectionBuilder(task:ProtectionTask):ProtectionBuilder{
  const steps:ProtectionStep[]=[],sources=protectionSources(task),answers=task.answers;
  const question:ProtectionBuilder['question']=(id,title,choices,action=c('Choose what applies to this actual device.','今回の実際の端末に当てはまるものを選んでください。'),extra={})=>{steps.push({id,kind:'question',title,action,choices,sources,...extra});return choices.some(o=>o.value===answers[id]);};
  const text:ProtectionBuilder['text']=(id,title)=>{steps.push({id,kind:'text',title,action:c('Use a short nickname only. Do not enter an address, phone number, serial number, password or code.','短い呼び名だけを使います。アドレス・電話番号・シリアル番号・パスワード・コードは入力しません。'),sources});return !!answers[id];};
  const multi:ProtectionBuilder['multi']=(id,title,choices,action)=>{steps.push({id,kind:'multi',title,action,choices,sources});return answers[id]==='confirmed';};
  const operation:ProtectionBuilder['operation']=(id,title,place,action,expected,extra={})=>steps.push({id,kind:'operation',title,place,action,expected,button:c('I checked this','確認しました'),recordKind:'navigation',sources,...extra});
  const check:ProtectionBuilder['check']=(id,title,place,action,feature,choices=[protectionChoice('on','It is on','オンを確認しました'),protectionChoice('off','I confirmed it is off and will leave it off','オフを確認し、今回はそのままにします'),protectionChoice('unsupported','This feature is unavailable','この機能を利用できません')],extra={})=>{steps.push({id,kind:'check',title,place,action,feature,choices,featureValues:choices.map(c=>c.value as ProtectionValue),expected:c('Check the current value in the official settings before choosing. Keep existing enabled protection.','正規の設定で現在の値を確認してから選びます。すでに有効な保護は残してください。'),recordKind:'configuration',sources,...extra});return choices.some(o=>o.value===answers[id]);};
  const blocked:ProtectionBuilder['blocked']=(id,title,action,extra={})=>steps.push({id,kind:'blocked',title,action,sources,...extra});
  return {steps,question,text,multi,operation,check,blocked};
}

export function appendProtectionIdentity(b:ProtectionBuilder,data:Dataset,task:ProtectionTask):boolean{
  const q=protectionChoice,a=task.answers;
  if(!b.question('available',c('Is this your device, in your hands?','本人の端末が、今手元にありますか？'),[q('yes','Yes, I can unlock it','手元にあり、解除できます'),q('missing','It is lost or already out of my hands','紛失・手放した後です'),q('locked','It is here, but I cannot unlock it','手元にありますが、解除できません')],c('Prepare finding and theft protection before losing a device. Another physical phone needs its own record.','探索と盗難保護は、端末を失う前に準備します。別の実物のスマホは、別の端末として記録します。')))return false;
  if(a.available!=='yes'){b.blocked('not-in-hand',c('Keep this setup unfinished','事前設定は未完了で残します'),c('This setup needs the actual unlocked device. Use the official device-management page for a device already lost. Do not erase a phone just to try this guide.','この事前設定には、解除できる実物が必要です。紛失済みの場合は公式の端末管理画面を使います。この案内を試すために初期化しないでください。'));return false;}
  if(!b.question('form',c('Which kind of device is this?','今回の端末はどれですか？'),protectionFormChoices(data,task)))return false;
  if(['other','android-no-google'].includes(a.form)){b.blocked('unsupported-form',c('This device needs a different recipe','この端末には別の手順が必要です'),c('This guide covers Apple Find My and Google-enabled Android. Keep this device and its existing protection. A missing recipe does not make its setup complete.','この案内はAppleの「探す」とGoogleサービスのあるAndroidが対象です。端末と現在の保護は残します。対応する手順がないことを、設定完了にはしません。'));return false;}
  if(a.form==='iphone'&&!b.question('apple-version',c('Is this iPhone on iOS 17.3 or later?','このiPhoneはiOS17.3以降ですか？'),[q('current','Yes, iOS 17.3 or later','iOS17.3以降です'),q('older','An older version / not checked','以前の版・未確認')],c('Stolen Device Protection requires iOS 17.3 or later. Check the version in Settings → General → About if needed. Finding can still be checked separately.','盗難デバイスの保護にはiOS17.3以降が必要です。必要なら「設定」→「一般」→「情報」で版を確認します。探索の設定は別に確認できます。')))return false;
  if(!b.question('ownership',c('Who manages this device?','この端末を管理しているのは？'),[q('personal','I manage my personal device','自分で管理する個人用の端末'),q('managed','Work or school manages it','仕事・学校が管理しています'),q('child','A parent or family manager','保護者・ファミリー管理者が管理しています')]))return false;
  if(a.ownership!=='personal'){b.blocked('managed',c('Keep the current management policy','現在の管理設定を残してください'),c('Managed and child-device permissions need their own recipe. Keep this task unfinished; do not remove profiles or existing account protection.','管理端末・子供用の権限は専用の手順が必要です。この作業は未完了で残し、管理プロファイルや既存の保護を外しません。'));return false;}
  if(protectionProvider(task)==='google'){
    if(!b.question('android-version',c('Is this device on Android 14 or later?','この端末はAndroid14以降ですか？'),[q('current','Yes, Android 14 or later','Android14以降です'),q('older','Older / not checked','以前の版・未確認')],c('This initial recipe uses the Android 14+ finding settings. Individual theft features still depend on the model and actual displayed options.','この初期手順ではAndroid14以降の探索設定を使います。盗難保護の各機能は、機種と実際に表示される選択肢でも判断します。')))return false;
    if(a['android-version']!=='current'){b.blocked('android-version-needed',c('Keep the existing settings while checking the version','版を確認する間、現在の設定を残します'),c('Keep the device and its current protection. This recipe does not confirm older-version settings, and does not require a reset.','端末と現在の保護は残します。この手順で以前の版の設定を確認済みにはせず、初期化も求めません。'));return false;}
    if(!b.question('android-maker',c('Which Android settings will you use?','どのAndroidの設定を使いますか？'),[q('pixel','Google Pixel','Google Pixel'),q('galaxy','Samsung Galaxy','Samsung Galaxy'),q('generic','Another Google-enabled Android','その他のGoogleサービスがあるAndroid')]))return false;
    if(!b.question('android-profile',c('Are you using the main owner profile?','端末のメインの所有者プロフィールですか？'),[q('owner','Yes, the main owner profile','メインの所有者プロフィールです'),q('other','Secondary user / work profile / unsure','別ユーザー・仕事用プロフィール・不明')],c('Google’s device-finding setup uses the main profile. A work profile or another user is a separate environment.','Googleの端末探索はメインのプロフィールで設定します。仕事用プロフィールや別のユーザーは、別の環境です。')))return false;
    if(a['android-profile']!=='owner'){b.blocked('other-profile',c('Use the actual owner profile','所有者のプロフィールを確認してください'),c('Keep the current user and its data. Do not remove profiles or switch account ownership to force this recipe.','現在のユーザーとデータは残します。この手順に合わせるためにプロフィールを削除したり、所有者を変更したりしません。'));return false;}
  }
  const provider=protectionProvider(task),accounts=data.assets.filter(x=>x.kind==='account'&&x.provider===provider);
  if(!b.question('account',c('Which actual account is on this device?','この端末で使う、実際のアカウントは？'),[...accounts.map(x=>({value:protectionRefValue(x.id),label:c(x.name,x.name)})),q('new','Record another actual personal account','別の実際の個人用アカウントを記録する')],c('Choose the account shown in this device’s settings.','この端末の設定に表示されているアカウントを選んでください。')))return false;
  if(a.account==='new'&&!b.text('account-label',c('Give this account a nickname','このアカウントの呼び名を付ける')))return false;
  const account=data.assets.find(x=>x.id===task.accountRef);
  if(account&&!account.purpose&&!b.question('account-purpose',c('Is this a personal account you manage?','このアカウントは、自分で管理する個人用ですか？'),[q('personal','Yes, my personal account','本人が管理する個人用です'),q('managed','Work, school or managed child account','仕事・学校・管理対象の子供用です')] ))return false;
  if(account&&(account.purpose==='work'||a['account-purpose']==='managed')){b.blocked('managed-account',c('This account needs its own policy','このアカウントには専用の手順が必要です'),c('This personal-device recipe does not replace work, school or child-account policies. Keep this account and its existing methods.','この個人用の手順で、仕事・学校・子供用アカウントの方針を置き換えません。現在のアカウントと認証方法を残してください。'));return false;}
  return !!task.accountRef;
}
