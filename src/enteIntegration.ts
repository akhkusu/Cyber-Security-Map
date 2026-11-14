import {enteParent,reconcileEnteTask} from './enteEngine';
import { guideSchema, type Dataset } from './models';
import { enteTask, startEnteTask, putEnteTask, withdrawEnteReceipt } from './enteData';
import { authenticatorSetupRoute, requireAuthenticatorRoots, setAuthCursor } from './authenticatorGuide';
import { confirmPhoneStep, currentPhoneStep, phoneRecordKey, undoPhoneRecord } from './phoneEngine';
import { nordSsoStore } from './nordSsoSchemas';
import { saveNordSsoSession } from './nordSso';
import { protectionTasks } from './deviceProtectionSchemas';
import { saveProtectionAccountGuide } from './deviceProtection';
const decodeScope=(path:string,prefix:string)=>{try{return decodeURIComponent(path.slice(prefix.length));}catch{return undefined;}};
export function undoEnte(data:Dataset,id:string,stepId:string):Dataset{
 let t=enteTask(data,id),next=data;const seen=new Set<string>();
 while(t&&!seen.has(t.id)){
  seen.add(t.id);
  if(t.origin==='phone'&&t.phoneRef&&t.phoneRecordKey)next=undoPhoneRecord(next,t.phoneRef,t.phoneRecordKey);
  t=enteParent(data,t.id);
 }
 return withdrawEnteReceipt(next,id,stepId);
}
export function finishEnte(data:Dataset,id:string,seen=new Set<string>()):Dataset{
 if(seen.has(id)||enteTask(data,id)?.status!=='completed')return data;seen.add(id);const parent=enteParent(data,id);if(parent){const next=reconcileEnteTask(data,parent.id);return enteTask(next,parent.id)?.status==='completed'?finishEnte(next,parent.id,seen):next;}
 const t=enteTask(data,id);if(!t||t.status!=='completed')return data;
 if(t.origin==='guide'&&t.accountRef){
  const advance=(child:Dataset)=>t.kind==='prepare'?setAuthCursor(child,authenticatorSetupRoute(child,t.accountRef!)):requireAuthenticatorRoots(child,t.accountRef!,t.returnCursor??'manager-select');
  if(data.guide.cursor===`ente/${id}`)return advance(data);
  if(t.scopePath?.startsWith('/nord-connection/')){
   const sessionId=decodeScope(t.scopePath,'/nord-connection/'),session=nordSsoStore(data)?.sessions.find(s=>s.id===sessionId),parsed=guideSchema.safeParse(session?.guide);
   if(sessionId&&parsed.success&&parsed.data.cursor===`ente/${id}`)return saveNordSsoSession(data,advance({...data,guide:parsed.data}),sessionId);
  }
  if(t.scopePath?.startsWith('/protect/account/')){
   const parentId=decodeScope(t.scopePath,'/protect/account/'),parent=protectionTasks(data).find(p=>p.id===parentId),parsed=guideSchema.safeParse(parent?.childGuide);
   if(parentId&&parsed.success&&parsed.data.cursor===`ente/${id}`)return saveProtectionAccountGuide(data,advance({...data,guide:parsed.data}),parentId);
  }
 }
 if(t.origin==='phone'&&data.version===2&&t.phoneRef){const w=data.deviceWorkflows.find(v=>v.id===t.phoneRef);if(!w)return data;const step=currentPhoneStep(data,w);if(step.enteSourceRef!==t.appRef)return data;const next=confirmPhoneStep(data,w.id);return next===data?data:putEnteTask(next as typeof data,{...t,phoneRecordKey:phoneRecordKey(w,step)});}
 return data;
}
export function enteReturnPath(data:Dataset,id:string):string{
 const t=enteTask(data,id),parent=enteParent(data,id);if(parent)return parent.origin==='guide'?parent.scopePath??'/guide':parent.origin==='phone'&&parent.status==='completed'?`/phone/${encodeURIComponent(parent.phoneRef!)}`:`/ente/${encodeURIComponent(parent.id)}`;return !t?'/guide':t.origin==='phone'?`/phone/${encodeURIComponent(t.phoneRef!)}`:t.origin==='guide'?t.scopePath??'/guide':`/map?item=${encodeURIComponent(t.appRef)}`;
}
export function bindEnteGuidePath(before:Dataset,data:Dataset,path:string):Dataset{
 if(data.version!==2||!data.guide.cursor.startsWith('ente/'))return data;const t=enteTask(data,data.guide.cursor.slice(5));if(!t||t.origin!=='guide'||t.scopePath===path)return data;
 // A task belongs to one actual guide scope. A different scope gets its own
 // progress, preserving the original receipt pointers and return location.
 let next=data;
 if(enteTask(before,t.id)){
  const started=startEnteTask(data,{kind:t.kind,appRef:t.appRef,origin:'guide',accountRef:t.accountRef,rootRef:t.rootRef,returnCursor:t.returnCursor,scopePath:path},undefined,true);
  next={...started.data,guide:{...started.data.guide,cursor:`ente/${started.id}`}};
 }else next=putEnteTask(data,{...t,scopePath:path});
 return t.accountRef?{...next,guide:{...next.guide,answers:{...next.guide.answers,[`auth:${t.accountRef}:scope`]:path}}}:next;
}
