import type {Dataset,Language} from './models';
import {onePasswordAccount,onePasswordCheck} from './onePasswordAccount';
import {ONEPASSWORD_SOURCES} from './onePasswordSources';
export function onePasswordHelp(data:Dataset,ref:string,language:Language){
 const setting=onePasswordAccount(data,ref),check=onePasswordCheck(data,ref),region=setting?.host.endsWith('.ca')?'CA':setting?.host.endsWith('.eu')?'EU':setting?.host.endsWith('.com')?'US':'unconfirmed';
 return [language==='ja'?'最新の公式資料を確認し、一度に一つの質問・操作を案内してください。確認できなければ明示してください。秘密情報や個人情報は求めないでください。':'Check current official instructions and guide one operation at a time. State any uncertainty. Do not ask for secrets or personal information.',
  'Service: 1Password',`Region: ${region}`,`Account type: ${setting?.kind??'unconfirmed'}`,`Method: ${setting?.method??'unconfirmed'}`,`Current check: ${check.stage}`,`Where: ${check.where??'unconfirmed'}`,
  language==='ja'?'使えるアプリと現在のデータを保持します。パスワード・Secret Key・QR・認証コード・復旧コード・アドレス・組織のログイン先は共有しません。':'Keep working apps and data. No password, Secret Key, QR, verification code, recovery code, email or organization hostname will be shared.',
  ...Object.values(ONEPASSWORD_SOURCES).map(s=>s.url)].join('\n');
}
