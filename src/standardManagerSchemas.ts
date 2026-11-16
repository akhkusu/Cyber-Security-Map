import {z} from 'zod';

export function onePasswordHost(value:string):string {
 const text=value.trim().toLowerCase();
 if(!/^(?:https:\/\/)?[a-z0-9-]+\.1password\.(com|ca|eu)\/?$/.test(text))throw Error('invalid-onepassword-host');
 const url=new URL(text.includes('://')?text:`https://${text}`);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.pathname!=='/'||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.1password\.(com|ca|eu)$/.test(url.hostname)||/^(start|support|blog|www)\./.test(url.hostname))throw Error('invalid-onepassword-host');
 return url.hostname;
}
export const onePasswordAccountSchema=z.object({version:z.literal(1),host:z.string().refine(v=>{try{return onePasswordHost(v)===v;}catch{return false;}}),kind:z.enum(['individual','family','team','business']),method:z.enum(['password','sso','passkey-beta']),revision:z.string().min(1),checkedAt:z.string()}).passthrough().refine(v=>(v.method!=='sso'||v.kind==='business')&&(v.method!=='passkey-beta'||v.kind==='individual'),'incompatible-onepassword-account-kind');
export type OnePasswordAccount=z.infer<typeof onePasswordAccountSchema>;
export const standardVaultSchema=z.object({version:z.literal(1),ownership:z.enum(['private','shared','managed','unknown'])}).passthrough();
export const standardAppSchema=z.object({version:z.literal(1),client:z.enum(['web','app','extension']),profile:z.string().trim().max(80).optional()}).passthrough();
export const standardObservationSchema=z.object({id:z.string(),accountRef:z.string(),vaultRef:z.string(),appRef:z.string(),deviceRef:z.string().optional(),appSignature:z.string().optional(),scope:z.string(),epoch:z.string(),kind:z.enum(['opened','autofill','password-use','master-use','sso-link','recovery']),subjectRef:z.string().optional(),attempt:z.string().optional(),sourceKey:z.string().optional(),checkedAt:z.string(),active:z.boolean()}).passthrough();
const standardSelection=z.object({vaultRef:z.string(),appRef:z.string()}).passthrough();
export const standardPhoneSessionSchema=z.object({id:z.string(),phoneRef:z.string(),accountRef:z.string(),deviceRef:z.string(),status:z.enum(['active','completed']),scope:z.string().optional(),epoch:z.string().optional(),selection:standardSelection.optional(),guide:z.unknown()}).passthrough();
export const standardStoreSchema=z.object({version:z.literal(1),selections:z.record(z.string(),standardSelection),observations:z.array(standardObservationSchema),sessions:z.array(standardPhoneSessionSchema).default([])}).passthrough();
export type StandardStore=z.infer<typeof standardStoreSchema>;
export const onePasswordCheckSchema=z.object({version:z.literal(1),accountRef:z.string(),returnCursor:z.string(),stage:z.enum(['where','read','host','kind','method','different','problem']),where:z.enum(['kit','find','app']).optional(),host:z.string().optional(),kind:z.enum(['individual','family','team','business']).optional(),method:z.enum(['password','sso','passkey-beta']).optional()}).passthrough();
export const onePasswordChecksSchema=z.object({version:z.literal(1),checks:z.array(onePasswordCheckSchema)}).passthrough();
export const standardCheckSchema=z.object({version:z.literal(1),accountRef:z.string(),returnCursor:z.string(),stage:z.enum(['vault','device','client','open','autofill']),client:z.enum(['web','app','extension']).optional(),vaultRef:z.string().optional(),deviceRef:z.string().optional(),appRef:z.string().optional()}).passthrough();
export const standardChecksSchema=z.object({version:z.literal(1),checks:z.array(standardCheckSchema)}).passthrough();
export function standardManagerIssues(data:{version:number;assets:{id:string;kind:string;provider?:string;[key:string]:unknown}[];securityModel:{revision:number;entities:{id:string;kind:string;[key:string]:unknown}[];[key:string]:unknown};guide:{[key:string]:unknown};deviceWorkflows?:{id:string;newDeviceRef?:string}[]},validGuide?:(value:unknown)=>boolean):string[]{
 const issues:string[]=[],model=data.securityModel;
 for(const account of data.assets)if(Object.hasOwn(account,'onePasswordAccountV1')&&!onePasswordAccountSchema.safeParse(account.onePasswordAccountV1).success)issues.push('invalid-onepassword-account');
 if(model.revision<15)return issues;
 if(Object.hasOwn(data.guide,'onePasswordChecksV1')&&!onePasswordChecksSchema.safeParse(data.guide.onePasswordChecksV1).success)issues.push('invalid-onepassword-checks');
 if(Object.hasOwn(data.guide,'standardContextChecksV1')&&!standardChecksSchema.safeParse(data.guide.standardContextChecksV1).success)issues.push('invalid-standard-context-checks');
 if(!Object.hasOwn(model,'standardManagersV1'))return issues;
 const parsed=standardStoreSchema.safeParse(model.standardManagersV1);if(!parsed.success)return [...issues,'invalid-standard-store'];
 const ids=new Set<string>();
 const account=(id:string)=>data.assets.find(a=>a.id===id&&a.kind==='account'&&['bitwarden','1password'].includes(a.provider??''));
 const context=(ref:string,vaultRef:string,appRef:string)=>{const a=account(ref),v=model.entities.find(e=>e.id===vaultRef&&e.kind==='vault'),i=model.entities.find(e=>e.id===appRef&&e.kind==='installation');return !!a&&!!v&&v.authenticationAccountRef===ref&&v.productId===a.provider&&standardVaultSchema.safeParse(v.standardVaultV1).success&&!!i&&i.productId===a.provider&&standardAppSchema.safeParse(i.standardAppV1).success&&data.assets.some(d=>d.id===i.deviceRef&&d.kind==='device');};
 for(const [ref,s]of Object.entries(parsed.data.selections))if(!context(ref,s.vaultRef,s.appRef))issues.push('invalid-standard-selection');
 for(const o of parsed.data.observations){if(ids.has(o.id)||!context(o.accountRef,o.vaultRef,o.appRef)||o.subjectRef&&!data.assets.some(a=>a.id===o.subjectRef&&a.kind==='account'))issues.push('invalid-standard-observation');ids.add(o.id);}
 for(const s of parsed.data.sessions){if(ids.has(s.id)||!account(s.accountRef)||!data.deviceWorkflows?.some(w=>w.id===s.phoneRef)||!data.assets.some(a=>a.id===s.deviceRef&&a.kind==='device')||validGuide&&!validGuide(s.guide)||s.selection&&(!context(s.accountRef,s.selection.vaultRef,s.selection.appRef)||!model.entities.some(e=>e.id===s.selection!.appRef&&e.deviceRef===s.deviceRef)))issues.push('invalid-standard-phone-session');ids.add(s.id);}
 return issues;
}

export function standardAppSignature(app:{[key:string]:unknown}|undefined){const details=standardAppSchema.safeParse(app?.standardAppV1);return app&&typeof app.productId==='string'&&typeof app.deviceRef==='string'&&details.success?JSON.stringify([app.productId,app.deviceRef,details.data.client,details.data.profile??'']):undefined;}
export function standardFactCurrent(model:{[key:string]:unknown},fact:{[key:string]:unknown}):boolean{
 if(!Object.hasOwn(fact,'standardObservationV1'))return true;
 const parsed=standardStoreSchema.safeParse(model.standardManagersV1);if(!parsed.success)return false;
 const observation=parsed.data.observations.find(o=>o.id===fact.standardObservationV1&&o.active);
 const entities=Array.isArray(model.entities)?model.entities.filter((e):e is Record<string,unknown>=>!!e&&typeof e==='object'):[];
 const app=entities.find(e=>e.id===observation?.appRef&&e.kind==='installation');
 return !!observation&&!!app&&observation.deviceRef===app.deviceRef&&!!observation.appSignature&&observation.appSignature===standardAppSignature(app);
}
