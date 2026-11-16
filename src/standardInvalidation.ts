import type {Dataset} from './models';
import {standardStoreSchema} from './standardManagerSchemas';
/** Preserve historical observations while removing their current-access claim. */
export function invalidateStandardAccount(data:Dataset,accountRef:string,keepConfiguration=false):Dataset{
 if(data.version!==2)return data;
 const parsed=standardStoreSchema.safeParse(data.securityModel.standardManagersV1);if(!parsed.success)return data;
 const ids=new Set(parsed.data.observations.filter(o=>o.accountRef===accountRef&&(!keepConfiguration||o.kind!=='autofill')).map(o=>o.id));
 return {...data,securityModel:{...data.securityModel,standardManagersV1:{...parsed.data,observations:parsed.data.observations.map(o=>ids.has(o.id)?{...o,active:false}:o)},facts:data.securityModel.facts.map(f=>ids.has(String(f.standardObservationV1))?{...f,state:'unknown',evidence:'unknown'}:f)}};
}
