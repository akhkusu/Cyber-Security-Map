import {expect,type Page} from '@playwright/test';
import {currentDatasetSchema} from '../src/models';
import {decryptVault} from '../src/crypto';
import {currentKeyStep} from '../src/hardwareKeys';
import {keyTasks,type KeyMode} from '../src/hardwareKeySchemas';
import {passphrase,readSavedVault} from './helpers';
export async function driveNestedKey(page:Page,mode:KeyMode,answers:Record<string,string>={}){
  await expect(page.locator('.key-guide')).toBeVisible();await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
  const location=new URL(page.url()),path=location.hash.startsWith('#/')?location.hash.slice(1).split('?')[0]:location.pathname,id=decodeURIComponent(path.split('/').at(-1)!);
  for(let n=0;n<100;n++){
    const data=currentDatasetSchema.parse((await decryptVault(await readSavedVault(page),passphrase)).data),task=keyTasks(data).find(t=>t.id===id)!;
    if(!task)throw new Error('The expected saved key task was not found');if(task.status==='completed')return {data,task};
    const step=currentKeyStep(data,task),card=page.locator('.key-guide .guide-card');await expect(card.getByRole('heading',{level:1})).toHaveText(step.title[data.settings.language]);
    if(step.kind==='operation')await card.getByRole('button',{name:step.button?.[data.settings.language]??(data.settings.language==='ja'?'次へ':'Next'),exact:true}).click();
    else if(step.kind==='text'){await card.getByRole('textbox').fill('本人用の呼び名');await card.locator('button.button.primary').click();}
    else if(step.kind==='question'){
      const defaults:Record<string,string>={mode,scope:'personal',protection:'standard',device:mode==='apple-keys'?'mac':'pc','key-1':'key1','key-2':'key2','registration-1':'existing','registration-2':'existing',browser:'key-browser','old-factor':'yes'},value=answers[step.id]??defaults[step.id]??step.choices?.[0]?.value,option=step.choices?.find(c=>c.value===value);if(!option)throw new Error(`Missing choice ${value} at ${step.id}`);await card.getByRole('button',{name:option.label[data.settings.language],exact:true}).click();
    }else throw new Error(`Unexpected key step: ${step.id}`);
    await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
  }throw new Error('Nested key guide did not complete');
}
