import type {Dataset,Language} from './models';
import {protectionStore,protectionTasks,protectionSettingKey} from './deviceProtectionSchemas';
import {protectionFeatureLabel} from './deviceProtectionCatalog';
import {protectionRecordCurrent} from './deviceProtectionEvidence';
import {evaluateAccess} from './securityModel';
export function protectionMapStatus(data:Dataset,deviceRef:string,language:Language){
  if(data.version!==2)return;const store=protectionStore(data);if(!store||!store.tasks.some(t=>t.deviceRef===deviceRef))return;
  const ja=language==='ja',setting=store.settings[protectionSettingKey(deviceRef,'find-enabled')],task=store.tasks.find(t=>t.id===setting?.taskRef);
  const live=!!setting&&!setting.withdrawn&&!!task&&protectionRecordCurrent(data.securityModel,task,setting.recordRef);
  if(!live)return {tone:'unknown',label:ja?'探索の設定を確認':'Check device finding',reason:ja?'この実物の端末の探索設定は未確認':'Finding on this actual device is unconfirmed'};
  if(setting.value==='off')return {tone:'needs-work',label:ja?'探索設定はオフ':'Device finding is off',reason:ja?'正規設定でオフを確認した記録':'Recorded an OFF value in the official settings'};
  if(setting.value!=='on')return {tone:'unknown',label:ja?'探索機能は利用不可・未確認':'Finding unavailable / unconfirmed',reason:ja?'別の対応手順・手段を確認する':'Check an applicable recipe or another method'};
  const off=Object.values(store.settings).find(s=>s.deviceRef===deviceRef&&s.value==='off'&&!s.withdrawn&&['stolen-device-protection','theft-detection','offline-lock','remote-lock','identity-check'].includes(s.feature)&&protectionTasks(data).some(t=>t.id===s.taskRef&&protectionRecordCurrent(data.securityModel,t,s.recordRef)));
  if(off)return {tone:'needs-work',label:ja?'オフの保護設定あり':'A protection setting is off',reason:`${protectionFeatureLabel(off.feature)[language]} · ${ja?'オフを確認した記録':'OFF value recorded'}`};
  const used=data.securityModel.routes.some(r=>r.targetRef===deviceRef&&r.purpose==='device-management'&&r.deviceProtectionRouteV1==='v1'&&evaluateAccess(data.securityModel,r.id,{context:r.contexts[0],now:new Date().toISOString()}).state==='available');
  return {tone:used?'recorded':'unknown',label:ja?used?'別端末から管理した記録あり':'別端末からの管理は未確認':used?'Management used from another device':'Management from another device unconfirmed',reason:ja?'探索設定と管理画面の利用を別に記録':'Finding configuration and management use are separate records'};
}
