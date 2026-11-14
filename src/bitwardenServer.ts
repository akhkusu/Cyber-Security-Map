import {z} from 'zod';
import {DataUpgradeConflict,makeAsset,type Dataset,type Language} from './models';
import {BITWARDEN_SERVER_SOURCES,BITWARDEN_SERVER_SCREENS} from './bitwardenServerCatalog';

export type BitwardenRegion='us'|'eu';
export const bitwardenWebURL=(region?:string):string|undefined=>region==='us'?'https://vault.bitwarden.com/':region==='eu'?'https://vault.bitwarden.eu/':undefined;
const serverSchema=z.object({version:z.literal(1),region:z.enum(['us','eu']),evidence:z.enum(['user-confirmed','selected-for-new']),checkedAt:z.string()}).passthrough();
export function bitwardenServerConfirmation(data:Dataset,accountRef:string){const parsed=serverSchema.safeParse(data.assets.find(a=>a.id===accountRef)?.bitwardenServerV1);return parsed.success?parsed.data:undefined;}
export function bitwardenRegion(data:Dataset,accountRef:string):BitwardenRegion|undefined{
 const value=data.guide.answers[`${accountRef}:region`];
 const account=data.assets.find(a=>a.id===accountRef),stored=account&&Object.hasOwn(account,'bitwardenServerV1')?serverSchema.safeParse(account.bitwardenServerV1):undefined;
 if(stored&&!stored.success)return undefined;
 if(stored?.success&&stored.data.region!==value)return undefined;
 return value==='us'||value==='eu'?value:undefined;
}
const checkSchema=z.object({version:z.literal(1),accountRef:z.string(),returnCursor:z.string(),mode:z.enum(['existing','new','unknown']),stage:z.enum(['mode','where','read','choose','different','problem']),where:z.enum(['web','ios','android','login']).optional(),selected:z.enum(['us','eu']).optional(),problem:z.enum(['screen','self-hosted','unknown']).optional()}).passthrough();
export type BitwardenServerCheck=z.infer<typeof checkSchema>;
const checksSchema=z.object({version:z.literal(1),checks:z.array(checkSchema)}).passthrough();
export function serverCheckSupported(data:Dataset,accountRef?:string){
 const account=data.assets.find(a=>a.id===accountRef);
 return (!Object.hasOwn(data.guide,'bitwardenServerChecksV1')||checksSchema.safeParse(data.guide.bitwardenServerChecksV1).success)&&(!account||!Object.hasOwn(account,'bitwardenServerV1')||serverSchema.safeParse(account.bitwardenServerV1).success);
}
export function bitwardenServerCheck(data:Dataset,accountRef:string):BitwardenServerCheck{
 const saved=checksSchema.safeParse(data.guide.bitwardenServerChecksV1);
 const match=saved.success?[...saved.data.checks].reverse().find(check=>check.accountRef===accountRef&&(check.returnCursor===data.guide.cursor||data.guide.cursor===`standard-server/${accountRef}`)):undefined;
 if(match)return match;
 const [,subject,recipe,step]=data.guide.cursor.split('/');
 const mode=recipe==='manager'&&subject===accountRef&&step==='create'?'new':data.guide.cursor.startsWith('do/')?'existing':'unknown';
 return {version:1,accountRef,returnCursor:data.guide.cursor,mode,stage:mode==='new'?'choose':mode==='existing'?'where':'mode'};
}
function putCheck(data:Dataset,check:BitwardenServerCheck):Dataset{
 const saved=checksSchema.safeParse(data.guide.bitwardenServerChecksV1),store=saved.success?saved.data:{version:1 as const,checks:[]};
 return {...data,guide:{...data.guide,bitwardenServerChecksV1:{...store,checks:[...store.checks.filter(item=>item.accountRef!==check.accountRef||item.returnCursor!==check.returnCursor),check]}}};
}
function writable(data:Dataset,accountRef:string){
 if(!serverCheckSupported(data,accountRef))throw new DataUpgradeConflict();
 if(!data.assets.some(a=>a.id===accountRef&&a.provider==='bitwarden'))throw Error('invalid-bitwarden-account');
}
export function updateBitwardenServerCheck(data:Dataset,accountRef:string,patch:Partial<Pick<BitwardenServerCheck,'mode'|'stage'|'where'|'selected'|'problem'>>):Dataset{
 writable(data,accountRef);
 return putCheck(data,checkSchema.parse({...bitwardenServerCheck(data,accountRef),...patch}));
}
export function openBitwardenServerCheck(data:Dataset,accountRef:string):Dataset{
 writable(data,accountRef);
 const inferred=bitwardenServerCheck(data,accountRef),mode=inferred.mode==='new'?'new':'existing';
 const check:BitwardenServerCheck={...inferred,version:1,accountRef,returnCursor:data.guide.cursor===`standard-server/${accountRef}`?inferred.returnCursor:data.guide.cursor,mode,stage:mode==='new'?'choose':'where'};
 const next=putCheck(data,check);
 return {...next,guide:{...next.guide,cursor:`standard-server/${accountRef}`,history:[...data.guide.history,data.guide.cursor].slice(-200)}};
}
/** A region choice changes metadata only; it never completes account protection. */
export function chooseBitwardenServer(data:Dataset,accountRef:string,region:BitwardenRegion,decision?:'correct'|'separate',at=new Date().toISOString()):Dataset{
 writable(data,accountRef);
 const account=data.assets.find(a=>a.id===accountRef)!,previous=serverSchema.safeParse(account.bitwardenServerV1);
 const check=bitwardenServerCheck(data,accountRef),old=previous.success?previous.data.region:bitwardenRegion(data,accountRef);
 if(old&&old!==region&&!decision)return updateBitwardenServerCheck(data,accountRef,{selected:region,stage:'different'});
 const evidence=check.mode==='new'?'selected-for-new':'user-confirmed';
 if(decision==='separate'){
  const account={...makeAsset({kind:'account',type:'Password manager',name:`Bitwarden · ${data.assets.filter(a=>a.provider==='bitwarden').length+1}`,importance:'critical'}),provider:'bitwarden' as const,purpose:'personal' as const,services:['manager' as const],bitwardenServerV1:{version:1,region,evidence,checkedAt:at}};
  return {...data,assets:[...data.assets,account],guide:{...data.guide,managerId:account.id,cursor:`platform/${account.id}/manager`,history:[...data.guide.history,check.returnCursor].slice(-200),answers:{...data.guide.answers,[`${account.id}:region`]:region}}};
 }
 const next=putCheck(data,{...check,stage:'choose',selected:region});
 return {...next,assets:data.assets.map(a=>a.id===accountRef?{...a,bitwardenServerV1:{...(previous.success?previous.data:{}),version:1,region,evidence,checkedAt:at}}:a),guide:{...next.guide,cursor:check.returnCursor,answers:{...data.guide.answers,[`${accountRef}:region`]:region}}};
}
export function confirmBitwardenServerUse(data:Dataset,accountRef:string,at:string):Dataset{
 writable(data,accountRef);const region=bitwardenRegion(data,accountRef);if(!region)return data;
 const account=data.assets.find(a=>a.id===accountRef)!,previous=serverSchema.safeParse(account.bitwardenServerV1);
 return {...data,assets:data.assets.map(a=>a.id===accountRef?{...a,bitwardenServerV1:{...(previous.success?previous.data:{}),version:1,region,evidence:'user-confirmed',checkedAt:at}}:a)};
}
export function bitwardenServerHelp(data:Dataset,accountRef:string,language:Language):string{
 const check=bitwardenServerCheck(data,accountRef),where=check.where??'unknown';
 const ja=language==='ja';
 return [ja?'最新のBitwarden公式資料を確認し、一度に一つの質問または操作を案内してください。確認できなければ、その旨を明示してください。':'Check current official Bitwarden documentation. Give one question or operation at a time. Say if current information cannot be checked.',
  'Service: Bitwarden',`Screen / OS family: ${where} (exact version unconfirmed)`,
  ja?'作業: 現在利用しているアカウントのサーバーを確認する':'Task: identify the server of the existing account',
  `Current step: ${check.stage}`,`${ja?'想定する表示':'Expected display'}: ${check.where?BITWARDEN_SERVER_SCREENS[check.where].expected[language]:'Server / Logging in on'}`,
  `${ja?'困りごと':'Problem'}: ${check.problem==='self-hosted'?'self-hosted / another server':check.problem==='unknown'?'cannot identify the server':'the described screen or item is missing'}`,
  ...Object.values(BITWARDEN_SERVER_SOURCES).map(s=>s.url),
  ja?'現在使えるアプリをログアウト・初期化せず確認してください。パスワード・コード・メールアドレス等の個人情報を求めないでください。':'Preserve working apps without signing out or resetting. Do not request passwords, codes, email addresses or other personal information.'].join('\n');
}
