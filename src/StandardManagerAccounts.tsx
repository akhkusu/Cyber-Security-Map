import {useState,type FormEvent} from 'react';
import {ArrowRight} from 'lucide-react';
import {DataUpgradeConflict,type Asset,type Dataset,type Language} from './models';
import {tx} from './ui';
import {deferStep} from './guideEngine';
import {bitwardenRegion} from './bitwardenServer';
import {allowStandardManagerSettings,isStandardManager,managerPurpose,saveStandardManagerIdentity,saveStandardManagerPurpose,selectStandardManager,standardManagerAccounts,standardManagerAddress,standardManagerIdentity,standardManagerIdentitySupported,STANDARD_MANAGER_NAMES,type StandardManagerProduct} from './standardManagerAccounts';

type Props={data:Dataset;language:Language;save:(data:Dataset)=>Promise<boolean>};
function message(error:unknown,language:Language){return tx(language,error instanceof DataUpgradeConflict?'This saved identity needs a newer app. Keep your encrypted backup.':'Check the email address and name.',error instanceof DataUpgradeConflict?'この登録内容に対応する新しい版が必要です。暗号化バックアップを保管してください。':'メールアドレスと呼び名を確認してください。');}
export function StandardManagerSummary({account,language,product=false}:{account:Asset;language:Language;product?:boolean}){
 const provider=isStandardManager(account)?STANDARD_MANAGER_NAMES[account.provider]:'';
 return <span className="manager-identity-summary"><strong>{product&&account.name!==provider?`${provider} · ${account.name}`:account.name}</strong>{standardManagerAddress(account)&&standardManagerAddress(account)!==account.name&&<small className="mail-address">{standardManagerAddress(account)}</small>}{account.purpose&&<small>{managerPurpose(account,language)}</small>}</span>;
}
export function StandardManagerIdentityForm({data,language,save,product,account,onSaved,draft=false}:Props&{product:StandardManagerProduct;account?:Asset;onSaved?:()=>void;draft?:boolean}){
 const identity=standardManagerIdentity(account),[address,setAddress]=useState(identity?.address??''),[label,setLabel]=useState(identity?.label??(identity?'':account?.name??'')),[purpose,setPurpose]=useState<'personal'|'work'|''>(account?.purpose??''),[error,setError]=useState('');
 const submit=async(event:FormEvent)=>{
  event.preventDefault();setError('');
  try{let next=saveStandardManagerIdentity(data,product,{address,label},account?.id);if(account&&purpose&&!draft)next=saveStandardManagerPurpose(next,account.id,purpose,false);if(account&&draft)next=selectStandardManager(next,account.id,product);if(await save(next))onSaved?.();}
  catch(cause){setError(message(cause,language));}
 };
 if(account&&!standardManagerIdentitySupported(account))return <p>{tx(language,'This saved identity needs a newer app. Keep your encrypted backup.','この登録内容に対応する新しい版が必要です。暗号化バックアップを保管してください。')}</p>;
 return <form className="mail-details-form" onSubmit={event=>void submit(event)}>
  <label>{tx(language,'Account email address (optional)','このアカウントのメールアドレス（任意）')}<input type="email" autoComplete="off" inputMode="email" maxLength={254} value={address} onChange={event=>setAddress(event.target.value)}/></label>
  <label>{tx(language,'Name for this account (optional)','このアカウントの呼び名（任意）')}<input autoComplete="off" maxLength={80} value={label} onChange={event=>setLabel(event.target.value)}/></label>
  {account&&!draft&&<label>{tx(language,'Use','用途')}<select value={purpose} onChange={event=>setPurpose(event.target.value as typeof purpose)}><option value="" disabled>{tx(language,'Choose a use','用途を選ぶ')}</option><option value="personal">{tx(language,'Personal','個人用')}</option><option value="work">{tx(language,'Work / school','仕事・学校用')}</option></select></label>}
  <button className="button primary" type="submit">{tx(language,account&&!draft?'Save these details':'Next',account&&!draft?'登録内容を保存する':'次へ')}<ArrowRight size={17}/></button>
  {error&&<p className="error" role="alert">{error}</p>}
 </form>;
}
export function StandardManagerAccounts({data,language,save,product,mode,accountRef}:Props&{product:StandardManagerProduct;mode:'identity'|'purpose'|'managed';accountRef?:string}){
 const accounts=standardManagerAccounts(data,product),account=data.assets.find(item=>item.id===accountRef),[error,setError]=useState(''),[chooseAnother,setChooseAnother]=useState(false);
 const draftAccount=accounts.find(item=>item.id===data.guide.managerId&&standardManagerIdentity(item)?.detailsPhase==='purpose');
 const act=async(change:()=>Dataset)=>{setError('');try{await save(change());}catch(cause){setError(message(cause,language));}};
 const form=<StandardManagerIdentityForm key={`${product}:new`} data={data} language={language} save={save} product={product}/>;
 if(mode!=='identity'&&(!account||!isStandardManager(account)))return <h1>{tx(language,'This account was not found','このアカウントが見つかりません')}</h1>;
 if(account&&!standardManagerIdentitySupported(account))return <><h1>{tx(language,'This saved identity needs a newer app','この登録内容に対応する新しい版が必要です')}</h1><p>{tx(language,'Keep your encrypted backup.','暗号化バックアップを保管してください。')}</p></>;
 if(mode==='identity'&&draftAccount&&!chooseAnother)return <><h1>{tx(language,`Your ${STANDARD_MANAGER_NAMES[product]} account`,`${STANDARD_MANAGER_NAMES[product]}のアカウント`)}</h1><StandardManagerIdentityForm key={draftAccount.id} data={data} language={language} save={save} product={product} account={draftAccount} draft/><button className="text-button" onClick={()=>setChooseAnother(true)}>{tx(language,'Choose another account','ほかのアカウントを使う')}</button></>;
 return <>
  {mode==='managed'&&account?<><div className="task-context"><StandardManagerSummary account={account} language={language} product/></div><h1>{tx(language,'Are you allowed to change this account’s settings?','このアカウントの設定を自分で変更してよいですか？')}</h1><p>{tx(language,'For an account managed by your work or school, ask the person responsible which authentication methods you may use.','会社・学校が管理しているアカウントの場合は、利用できる認証方法を担当者に確認してください。')}</p><div className="choices"><button className="choice" onClick={()=>void act(()=>allowStandardManagerSettings(data,account.id))}>{tx(language,'I manage it myself / I confirmed permission','自分で管理している・変更してよいと確認した')}<ArrowRight size={17}/></button><button className="choice" onClick={()=>void act(()=>deferStep(data))}>{tx(language,'I need to check; do this later','確認が必要なので、後で進める')}</button></div></>:
   mode==='purpose'&&account?<><div className="task-context"><StandardManagerSummary account={account} language={language} product/></div><h1>{tx(language,'What do you use this account for?','このアカウントは何に使いますか？')}</h1><div className="choices">{(['personal','work'] as const).map(purpose=><button className="choice" key={purpose} onClick={()=>void act(()=>saveStandardManagerPurpose(data,account.id,purpose))}><span>{tx(language,purpose==='personal'?'Personal':'Work / school',purpose==='personal'?'個人用':'仕事・学校用')}</span><ArrowRight size={17}/></button>)}</div></>:
   <><h1>{accounts.length?tx(language,`Which ${STANDARD_MANAGER_NAMES[product]} account will you use?`,`使う${STANDARD_MANAGER_NAMES[product]}アカウントは？`):tx(language,`Your ${STANDARD_MANAGER_NAMES[product]} account`,`${STANDARD_MANAGER_NAMES[product]}のアカウント`)}</h1>
    {accounts.length?<><div className="choices">{accounts.map(item=><button className="choice manager-account-choice" key={item.id} onClick={()=>void act(()=>selectStandardManager(data,item.id,product))}><StandardManagerSummary account={item} language={language}/><span>{!item.provider?tx(language,`Use as ${STANDARD_MANAGER_NAMES[product]}`,`${STANDARD_MANAGER_NAMES[product]}として使う`):item.provider==='bitwarden'&&bitwardenRegion(data,item.id)?.toUpperCase()}</span><ArrowRight size={17}/></button>)}</div><details className="mail-add"><summary>{tx(language,'Add a different account','別のアカウントを追加する')}</summary>{form}</details></>:form}
   </>}
  {error&&<p className="error" role="alert">{error}</p>}
 </>;
}
