import type {Dataset} from './models';
import {c} from './guideCatalog';
import {appendProtectionIdentity,makeProtectionBuilder,protectionSources,type ProtectionStep} from './deviceProtectionCatalog';
import {appendProtectionFind,appendProtectionLock} from './deviceProtectionSetup';
import {appendAppleTheft,appendAndroidTheft} from './deviceProtectionTheft';
import {appendProtectionManagement} from './deviceProtectionManagement';
import type {ProtectionTask} from './deviceProtectionSchemas';

export function protectionSteps(data:Dataset,task:ProtectionTask):ProtectionStep[]{
  const b=makeProtectionBuilder(task);
  if(!appendProtectionIdentity(b,data,task)||!appendProtectionLock(b,data,task)||!appendProtectionFind(b,task)||!appendAppleTheft(b,data,task)||!appendAndroidTheft(b,data,task)||!appendProtectionManagement(b,data,task))return b.steps;
  b.steps.push({id:'finished',kind:'finished',title:c('Your device checks are recorded','端末で確認した作業を記録しました'),action:c('Review the recorded settings below. Deferred checks remain unfinished. A recorded setup is not a guarantee of finding a lost device.','記録した設定は下で見直せます。後回しにした確認は、まだ済んでいません。設定の記録は、紛失時に必ず見つかることを保証するものではありません。'),sources:protectionSources(task)});return b.steps;
}
