import {DataUpgradeConflict,makeAsset,upgradeDataset,type Dataset} from './models';
import {onePasswordAccountSchema,onePasswordCheckSchema,onePasswordChecksSchema,onePasswordHost,type OnePasswordAccount} from './standardManagerSchemas';
import {invalidateStandardAccount} from './standardInvalidation';

export const onePasswordAccount=(data:Dataset,ref:string)=>{const parsed=onePasswordAccountSchema.safeParse(data.assets.find(a=>a.id===ref)?.onePasswordAccountV1);return parsed.success?parsed.data:undefined;};
export const onePasswordSite=(data:Dataset,ref:string)=>{const saved=onePasswordAccount(data,ref);return saved?`https://${saved.host}/`:undefined;};
export const onePasswordScope=(data:Dataset,ref:string)=>{const saved=onePasswordAccount(data,ref);return saved?`1password:${saved.host}:${saved.method}:${saved.kind}:${saved.revision}`:undefined;};
export function onePasswordSupported(data:Dataset,ref:string){const a=data.assets.find(a=>a.id===ref);return (data.version!==2||data.securityModel.revision<=15)&&!!a&&a.provider==='1password'&&(!Object.hasOwn(a,'onePasswordAccountV1')||onePasswordAccountSchema.safeParse(a.onePasswordAccountV1).success)&&(!Object.hasOwn(data.guide,'onePasswordChecksV1')||onePasswordChecksSchema.safeParse(data.guide.onePasswordChecksV1).success);}
export function onePasswordCheck(data:Dataset,ref:string){
 const parsed=onePasswordChecksSchema.safeParse(data.guide.onePasswordChecksV1);
 return (parsed.success?[...parsed.data.checks].reverse().find(c=>c.accountRef===ref&&(c.returnCursor===data.guide.cursor||data.guide.cursor===`onepassword-check/${ref}`)):undefined)??{version:1 as const,accountRef:ref,returnCursor:data.guide.cursor,stage:'where' as const};
}
export function updateOnePasswordCheck(data:Dataset,ref:string,patch:Partial<ReturnType<typeof onePasswordCheck>>):Dataset{
 if(!onePasswordSupported(data,ref))throw new DataUpgradeConflict();
 data=upgradeDataset(data);data={...data,securityModel:{...data.securityModel,revision:15}};
 const check=onePasswordCheckSchema.parse({...onePasswordCheck(data,ref),...patch});
 const parsed=onePasswordChecksSchema.safeParse(data.guide.onePasswordChecksV1),store=parsed.success?parsed.data:{version:1 as const,checks:[]};
 return {...data,guide:{...data.guide,onePasswordChecksV1:{...store,checks:[...store.checks.filter(c=>c.accountRef!==ref||c.returnCursor!==check.returnCursor),check]}}};
}
export function openOnePasswordCheck(data:Dataset,ref:string):Dataset{
 const next=updateOnePasswordCheck(data,ref,{stage:'where',returnCursor:onePasswordCheck(data,ref).returnCursor});
 return {...next,guide:{...next.guide,cursor:`onepassword-check/${ref}`,history:[...next.guide.history,data.guide.cursor].slice(-200)}};
}
export function saveOnePasswordAccount(data:Dataset,ref:string,input:{host:string;kind:OnePasswordAccount['kind'];method:OnePasswordAccount['method']},decision?:'correct'|'separate'):Dataset{
 if(!onePasswordSupported(data,ref))throw new DataUpgradeConflict();
 data=upgradeDataset(data);data={...data,securityModel:{...data.securityModel,revision:15}};
 const host=onePasswordHost(input.host),old=onePasswordAccount(data,ref),account=data.assets.find(a=>a.id===ref)!;
 const different=!!old&&(old.host!==host||old.method!==input.method||old.kind!==input.kind);
 if(different&&!decision)return updateOnePasswordCheck(data,ref,{stage:'different',host,kind:input.kind,method:input.method});
 if(old&&old.host.split('.').at(-1)!==host.split('.').at(-1)&&decision!=='separate')return updateOnePasswordCheck(data,ref,{stage:'different',host,kind:input.kind,method:input.method});
 const saved=onePasswordAccountSchema.parse({...old,version:1,host,kind:input.kind,method:input.method,revision:!different&&old?old.revision:crypto.randomUUID(),checkedAt:new Date().toISOString()});
 if(decision==='separate'){
  const added={...makeAsset({kind:'account',type:'Password manager',name:`1Password · ${data.assets.filter(a=>a.provider==='1password').length+1}`,importance:'critical'}),provider:'1password' as const,purpose:account.purpose,services:['manager' as const],onePasswordAccountV1:saved};
  return {...data,assets:[...data.assets,added],guide:{...data.guide,managerId:added.id,cursor:`platform/${added.id}/manager`,history:[...data.guide.history,data.guide.cursor].slice(-200)}};
 }
 let next=different?invalidateStandardAccount(data,ref):data;
 next=upgradeDataset(next);next={...next,securityModel:{...next.securityModel,revision:15}};
 const scope=`1password:${saved.host}:${saved.method}:${saved.kind}:${saved.revision}`;
 const steps=!old?Object.fromEntries(Object.entries(next.guide.steps).map(([key,record])=>[key,key.startsWith(`do/${ref}/manager/master-`)&&record.standardMasterScopeV1==='1password:password-account'?{...record,standardMasterScopeV1:scope}:record])):next.guide.steps;
 return {...next,assets:next.assets.map(a=>a.id===ref?{...a,onePasswordAccountV1:saved}:a),guide:{...next.guide,steps,...(data.guide.cursor===`onepassword-check/${ref}`?{cursor:onePasswordCheck(data,ref).returnCursor}:{})}};
}
