import type { Dataset } from './models';
import { twofasTask, withdrawTwofasReceipt, bindTwofasPhoneRecord } from './twofasEngine';
import { confirmPhoneStep, currentPhoneStep, phoneRecordKey, undoPhoneRecord } from './phoneEngine';
import { authenticatorSetupRoute, requireAuthenticatorRoots, setAuthCursor } from './authenticatorGuide';
export function undoTwofas(data:Dataset,id:string,stepId:string):Dataset{
  const t=twofasTask(data,id);let next=data;
  if(t?.origin==='phone'&&t.phoneRef&&t.phoneRecordKey)next=undoPhoneRecord(next,t.phoneRef,t.phoneRecordKey);
  return withdrawTwofasReceipt(next,id,stepId);
}
export function finishTwofas(data:Dataset,id:string):Dataset{
  const t=twofasTask(data,id);if(!t||t.status!=='completed')return data;
  if(t.origin==='guide'&&data.guide.cursor===`twofas/${id}`&&t.accountRef){
    return t.kind==='prepare'?setAuthCursor(data,authenticatorSetupRoute(data,t.accountRef)):requireAuthenticatorRoots(data,t.accountRef,t.returnCursor??'manager-select');
  }
  if(t.origin==='phone'&&data.version===2&&t.phoneRef){
    const w=data.deviceWorkflows.find(w=>w.id===t.phoneRef);if(!w)return data;
    const step=currentPhoneStep(data,w);if(step.twofasSourceRef!==t.appRef)return data;
    const next=confirmPhoneStep(data,w.id);return next===data?data:bindTwofasPhoneRecord(next,id,phoneRecordKey(w,step));
  }
  return data;
}
export function twofasReturnPath(data:Dataset,id:string):string{
  const t=twofasTask(data,id);if(!t)return '/guide';
  return t.origin==='phone'?`/phone/${encodeURIComponent(t.phoneRef!)}`:t.origin==='guide'?t.scopePath??'/guide':`/map?item=${encodeURIComponent(t.appRef)}`;
}
