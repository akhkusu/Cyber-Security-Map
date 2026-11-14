import {z} from 'zod';
import type {CurrentDataset,Dataset} from './models';
import {keyStoreSchema,type KeyTask} from './hardwareKeySchemas';
import {nordSsoBinding,nordSsoStoreSchema} from './nordSsoSchemas';

// Key tasks stay passthrough records. Only revision 10 owns this field;
// earlier payloads may contain an opaque field with the same name.
export const nordKeyReturnSchema=z.object({version:z.literal(1),sessionRef:z.string().min(1),bindingRef:z.string().min(1),adoptedFrom:z.object({returnTo:z.enum(['/guide','/map']),originGuideCursor:z.string(),at:z.string().datetime({offset:true})}).passthrough().optional()}).passthrough();
export type NordKeyReturn=z.infer<typeof nordKeyReturnSchema>;
type Data=Pick<CurrentDataset,'assets'|'securityModel'>;
function referencesMatch(data:Data,task:Pick<KeyTask,'accountRef'|'returnTo'>,origin:NordKeyReturn):boolean{
  const parsed=nordSsoStoreSchema.safeParse(data.securityModel.nordSsoV1);if(!parsed.success)return false;
  const session=parsed.data.sessions.find(s=>s.id===origin.sessionRef),binding=parsed.data.bindings.find(b=>b.id===origin.bindingRef);
  if(!session||!binding||binding.providerRef!==task.accountRef||task.returnTo!=='/map')return false;
  const vault=data.securityModel.entities.find(e=>e.id===session.vaultRef&&e.kind==='vault'),app=data.securityModel.entities.find(e=>e.id===session.appRef&&e.kind==='installation');
  return !!vault&&vault.kind==='vault'&&vault.productId==='nordpass'&&vault.authenticationAccountRef===binding.rootRef&&!!app&&app.kind==='installation'&&app.vaultRef===vault.id;
}
export function keyNordOrigin(data:Dataset,task:KeyTask):NordKeyReturn|undefined{
  if(data.version!==2||data.securityModel.revision<10)return;
  const parsed=nordKeyReturnSchema.safeParse(task.nordSsoKeyReturnV1);return parsed.success&&referencesMatch(data,task,parsed.data)?parsed.data:undefined;
}
export function createNordKeyOrigin(data:CurrentDataset,sessionRef:string,accountRef:string):NordKeyReturn|undefined{
  const parsed=nordSsoStoreSchema.safeParse(data.securityModel.nordSsoV1);if(!parsed.success)return;
  const session=parsed.data.sessions.find(s=>s.id===sessionRef),vault=data.securityModel.entities.find(e=>e.id===session?.vaultRef&&e.kind==='vault');
  if(!session||vault?.kind!=='vault'||!vault.authenticationAccountRef)return;
  const binding=nordSsoBinding(data,vault.authenticationAccountRef);if(!binding||binding.providerRef!==accountRef)return;
  const origin={version:1 as const,sessionRef,bindingRef:binding.id};
  return referencesMatch(data,{accountRef,returnTo:'/map'},origin)?origin:undefined;
}
export function nordKeyReturnIssues(data:Data):string[]{
  if(data.securityModel.revision<10)return [];
  const keys=keyStoreSchema.safeParse(data.securityModel.hardwareKeysV1);if(!keys.success)return [];
  return keys.data.tasks.some(t=>{
    if(!Object.hasOwn(t,'nordSsoKeyReturnV1'))return false;
    const origin=nordKeyReturnSchema.safeParse(t.nordSsoKeyReturnV1);
    return !origin.success||Object.hasOwn(t,'deviceProtectionKeyReturnV1')||!referencesMatch(data,t,origin.data);
  })?['invalid-nord-key-return']:[];
}
