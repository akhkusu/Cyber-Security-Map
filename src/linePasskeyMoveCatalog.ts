import type {CurrentDataset} from './models';
import {c,type Copy} from './guideCatalog';
import {lineRecorded,type LineTask} from './lineSchemas';
import {lineAction as act,lineQuestion as ask,lineChoice as ch,lineBlocked as stop,type LineStep} from './lineStep';

export function linePasskeyMovePreparation(data:CurrentDataset,t:LineTask,place:Copy):LineStep[]{
  if(t.answers.history==='none')return [];
  const out:LineStep[]=[];
  out.push(act('key-move:home',c('Open the old LINE Home','旧LINEの「ホーム」を開く'),place,c('Return to Home on the old main LINE.','旧メインのLINEで「ホーム」へ戻ります。'),c('The old main LINE Home is open.','旧メインのLINEの「ホーム」が開いていること。'),['linePin']));
  out.push(act('key-move:settings',c('Open the old LINE Settings','旧LINEの「設定」を開く'),place,c('Tap Settings.','「設定」をタップします。'),c('LINE Settings is open.','LINEの設定が開いていること。'),['linePin']));
  out.push(act('key-move:backup',c('Open Chat history backup','「トークのバックアップ」を開く'),place,c('Under Backup and transfer, open Chat history backup.','「バックアップ・引き継ぎ」の「トークのバックアップ」を開きます。'),c('The intended account’s backup screen is visible.','今回のアカウントのバックアップ画面が見えること。'),['linePin']));
  if(!lineRecorded(data,t,'pin-state')){
    const id='key-move:pin-state';out.push(ask(id,c('Is the chat-backup PIN already set?','バックアップ用PINは設定済みですか？'),[ch('ready','Yes, Backup PIN is available','はい・「バックアップ用のPINコード」がある'),ch('create','No, LINE offers creation','未設定で、LINEから作成できる'),ch('other','Another screen / not sure','別の画面・分からない')],['linePin']));if(!t.answers[id])return out;
    if(t.answers[id]==='other')return [...out,stop('key-move:pin-unknown',c('Keep chat restoration preparation unfinished','履歴復元の準備を未完了で残す'),c('Keep the old LINE and required chats. Do not begin a new main-device login until the required restoration method is ready.','旧LINEと必要なトークを残します。必要な復元手段を用意するまで、新しいメイン端末でのログインを始めません。'),['linePin'])];
    if(t.answers[id]==='create'){
      out.push(act('key-move:pin-start',c('Start backup-PIN creation','バックアップ用PINの作成を開く'),place,c('Tap Back up now.','「今すぐバックアップ」をタップします。'),c('Set your backup PIN is shown.','「バックアップ用のPINコードを作成」が表示されていること。'),['linePin']));
      out.push(act('key-move:pin-create',c('Create the chat-backup PIN in LINE','LINEでバックアップ用PINを作る'),place,c('Create six unpredictable digits in LINE and tap its arrow. Avoid consecutive digits, repeated digits and personal dates. Keep the value in your chosen safe reminder, never in this app.','推測しにくい6桁をLINEで設定し、右矢印を押します。連番・同じ数字・誕生日などは避け、安全な控えを本人の保管先へ置きます。このアプリへは入力しません。'),c('LINE accepted the PIN; this does not prove an older cloud backup has finished.','LINEにPINが受け付けられたこと。以前のクラウドバックアップが正常終了した意味ではありません。'),['linePin']));
    }
  }
  out.push(act('key-move:pin-open',c('Open the existing backup PIN','既存のバックアップ用PINを開く'),place,c('Tap Backup PIN. Use the phone’s existing unlock if asked. Do not select Reset.','「バックアップ用のPINコード」をタップします。求められたら端末の既存のロック解除を使い、「変更」は選びません。'),c('The current chat-backup PIN is visible in LINE.','LINEで現在のバックアップ用PINが見えること。'),['linePin']));
  out.push(act('key-move:pin-keep',c('Keep the current chat-backup PIN available','今のバックアップ用PINを確保する'),place,c('Make sure you can retrieve this exact existing PIN without the old phone, using your own secure reminder. It is separate from the phone unlock and app-storage passphrase.','自分の安全な控えから、旧端末なしでも同じ現在のPINを取り出せることを確かめます。端末のロック解除や、このアプリの保存用パスフレーズとは別です。'),c('The PIN needed for the selected history remains accessible without the old phone.','選んだ履歴に必要なPINを、旧端末なしで取り出せること。'),['linePin']));
  return out;
}
export function linePasskeyNativeSteps(t:LineTask,place:Copy,android:boolean):LineStep[]{
  const out:LineStep[]=[];
  if(t.cutover?.phase==='requested'){
    out.push(act('key-login:open',c('Open Log in on the new LINE','新端末のLINEで「ログイン」を開く'),place,c('Tap Log in. If you already completed this attempt, continue to report its current result instead of starting another login.','「ログイン」をタップします。今回の操作を既に済ませた場合は、新しいログインを始めず、現在の結果を確認するところへ進みます。'),c('The current sign-in options or actual result are visible.','現在のログイン方法、または実際の結果が見えること。'),['linePasskeyMove'],{phase:'transfer'}));
    if(android)out.push(act('key-login:main',c('Choose Main device if asked','求められたら「メイン端末」を選ぶ'),place,c('If asked for the role, choose Main device and confirm OK. If already selected, keep that main-device attempt.','役割を聞かれたら「メイン端末」を選び「OK」で確認します。既に選択済みなら、今回のメイン端末の操作を保ちます。'),c('This is the intended main-device transfer.','今回のメイン端末への引き継ぎであること。'),['linePasskeyMove'],{phase:'transfer'}));
    out.push(act('key-login:other',c('Open Log in with another method','「その他の方法でログイン」を開く'),place,c('Tap Log in with another method. If the current attempt has already finished, do not start it again.','「その他の方法でログイン」をタップします。今回の操作が既に終わっていれば、もう一度始めません。'),c('The other sign-in methods or the actual result are visible.','ほかのログイン方法、または実際の結果が見えること。'),['linePasskeyMove'],{phase:'transfer'}));
    out.push(act('key-login:choose',c('Choose the registered passkey','登録したパスキーを選ぶ'),place,c('Tap Log in with passkey or Continue with passkey, as displayed. Choose the exact LINE passkey and store prepared earlier. If another account or store is shown, stop before confirming.','表示された「パスキーでログイン」をタップし、先ほど準備した同じLINEのパスキーと保存先を選びます。別アカウントや別の保存先なら、確定する前に止めます。'),c('The intended LINE passkey is selected in the native prompt, or you can report the existing result.','正規の確認画面で今回のLINEパスキーを選べた、または既存の結果を確認できること。'),['linePasskeyMove','lineAndroidPasskey','lineApplePasskey'],{phase:'transfer'}));
    out.push(act('key-login:unlock',c('Complete this phone’s native identity check','この端末の正規の本人確認を行う'),place,c('Use the new phone’s existing biometric or screen unlock for this LINE passkey. Do not enter it into this app. If already accepted, do not repeat the login; check its current result.','今回のLINEパスキーに対して、新端末の既存の生体認証・画面ロック解除を使います。このアプリへは入力しません。既に受け付けられていればログインを繰り返さず、現在の結果を確かめます。'),c('The native operation is finished or you can identify its current result.','正規画面の操作を終えた、または現在の結果を見分けられること。'),['linePasskeyMove','lineAndroidPasskey'],{phase:'transfer'}));
  }
  out.push({...ask('key-login:result',c('Which method actually completed this LINE login?','今回のLINEログインは、実際にどの方法で進みましたか？'),[ch('passkey','The prepared passkey was accepted','準備したパスキーが受け付けられた'),ch('other','I used another method in LINE','LINEで別の方式を使った'),ch('unknown','It failed / another account / still uncertain','失敗・別アカウント・結果が不明')],['linePasskeyMove'],c('Report what actually happened. Choosing a passkey or viewing its item alone is not a successful passkey login.','実際の結果を選びます。パスキーを選んだことや保存項目の表示だけでは、パスキーログイン成功にしません。')),phase:'use'});
  if(t.answers['key-login:result']==='unknown')out.push(stop('key-login:unknown',c('Keep this transfer result unconfirmed','今回の引き継ぎ結果を未確認で残す'),c('Keep both phones and existing methods. Do not repeat the main-device login until its actual result is known. Correct the result here when it is visible.','両端末と既存の方式を残します。実際の結果が分かるまで、メイン端末のログインを繰り返しません。結果が見えたら、ここで回答を訂正します。'),['linePasskeyMove']));
  return out;
}
