import {standardClientLabel,standardOwnershipLabel,onePasswordKindLabel,onePasswordMethodLabel} from './standardManagerLabels';
import {useState} from 'react';
import type {Dataset,Language} from './models';
import {tx} from './ui';
import {standardApps,standardContextReady,standardObservationValid,standardStore,standardVaults,selectStandardPair,updateStandardCheck} from './standardContexts';
import {onePasswordAccount,openOnePasswordCheck} from './onePasswordAccount';
import {standardAppSchema,standardVaultSchema} from './standardManagerSchemas';
import {StandardContextCheck} from './StandardContextCheck';
import {AccessChecks} from './AccessChecks';
export function StandardMapDetails({data,language,save,itemRef,startGuide,typed=false,missing=[]}:{data:Dataset;language:Language;save:(d:Dataset)=>Promise<boolean>;itemRef:string;startGuide:(d:Dataset)=>void;typed?:boolean;missing?:string[]}){
 const [editing,setEditing]=useState<{ref:string;client:'web'|'app'|'extension'}>();
 const entity=data.version===2?data.securityModel.entities.find(e=>e.id===itemRef):undefined,account=data.assets.find(a=>a.id===itemRef),setting=account?.provider==='1password'?onePasswordAccount(data,itemRef):undefined;
 const entries=standardStore(data)?.observations.filter(o=>o.accountRef===itemRef||o.vaultRef===itemRef||o.appRef===itemRef)??[];
 const pairs=[...new Map(entries.map(o=>[JSON.stringify([o.accountRef,o.vaultRef,o.appRef]),o])).values()];
 const title=entity?.label??account?.name??'';
 const edit=async(ref:string,vaultRef:string,appRef:string)=>{const app=standardApps(data,ref).find(a=>a.id===appRef)!;const client=standardAppSchema.parse(app.standardAppV1).client;const next=updateStandardCheck(selectStandardPair(data,ref,vaultRef,appRef),ref,{stage:'open',vaultRef,appRef,deviceRef:app.deviceRef,client});if(await save(next))setEditing({ref,client});};
 const content=<>
  {typed&&<h2>{title}</h2>}
  {setting&&<><p>{tx(language,'Confirmed sign-in address: ','確認したログイン先：')}{setting.host}</p><p>{tx(language,'Account type / sign-in: ','アカウントの種類・方式：')}{onePasswordKindLabel(setting.kind,language)} · {onePasswordMethodLabel(setting.method,language)}</p></>}
  {account?.provider==='1password'&&<button className="button secondary" onClick={()=>startGuide(openOnePasswordCheck(data,account.id))}>{tx(language,'Review this sign-in address and method','ログイン先・認証方式を確認する')}</button>}
  {entity?.kind==='vault'&&<p>{tx(language,'Account: ','アカウント：')}{data.assets.find(a=>a.id===entity.authenticationAccountRef)?.name} · {standardOwnershipLabel(standardVaultSchema.parse(entity.standardVaultV1).ownership,language)}</p>}
  {entity?.kind==='installation'&&<p>{tx(language,'Physical device: ','実際の端末：')}{data.assets.find(a=>a.id===entity.deviceRef)?.name} · {standardClientLabel(standardAppSchema.parse(entity.standardAppV1).client,language)} · {entity.profileLabel}</p>}
  <h3>{tx(language,'Recorded account, vault and app combinations','アカウント・保管庫・アプリごとの記録')}</h3>
  {!pairs.length&&<p>{tx(language,'No access is inferred from earlier account-wide MFA records. Choose and check the actual vault and app in the guide.','過去のアカウント全体のMFA記録から、利用場所の成功は推測しません。ガイドで実際の保管庫とアプリを確認してください。')}</p>}
  {pairs.map(pair=>{const a=data.assets.find(a=>a.id===pair.accountRef),v=standardVaults(data,pair.accountRef).find(v=>v.id===pair.vaultRef),app=standardApps(data,pair.accountRef).find(i=>i.id===pair.appRef);return <section className="technical" key={pair.id}><p>{a?.name} → {v?.label} → {app?.label}</p><ul>{entries.filter(o=>o.accountRef===pair.accountRef&&o.vaultRef===pair.vaultRef&&o.appRef===pair.appRef).map(o=><li key={o.id}>{({opened:tx(language,'Vault opened','保管庫を開けた'),autofill:tx(language,'Filling method checked','入力方法を確認'), 'password-use':tx(language,'Saved password used','保存パスワードを実利用'),'master-use':tx(language,'Current account password used','現在のアカウントパスワードを実利用'),'sso-link':tx(language,'Target authorization accepted','新しい利用場所の承認を確認'),recovery:tx(language,'Recovery information checked','復旧用情報を確認')})[o.kind]}{o.subjectRef&&` · ${data.assets.find(a=>a.id===o.subjectRef)?.name}`} · {tx(language,standardObservationValid(data,o.id)?'Current record':'History; check again',standardObservationValid(data,o.id)?'現在の確認記録':'履歴・再確認が必要')}</li>)}</ul>{app&&v&&<button className="button secondary" onClick={()=>void edit(pair.accountRef,pair.vaultRef,pair.appRef)}>{tx(language,'Check this vault and app','この保管庫・アプリの利用を確認する')}</button>}</section>;})}
  <p className="subtle">{tx(language,'Apps and vaults on one physical device share that device’s failure. A confirmed login does not establish an independent recovery route.','同じ実際の端末を使うアプリ・保管庫は、その端末の故障や紛失の影響を共有します。ログインできただけで、独立した復旧手段があるとは扱いません。')}</p>
  {editing&&<StandardContextCheck data={data} language={language} accountRef={editing.ref} client={editing.client} save={async next=>{const main={...data.guide,standardContextChecksV1:next.guide.standardContextChecksV1};const ok=await save({...next,guide:main});if(ok&&standardContextReady(next,editing.ref,editing.client))setEditing(undefined);return ok;}}/>}
  {typed&&<AccessChecks data={data} targetId={itemRef} language={language} missing={missing}/>}
 </>;
 return typed?<section className="panel map-details">{content}</section>:<section className="standard-map-details">{content}</section>;
}
