import type { Dataset } from './models';
export const unavailableState = (state: string) => ['unavailable','lost','transferred','retired','revoked','deleted'].includes(state);
export function recordedActors(data:Dataset,refs:(string|undefined)[]) {
  const seen=new Set<string>(),pending=refs.filter((r):r is string=>!!r);
  while(pending.length&&seen.size<5000){const ref=pending.pop()!;if(seen.has(ref))continue;seen.add(ref);const entity=data.version===2?data.securityModel.entities.find(e=>e.id===ref):undefined;
    if(entity?.kind==='installation')pending.push(entity.deviceRef);

    if(data.version===2&&data.securityModel.revision>=5){const store=data.securityModel.nordSsoV1 as {methods?:Record<string,string>;selections?:Record<string,{bindingRef?:string}>;bindings?:{id:string;providerRef:string;grantRef?:string}[]}|undefined;const method=store?.methods?.[ref]??data.guide.answers[`${ref}:cloud-method`];const b=method==='sso'?store?.bindings?.find(b=>b.id===store.selections?.[ref]?.bindingRef):undefined;if(b)pending.push(b.providerRef);}
  }return [...seen];
}
export function recordedUnavailable(data:Dataset,refs:(string|undefined)[]) {
  if(data.version!==2)return;
  return recordedActors(data,refs).find(ref=>{const life=data.securityModel.lifecycle[ref];return life?.evidence==='user-confirmed'&&unavailableState(life.state);});
}
export function mapRecordEpoch(data:Dataset,refs:(string|undefined)[]) {
  if(data.version!==2||data.securityModel.revision<6)return [] as [string,string][];
  return recordedActors(data,refs).flatMap(ref=>{const life=data.securityModel.lifecycle[ref];return life?.mapRecordLifecycleV1==='v1'&&typeof life.mapRecordResetAt==='string'?[[ref,life.mapRecordResetAt] as [string,string]]:[];}).sort(([a],[b])=>a.localeCompare(b));
}
