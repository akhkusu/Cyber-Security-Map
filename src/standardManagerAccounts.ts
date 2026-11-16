import {z} from 'zod';
import {DataUpgradeConflict,makeAsset,type Asset,type Dataset,type Language} from './models';

export const STANDARD_MANAGER_PRODUCTS=['bitwarden','1password'] as const;
export type StandardManagerProduct=typeof STANDARD_MANAGER_PRODUCTS[number];
export const STANDARD_MANAGER_NAMES={bitwarden:'Bitwarden','1password':'1Password'};
const address=z.string().trim().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u);
export const standardManagerIdentitySchema=z.object({version:z.literal(1),address:address.optional(),label:z.string().trim().max(80).optional(),detailsPhase:z.enum(['purpose','complete']).optional()}).passthrough();
export type StandardManagerIdentity=z.infer<typeof standardManagerIdentitySchema>;
export function standardManagerIdentity(account?:Asset):StandardManagerIdentity|undefined{
 const result=standardManagerIdentitySchema.safeParse(account?.standardManagerIdentityV1);return result.success?result.data:undefined;
}
export const standardManagerAddress=(account?:Asset)=>standardManagerIdentity(account)?.address??'';
export function standardManagerIdentitySupported(account:Asset){return !Object.hasOwn(account,'standardManagerIdentityV1')||standardManagerIdentitySchema.safeParse(account.standardManagerIdentityV1).success;}
export function isStandardManager(account?:Asset):account is Asset&{provider:StandardManagerProduct}{
 return !!account&&account.kind==='account'&&(account.type==='Password manager'||account.services.includes('manager'))&&STANDARD_MANAGER_PRODUCTS.includes(account.provider as StandardManagerProduct);
}
export function standardManagerAccounts(data:Dataset,product:StandardManagerProduct):Asset[]{
 return data.assets.filter(account=>isStandardManager(account)&&account.provider===product||account.kind==='account'&&!account.provider&&(account.type==='Password manager'||account.services.includes('manager')));
}
export function managerPurpose(account:Asset,language:Language):string{
 return account.purpose==='work'?language==='ja'?'仕事・学校用':'Work / school':account.purpose==='personal'?language==='ja'?'個人用':'Personal':language==='ja'?'用途未確認':'Use not chosen';
}
function navigate(data:Dataset,cursor:string):Dataset{
 return data.guide.cursor===cursor?data:{...data,guide:{...data.guide,cursor,history:[...data.guide.history,data.guide.cursor].slice(-200)}};
}
/** Labels and addresses identify an account. They never establish ownership, MFA or recovery. */
export function saveStandardManagerIdentity(data:Dataset,product:StandardManagerProduct,input:{address:string;label:string},accountRef?:string):Dataset{
 if(!STANDARD_MANAGER_PRODUCTS.includes(product))throw Error('invalid-standard-product');
 const current=accountRef?data.assets.find(account=>account.id===accountRef):undefined;
 if(accountRef&&(!isStandardManager(current)||current.provider!==product))throw Error('invalid-standard-account');
 if(current&&!standardManagerIdentitySupported(current))throw new DataUpgradeConflict();
 const parsed=standardManagerIdentitySchema.parse({version:1,...(input.address.trim()?{address:input.address.trim()}:{}),...(input.label.trim()?{label:input.label.trim()}: {})});
 const old=standardManagerIdentity(current),accounts=standardManagerAccounts(data,product),ordinal=current?accounts.findIndex(account=>account.id===current.id)+1:accounts.length+1;
 const name=(parsed.label||parsed.address||`${STANDARD_MANAGER_NAMES[product]} · ${ordinal}`).slice(0,80);
 const account:Asset=current?{...current,name,standardManagerIdentityV1:{...old,...parsed,address:parsed.address,label:parsed.label}}:{...makeAsset({kind:'account',type:'Password manager',name,importance:'critical'}),provider:product,services:['manager'],standardManagerIdentityV1:{...parsed,detailsPhase:'purpose'}};
 const next={...data,assets:current?data.assets.map(item=>item.id===account.id?account:item):[...data.assets,account]};
 return current?next:navigate({...next,guide:{...next.guide,managerId:account.id}},`manager-purpose/${account.id}`);
}
export function selectStandardManager(data:Dataset,accountRef:string,product?:StandardManagerProduct):Dataset{
 let account=data.assets.find(item=>item.id===accountRef);
 if(account&&!account.provider&&product&&standardManagerAccounts(data,product).some(item=>item.id===accountRef))account={...account,provider:product,services:[...new Set([...account.services,'manager' as const])]};
 if(!isStandardManager(account)||product&&account.provider!==product)throw Error('invalid-standard-account');
 if(!standardManagerIdentitySupported(account))throw new DataUpgradeConflict();
 const chosen=account;
 return navigate({...data,assets:data.assets.map(item=>item.id===accountRef?chosen:item),guide:{...data.guide,managerId:accountRef}},account.purpose?`platform/${accountRef}/manager`:`manager-purpose/${accountRef}`);
}
export function saveStandardManagerPurpose(data:Dataset,accountRef:string,purpose:'personal'|'work',continueGuide=true):Dataset{
 const account=data.assets.find(item=>item.id===accountRef);if(!isStandardManager(account))throw Error('invalid-standard-account');
 if(!standardManagerIdentitySupported(account))throw new DataUpgradeConflict();
 if(purpose!=='personal'&&purpose!=='work')throw Error('invalid-standard-purpose');
 const identity=standardManagerIdentity(account);
 const next={...data,assets:data.assets.map(item=>item.id===accountRef?{...item,purpose,...(identity?{standardManagerIdentityV1:{...identity,detailsPhase:'complete'}}:{})}:item)};
 if(!continueGuide)return next;
 const selected={...next,guide:{...next.guide,managerId:accountRef}};
 return data.guide.cursor.startsWith('do/')?selected:navigate(selected,`platform/${accountRef}/manager`);
}
export function allowStandardManagerSettings(data:Dataset,accountRef:string):Dataset{
 const account=data.assets.find(item=>item.id===accountRef);if(!isStandardManager(account)||!standardManagerIdentitySupported(account))throw new DataUpgradeConflict();
 return {...data,guide:{...data.guide,answers:{...data.guide.answers,[`${accountRef}:managedAllowed`]:'yes'}}};
}
