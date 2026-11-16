import {useState} from 'react';
import type {Dataset,Language} from './models';
import {onePasswordHelp} from './onePasswordHelp';
import {tx} from './ui';
export function OnePasswordHelp({data,language,accountRef}:{data:Dataset;language:Language;accountRef:string}){
 const [unresolved,setUnresolved]=useState(false),[copied,setCopied]=useState(false),prompt=onePasswordHelp(data,accountRef,language);
 return <section className="technical">{!unresolved?<button className="text-button" onClick={()=>setUnresolved(true)}>{tx(language,'These instructions did not resolve it','この案内では解決しなかった')}</button>:<><p>{tx(language,'You may manually copy this limited context to ask for help. Check it before sharing.','必要なら、この限定した内容を手動でコピーして相談できます。共有する前に内容を確認してください。')}</p><textarea aria-label={tx(language,'Help context without private account details','アカウントの私的情報を除いた相談文')} value={prompt} readOnly rows={7}/><button className="button secondary" onClick={()=>void navigator.clipboard.writeText(prompt).then(()=>setCopied(true)).catch(()=>setCopied(false))}>{tx(language,'Copy the AI help prompt','AIへの相談文をコピーする')}</button>{copied&&<p role="status">{tx(language,'Copied','コピーしました')}</p>}</>}</section>;
}
