import {useNavigate,useParams} from 'react-router-dom';
import type {Dataset,Language} from './models';
import {Guide} from './Guide';
import {tx} from './ui';
import {saveStandardPhone,standardPhoneData,standardPhoneReady,standardPhoneSession,startStandardPhone} from './standardPhone';
import {confirmPhoneStep} from './phoneEngine';
export function StandardPhoneLauncher({data,language,save,phoneRef,accountRef}:{data:Dataset;language:Language;save:(d:Dataset)=>Promise<boolean>;phoneRef:string;accountRef:string}){
 const navigate=useNavigate();return <button className="button primary" onClick={async()=>{const started=startStandardPhone(data,phoneRef,accountRef);if(await save(started.data))navigate(`/standard-phone/${started.sessionId}`);}}>{tx(language,'Check this manager on the new phone','新端末で、このマネージャーの利用を確認する')}</button>;
}
export function StandardPhoneSession({data,language,save}:{data:Dataset;language:Language;save:(d:Dataset)=>Promise<boolean>}){
 const {sessionId=''}=useParams(),navigate=useNavigate(),session=standardPhoneSession(data,sessionId),child=standardPhoneData(data,sessionId);
 if(!session||!child)return <section className="panel"><h1>{tx(language,'This phone task was not found','この機種変更の作業が見つかりません')}</h1></section>;
 if(data.version===2&&data.deviceWorkflows.find(w=>w.id===session.phoneRef)?.newDeviceRef!==session.deviceRef)return <section className="panel"><h1>{tx(language,'These checks belong to the previous destination','この確認は、以前の移行先の記録です')}</h1><p>{tx(language,'The records are retained. Continue with the actual device now selected for the phone change.','記録は保持しています。機種変更で現在選んでいる、実際の移行先の端末から続きを進めてください。')}</p><button className="button primary" onClick={()=>navigate(`/phone/${session.phoneRef}`)}>{tx(language,'Return to the phone change','機種変更へ戻る')}</button></section>;
 if(session.status==='completed'&&standardPhoneReady(data,session.phoneRef,session.accountRef,sessionId))return <section className="panel"><h1>{tx(language,'This manager works on the new phone','新端末で今回のマネージャーを使えました')}</h1><button className="button primary" onClick={()=>navigate(`/phone/${session.phoneRef}`)}>{tx(language,'Return to the phone change','機種変更へ戻る')}</button></section>;
 return <><button className="text-button" onClick={()=>navigate(`/phone/${session.phoneRef}`)}>{tx(language,'Pause and return to the phone change','途中の作業を残して、機種変更へ戻る')}</button><Guide data={child} language={language} save={async next=>{
  let updated=saveStandardPhone(data,sessionId,next);
  const finished=standardPhoneReady(updated,session.phoneRef,session.accountRef,sessionId);
  if(finished)updated=confirmPhoneStep(updated,session.phoneRef) as typeof updated;
  const ok=await save(updated);if(ok&&finished)navigate(`/phone/${session.phoneRef}`);return ok;
 }}/></>;
}
