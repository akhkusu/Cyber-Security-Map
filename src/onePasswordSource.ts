import {standardClientLabel} from './standardManagerLabels';
import {DataUpgradeConflict,type Dataset} from './models';
import {securityEntitySchema} from './securityModel';
import {onePasswordAccount,onePasswordScope} from './onePasswordAccount';
import {selectedStandardContext,standardApps,standardSupported,standardEpoch} from './standardContexts';
import {standardAppSchema,standardAppSignature} from './standardManagerSchemas';
import {recordedUnavailable} from './recordAvailability';
export function onePasswordSource(data:Dataset,ref:string){
 const id=data.guide.answers[`op-source:${ref}`],source=standardApps(data,ref).find(a=>a.id===id),target=selectedStandardContext(data,ref);
 if(!source||!target||source.id===target.app.id||standardAppSignature(source)===standardAppSignature(target.app)||recordedUnavailable(data,[ref,source.id])||data.guide.answers[`op-source-scope:${ref}`]!==onePasswordScope(data,ref)||data.guide.answers[`op-source-target:${ref}`]!==target.app.id||data.guide.answers[`op-source-epoch:${ref}`]!==standardEpoch(data,ref))return;
 const device=data.assets.find(a=>a.id===source.deviceRef);
 if(onePasswordAccount(data,ref)?.method==='passkey-beta'&&(!['ios','android'].includes(device?.operatingSystem??'')||standardAppSchema.parse(source.standardAppV1).client!=='app'))return;
 return source;
}
export function selectOnePasswordSource(data:Dataset,ref:string,sourceRef:string):Dataset{
 const next={...data,guide:{...data.guide,answers:{...data.guide.answers,[`op-source:${ref}`]:sourceRef,[`op-source-scope:${ref}`]:onePasswordScope(data,ref)??'',[`op-source-target:${ref}`]:selectedStandardContext(data,ref)?.app.id??'',[`op-source-epoch:${ref}`]:standardEpoch(data,ref)}}};
 if(!onePasswordSource(next,ref))throw Error('invalid-onepassword-source');return next;
}
export function addOnePasswordSource(data:Dataset,ref:string,deviceRef:string,client:'web'|'app'|'extension',profile:string):Dataset{
 if(data.version!==2||!standardSupported(data))throw new DataUpgradeConflict();
 const a=data.assets.find(a=>a.id===ref&&a.provider==='1password'),device=data.assets.find(a=>a.id===deviceRef&&a.kind==='device');if(!a||!device)throw Error('invalid-onepassword-source');
 const app=securityEntitySchema.parse({id:crypto.randomUUID(),kind:'installation',label:`1Password · ${device.name} · ${standardClientLabel(client,data.settings.language)}${profile.trim()?` · ${profile.trim()}`:''}`.slice(0,80),createdAt:new Date().toISOString(),productId:'1password',deviceRef,profileLabel:profile.trim()||undefined,standardAppV1:standardAppSchema.parse({version:1,client,profile:profile.trim()||undefined})});
 return selectOnePasswordSource({...data,securityModel:{...data.securityModel,entities:[...data.securityModel.entities,app]}},ref,app.id);
}
