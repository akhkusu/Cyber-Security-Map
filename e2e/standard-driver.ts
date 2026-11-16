import {expect,type Page} from '@playwright/test';
import type {Language} from '../src/models';
import {advance} from './helpers';
export async function checkStandardContext(page:Page,language:Language='ja',deviceName?:string){
 const word=(ja:string,en:string)=>language==='ja'?ja:en;
 for(let i=0;i<10&&await page.locator('.standard-context-check').count();i++){
  const root=page.locator('.standard-context-check'),heading=await root.locator('h1').textContent();
  if(heading===word('実際に使う保管庫はどれですか？','Which vault will you actually use?')){
   const choices=root.locator('.choices button');
   if(await choices.count())await choices.first().click();
   else {await root.getByLabel(word('実際の保管庫の呼び名','Name of the actual vault'),{exact:true}).fill(word('自分専用の保管庫','My private vault'));await root.getByRole('combobox',{name:word('この保管庫を使える人','Who can use this vault?'),exact:true}).selectOption('private');await root.getByRole('button',{name:word('この保管庫を記録する','Record this vault'),exact:true}).click();}
  }else if(heading===word('実際に操作している端末はどれですか？','Which physical device are you using?')){
   const choices=root.locator('.choices button');
   if(await choices.count())await (deviceName?root.getByRole('button',{name:deviceName,exact:true}):choices.first()).click();
   else {await root.getByText(word('別の端末を登録する','Register another device'),{exact:true}).click();await root.getByRole('button',{name:'iPhone / iPad',exact:true}).click();}
  }else if(heading===word('使うアプリ・ブラウザープロフィールを選ぶ','Choose the app or browser profile')){
   const choices=root.locator('.choices button');if(await choices.count())await choices.first().click();else await root.getByRole('button',{name:word('別のアプリ・プロフィールとして使う','Use a different app or profile'),exact:true}).click();
  }else if(heading===word('この利用場所で、今回のアカウントと保管庫を開く','Open this account and this vault here'))await root.getByRole('button',{name:word('ここで今回の保管庫を開けました','I opened this exact vault here'),exact:true}).click();
  else if(heading===word('保存パスワードの入力方法を確認する','Check how you will fill a saved password'))await root.getByRole('button',{name:word('この利用場所での入力方法を確認しました','I checked the filling method here'),exact:true}).click();
  else throw Error(`Unexpected standard context question ${heading}`);
  await expect(page.locator('.workspace-body')).toHaveAttribute('aria-busy','false');
 }
 await expect(page.locator('.standard-context-check')).toHaveCount(0);
}
export async function checkOnePassword(page:Page,language:Language='ja',host='my.1password.eu',kind:'individual'|'family'|'team'|'business'='individual',method:'password'|'sso'|'passkey-beta'='password'){
 const word=(ja:string,en:string)=>language==='ja'?ja:en;
 if(!await page.locator('.onepassword-check').count())return;
 await advance(page,word('Emergency Kitで確認する','Read my Emergency Kit'));
 await advance(page,word('今回のアカウントのログイン先が分かりました','I found this account’s address'));
 await page.getByLabel(word('ログイン先のホスト名','Sign-in host'),{exact:true}).fill(host);await advance(page,word('次へ','Next'));
 await advance(page,({individual:word('個人','Individual'),family:word('家族','Families'),team:word('チーム','Teams'),business:'Business'})[kind]);
 await advance(page,({password:word('アカウントパスワードとSecret Key','Account password and Secret Key'),sso:word('会社・学校のSSO','My organization’s SSO'),'passkey-beta':word('既存のパスキー用テストアカウント','An existing passkey test account')})[method]);
}
