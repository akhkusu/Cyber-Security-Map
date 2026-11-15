import {makeAsset,type CurrentDataset,type Dataset} from '../src/models';
import {saveOnePasswordAccount,onePasswordAccount} from '../src/onePasswordAccount';
import {addStandardVault,selectStandardDevice,addStandardApp,confirmStandardContext,selectedStandardContext,standardContextReady,updateStandardCheck} from '../src/standardContexts';

/** An explicit test setup: the fixture user confirms a private vault and actual client. */
export function withStandardContext(input:Dataset,ref:string,client:'web'|'app'|'extension'='web'):CurrentDataset{
 let data=input;
 if(data.assets.find(a=>a.id===ref)?.provider==='1password'&&!onePasswordAccount(data,ref))data=saveOnePasswordAccount(data,ref,{host:'my.1password.eu',kind:'individual',method:'password'});
 const original=data.guide;
 if(standardContextReady(data,ref,client))return data as CurrentDataset;
 if(!data.assets.some(a=>a.kind==='device')){const device={...makeAsset({kind:'device',type:'Computer',name:'Fixture computer',importance:'critical',operatingSystem:'windows'}),id:'fixture-device'};data={...data,assets:[...data.assets,device]};}
 const device=data.assets.find(a=>a.kind==='device')!;
 const selected=selectedStandardContext(data,ref);
 data=updateStandardCheck(data,ref,{stage:'vault',client});
 if(!selected)data=addStandardVault(data,ref,'Fixture private vault','private');
 else data=updateStandardCheck(data,ref,{vaultRef:selected.vault.id,stage:'device'});
 data=selectStandardDevice(data,ref,device.id);data=addStandardApp(data,ref,client,'Fixture profile');
 data=confirmStandardContext(data,ref);data=confirmStandardContext(data,ref);
 return {...data,guide:{...data.guide,...original,standardContextChecksV1:data.guide.standardContextChecksV1}} as CurrentDataset;
}
