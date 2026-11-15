import type {Dataset,Language} from './models';
import {isStandardManager} from './standardManagerAccounts';
import {onePasswordAccount} from './onePasswordAccount';
import {standardObservationValid,standardStore,standardContextReady} from './standardContexts';
import {standardVaultSchema,standardAppSchema} from './standardManagerSchemas';
import {standardMasterResume} from './standardMaster';
export function standardItem(data:Dataset,ref:string){const a=data.assets.find(a=>a.id===ref);if(isStandardManager(a))return true;const e=data.version===2?data.securityModel.entities.find(e=>e.id===ref):undefined;return !!e&&(e.kind==='vault'&&standardVaultSchema.safeParse(e.standardVaultV1).success||e.kind==='installation'&&standardAppSchema.safeParse(e.standardAppV1).success);}
export function standardMapStatus(data:Dataset,ref:string,language:Language){
 const subjectChange=data.guide.steps[`do/${ref}/password/apply`];
 if(!standardItem(data,ref)){if(subjectChange?.status==='done'&&!standardStore(data)?.observations.some(o=>o.kind==='password-use'&&o.subjectRef===ref&&standardObservationValid(data,o.id)))return {tone:'needs-work',label:language==='ja'?'変更後の保存パスワードを確認':'Check the saved password after the change',reason:language==='ja'?'受け付けた値の保存・実利用が未確認です':'Saving and actual use of the accepted value remain unconfirmed'};return;}
 const ja=language==='ja',account=data.assets.find(a=>a.id===ref),observed=standardStore(data)?.observations.filter(o=>(o.accountRef===ref||o.vaultRef===ref||o.appRef===ref)&&standardObservationValid(data,o.id))??[];
 if(account?.provider==='1password'&&!onePasswordAccount(data,ref))return {tone:'unknown',label:ja?'ログイン先・方式の確認が必要':'Check sign-in address and method',reason:ja?'実際のアカウントのログイン先と方式は未確認':'The actual account address and method are unconfirmed'};
 if(account&&standardMasterResume(data,ref))return {tone:'needs-work',label:ja?'パスワード変更の確認が途中です':'Password-change checks are unfinished',reason:ja?'控え・実利用・変更したアカウントを確認する':'Check copies, actual use and the changed account'};
 const opened=observed.some(o=>o.kind==='opened');
 if(account&&!standardContextReady(data,ref))return {tone:'unknown',label:ja?'保管庫・利用場所の確認が必要':'Check the vault and app location',reason:ja?'古いMFAの記録だけでは、保管庫・端末での利用は確認できません':'An earlier MFA record does not confirm vault or device access'};
 return {tone:opened?'recorded':'unknown',label:ja?opened?'利用を確認した組み合わせあり':'利用場所の確認待ち':opened?'Some account/vault/app access recorded':'App access unconfirmed',reason:ja?'各アカウント・保管庫・アプリの組み合わせを個別に確認。安全率や独立した予備の数ではありません':'Checks apply to individual account/vault/app combinations, not a safety score or count of independent backups'};
}
