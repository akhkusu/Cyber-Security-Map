import {withStandardContext} from '../e2e/standard-fixture';
import { describe, expect, it } from 'vitest';
import { chooseBitwardenServer, openBitwardenServerCheck } from './bitwardenServer';
import { createEncryptedVault, decryptVault } from './crypto';
import { beginRecipe, completeStep, currentTask, guidePresentation, move, taskCursor, undoStep } from './guideEngine';
import { currentDatasetSchema, makeAsset, newDataset, type Dataset } from './models';
import { standardMasterAccepted, standardMasterResume } from './standardMaster';

function fixture(product: 'bitwarden' | '1password') {
  const data = newDataset('ja');
  const account = { ...makeAsset({kind:'account',type:'Password manager',name:'Manager',importance:'critical'}), id:'manager', provider:product, purpose:'personal' as const, services:['manager' as const] };
  data.assets = [account]; data.guide.managerId = account.id;
  data.guide.answers['manager:region'] = 'eu';
  data.guide.answers['manager:platform'] = 'ios';
  data.guide.cursor = taskCursor(account.id,'manager','existing-signin');
  return withStandardContext(data,'manager');
}
const at = (data:Dataset,step:string) => move(data,taskCursor('manager','manager',step));
function prepared(product:'bitwarden'|'1password') {
  let data:Dataset=completeStep(fixture(product),'master-review');
  data=completeStep(data,'master-current-copy');
  for(let i=0;i<16&&currentTask(data)?.step.id!=='master-submit';i++) data=completeStep(data);
  expect(currentTask(data)?.step.id).toBe('master-submit');
  return data;
}
describe('standard manager password changes',()=>{
  for(const product of ['bitwarden','1password'] as const) {
    it(`${product}: keeping a strong password skips every change operation`,()=>{
      let data:Dataset=completeStep(fixture(product),'master-review');
      data=completeStep(data,'paper');
      expect(data.guide.cursor).toBe('do/manager/manager/paper');
      expect(Object.keys(data.guide.steps)).not.toContain('do/manager/manager/master-submit');
      expect(data.assets[0].controls.mfa).toBe('unknown');
    });
    it(`${product}: changing requires preparation; selection and acceptance create no MFA or recovery`,()=>{
      const original=fixture(product),jumped=at(original,'master-submit');
      expect(currentTask(jumped)?.redirectTo).toBe('do/manager/manager/master-current-copy');
      const data=prepared(product),before=structuredClone(data.assets);
      const accepted=completeStep(data,'master-change-copy');
      expect(standardMasterAccepted(accepted,'manager')).toBe(true);
      expect(accepted.assets).toEqual(before);
      expect(currentDatasetSchema.safeParse(accepted).success).toBe(true);
      expect(standardMasterAccepted(accepted,'another-account')).toBe(false);
    });
    it(`${product}: a rejected or unknown result stays unfinished and retains preparation`,()=>{
      const data=prepared(product),next=completeStep(data,'master-unconfirmed');
      expect(standardMasterAccepted(next,'manager')).toBe(false);
      expect(next.guide.steps['do/manager/manager/master-submit']).toBeUndefined();
      expect(next.guide.cursor).toBe('do/manager/manager/master-unconfirmed');
      expect(next.guide.steps['do/manager/manager/master-candidate-read']?.status).toBe('done');
    });
    it(`${product}: accepted changes resume at copies and real use, including Back and encrypted reload`,async()=>{
      let data=completeStep(prepared(product),'master-change-copy');
      const original=structuredClone(data);
      for(const step of ['install','existing','master','create','existing-signin','master-review','master-candidate','master-submit']) {
        const viewed=at(data,step),before=structuredClone(viewed);
        expect(guidePresentation(viewed).task?.step.id).toBe('master-change-copy');
        expect(viewed).toEqual(before);
      }
      const envelope=await createEncryptedVault('test storage phrase for master change',data);
      data=(await decryptVault(envelope.envelope,'test storage phrase for master change')).data;
      expect(beginRecipe(data,'manager','manager').guide.cursor).toBe('do/manager/manager/master-change-copy');
      data=completeStep(data,product==='bitwarden'?'master-change-test':'master-change-kit');
      if(product==='1password')data=completeStep(data);
      expect(currentTask(data)?.step.id).toBe('master-change-test');
      const unverified=completeStep(data,'master-change-unverified');
      expect(standardMasterResume(unverified,'manager')).toBe('do/manager/manager/master-change-test');
      expect(unverified.guide.steps['do/manager/manager/master-change-test']).toBeUndefined();
      data=completeStep(data,product==='bitwarden'?'auth-ready':'recovery');
      expect(standardMasterResume(data,'manager')).toBeUndefined();
      expect(data.guide.steps['do/manager/manager/master-submit']).toEqual(original.guide.steps['do/manager/manager/master-submit']);
    });
    it(`${product}: removing the accepted-result record does not mark the real password reverted`,()=>{
      const accepted=completeStep(prepared(product),'master-change-copy');
      const undone=undoStep(accepted,'do/manager/manager/master-submit');
      expect(standardMasterAccepted(undone,'manager')).toBe(false);
      expect(undone.assets).toEqual(accepted.assets);
      expect(undone.guide.steps['do/manager/manager/master-current-copy']).toEqual(accepted.guide.steps['do/manager/manager/master-current-copy']);
      expect(currentTask(at(undone,'master-change-test'))?.redirectTo).toBe('do/manager/manager/master-submit');
    });
    it(`${product}: a corrected acceptance cannot borrow a previous change's copy or login`,()=>{
      let data=completeStep(prepared(product),'master-change-copy');
      data=completeStep(data,product==='bitwarden'?'master-change-test':'master-change-kit');
      if(product==='1password')data=completeStep(data);
      data=completeStep(data,product==='bitwarden'?'auth-ready':'recovery');
      expect(standardMasterResume(data,'manager')).toBeUndefined();
      const corrected=undoStep(data,'do/manager/manager/master-submit');
      const acceptedAgain=completeStep(corrected,'master-change-copy');
      expect(standardMasterResume(acceptedAgain,'manager')).toBe('do/manager/manager/master-change-copy');
      expect(acceptedAgain.guide.steps['do/manager/manager/master-change-test']).toEqual(data.guide.steps['do/manager/manager/master-change-test']);
      expect(acceptedAgain.guide.steps['do/manager/manager/master-submit'].standardMasterAttemptV1).not.toBe(data.guide.steps['do/manager/manager/master-submit'].standardMasterAttemptV1);
    });
  }
  it('SSO/passkey/old local accounts do not enter password creation or record completion',()=>{
    const data=fixture('1password'),next=completeStep(data,'master-method-unsupported');
    expect(next.assets).toEqual(data.assets);
    expect(next.guide.steps).toEqual({});
    expect(currentTask(next)?.step.id).toBe('master-method-unsupported');
    expect(currentTask(next)?.step.choices?.every(choice=>choice.record===false)).toBe(true);
  });
  it('a server correction preserves the receipt but never reuses it or repeats the change on another server',()=>{
    const accepted=completeStep(prepared('bitwarden'),'master-change-copy');
    const changed=chooseBitwardenServer(openBitwardenServerCheck(accepted,'manager'),'manager','us','correct');
    expect(standardMasterAccepted(changed,'manager')).toBe(false);
    expect(standardMasterResume(changed,'manager')).toBe('do/manager/manager/master-context-changed');
    expect(guidePresentation(at(changed,'master-submit')).task?.step.id).toBe('master-context-changed');
    expect(changed.guide.steps).toEqual(accepted.guide.steps);
    expect(standardMasterResume(accepted,'manager')).toBe('do/manager/manager/master-change-copy');
  });
});
