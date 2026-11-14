import type {Dataset} from './models';
import {c} from './guideCatalog';
import type {ProtectionBuilder,ProtectionSource,ProtectionStep} from './deviceProtectionCatalog';
import type {ProtectionTask} from './deviceProtectionSchemas';
const option=(value:string,en:string,ja:string)=>({value,label:c(en,ja)});
export function appendProtectionLock(b:ProtectionBuilder,data:Dataset,t:ProtectionTask):boolean{
  const a=t.answers,apple=['iphone','ipad'].includes(a.form),maker=a['android-maker'],asset=data.assets.find(d=>d.id===t.deviceRef);
  if(asset?.controls.screenLock==='verified'&&asset.controlEvidence.screenLock==='user-confirmed')return true;
  const sources:ProtectionSource[]=apple?['applePasscode']:maker==='pixel'?['pixelLock']:maker==='galaxy'?['galaxyLock','galaxyLockEn']:['googleLock'];
  if(!b.question('lock-state',c('Check that the screen requires you to unlock it','画面ロックの解除が必要か確認する'),[option('ready','It required my code or biometrics','コード・生体認証による解除が必要でした'),option('setup','It used no code / only a swipe','コードがなく、スワイプだけで開きました'),option('unavailable','I cannot check it','確認できません')],c('Lock the actual device with its side or power button, then unlock it. Keep an existing strong code. This app never asks you to type that code.','実際の端末をサイド／電源ボタンでロックしてから解除します。強いコードがあれば維持します。コードをこのアプリへ入力しません。'),{kind:'check',place:c('The actual device screen','今回の端末の画面'),sources,recordKind:'prerequisite',recordValues:['ready'],control:'screenLock',expected:c('A code or working biometric check is needed to unlock.','解除にコードか、使える生体認証が必要なこと。')}))return false;
  if(a['lock-state']==='ready')return true;
  if(a['lock-state']==='unavailable'){b.blocked('lock-unavailable',c('Keep this check unfinished','画面ロックの確認を未完了で残します'),c('Use an existing way to unlock the device. Do not erase it or remove a working lock to force this guide.','現在使える方法で端末を解除してください。この案内に合わせるために初期化したり、使えるロックを解除したりしません。'),{sources});return false;}
  const nav=(id:string,titleEn:string,titleJa:string,actionEn:string,actionJa:string)=>b.operation(id,c(titleEn,titleJa),c('Device Settings','端末の設定'),c(actionEn,actionJa),c('The named settings page is open.','指定した設定画面が開いていること。'),{sources});
  nav('lock-settings','Open Settings','「設定」を開く','Open the Settings app on this device.','今回の端末で「設定」アプリを開きます。');
  if(apple){
    if(!b.question('lock-menu',c('Which passcode settings are shown?','表示されているパスコードの設定は？'),[option('face','Face ID & Passcode','Face IDとパスコード'),option('touch','Touch ID & Passcode','Touch IDとパスコード'),option('code','Passcode','パスコード')],c('Read the menu on this device; do not choose a biometric method it does not have.','今回の端末のメニューを見て選びます。搭載されていない生体認証は選びません。'),{sources}))return false;
    const en=a['lock-menu']==='face'?'Face ID & Passcode':a['lock-menu']==='touch'?'Touch ID & Passcode':'Passcode',ja=a['lock-menu']==='face'?'Face IDとパスコード':a['lock-menu']==='touch'?'Touch IDとパスコード':'パスコード';
    nav('lock-open','Open the passcode settings','パスコードの設定を開く',`Tap ${en}.`,`「${ja}」をタップします。`);
    nav('lock-turn-on','Start setting a passcode','パスコードの設定を始める','Tap Turn Passcode On. Keep an existing code if one is already set.','「パスコードをオンにする」をタップします。すでに設定されていれば、現在のコードを残します。');
    b.operation('lock-enter',c('Create the device code privately','端末のコードを本人だけで作る'),c('The native passcode screen','端末のパスコード設定画面'),c('Enter a new six-digit code in Settings. For a longer code, Passcode Options offers custom numeric or alphanumeric codes. Avoid a birthday or repeated digits; no example here is a password to use.','「設定」で新しい6桁のコードを入力します。長くする場合は「パスコードオプション」のカスタム数字／英数字コードを使えます。誕生日や同じ数字の繰り返しは避けます。このアプリへは入力しません。'),c('Settings asks you to confirm the new code.','「設定」でコードの再入力を求められること。'),{sources});
    b.operation('lock-repeat',c('Confirm it in Settings','「設定」でコードを確定する'),c('The native confirmation screen','端末の確認画面'),c('Enter the same code again in Settings to activate it.','同じコードを「設定」へもう一度入力して確定します。'),c('The device reports a passcode is set.','パスコードが設定された状態になること。'),{sources});
  }else{
    if(maker==='pixel'){
      nav('lock-security','Open Security & privacy','「セキュリティとプライバシー」を開く','Tap Security & privacy.','「セキュリティとプライバシー」をタップします。');
      nav('lock-device-unlock','Open Device unlock','「デバイスのロック解除」を開く','Tap Device unlock.','「デバイスのロック解除」をタップします。');
      nav('lock-open','Open Screen lock','「画面ロック」を開く','Tap Screen lock.','「画面ロック」をタップします。');
    }else if(maker==='galaxy'){
      nav('lock-aod','Open Lock screen and AOD','「ロック画面とAOD」を開く','Tap Lock screen and AOD.','「ロック画面とAOD」をタップします。');
      if(!b.question('galaxy-lock-menu',c('Which lock entry is shown?','ロックの項目は、どちらの表示ですか？'),[option('biometrics','Screen lock and biometrics','画面ロックと生体認証'),option('type','Screen lock type','画面ロックの種類')],c('Galaxy versions use different labels. Choose the one actually shown.','Galaxyの版で表記が異なります。実際に表示された方を選びます。'),{sources}))return false;
      nav('lock-open','Open the selected lock entry','選んだロックの項目を開く',a['galaxy-lock-menu']==='biometrics'?'Tap Screen lock and biometrics.':'Tap Screen lock type.',a['galaxy-lock-menu']==='biometrics'?'「画面ロックと生体認証」をタップします。':'「画面ロックの種類」をタップします。');
    }else{
      nav('lock-security','Open Security','「セキュリティ」を開く','Tap Security. If it is missing, use Something is different instead of guessing a menu.','「セキュリティ」をタップします。見つからなければ項目を推測せず、「うまくいかない」から分岐してください。');
      nav('lock-open','Open Screen lock','「画面ロック」を開く','Tap Screen lock.','「画面ロック」をタップします。');
    }
    nav('lock-kind','Choose PIN or Password','「PIN」か「パスワード」を選ぶ','Choose a strong Password or a PIN of at least six digits. Do not choose None or Swipe.','強い「パスワード」か、6桁以上の「PIN」を選びます。「なし」「スワイプ」は選びません。');
    b.operation('lock-enter',c('Enter the new lock privately','端末のロック情報を本人だけで入力する'),c('The native lock setup','端末のロック設定'),c('Create the code only in the native settings. Avoid an easily guessed sequence. Continue to the native confirmation; never type the code here.','推測しにくいものを、端末の正規設定へだけ入力します。その設定画面の確認へ進んでください。このアプリには入力しません。'),c('The native settings ask for the same code again.','端末の設定で、同じものの再入力を求められること。'),{sources});
    b.operation('lock-repeat',c('Confirm it in the native settings','端末の設定で確定する'),c('The native confirmation','端末の確認画面'),c('Enter the same code again in the native confirmation. On Galaxy, tap OK after re-entering it.','正規の確認画面で同じものを再入力して確定します。Galaxyでは「OK」をタップします。'),c('PIN or Password is now the configured screen lock.','「PIN」か「パスワード」が画面ロックとして設定されたこと。'),{sources});
    if(maker==='galaxy')nav('lock-save','Finish the native setup','端末側の設定を終える','Tap Done if the native setup shows it.','正規設定で「完了」をタップします。');
  }
  b.operation('lock-check',c('Try locking and unlocking once','一度ロックして、解除する'),c('The device screen','端末の画面'),c('Lock the device, then unlock with the code you just set.','端末を一度ロックし、設定したコードを使って解除します。'),c('You needed the code to unlock it.','解除に設定したコードが必要だったこと。'),{sources,recordKind:'prerequisite',control:'screenLock',button:c('I unlocked it with my code','コードで解除できました')});return true;
}

export function appendProtectionFind(b:ProtectionBuilder,t:ProtectionTask):boolean{
  const a=t.answers,apple=['iphone','ipad'].includes(a.form),sources:ProtectionSource[]=apple?['appleFind']:['googleFind'],place=c('This device’s Settings','今回の端末の「設定」');
  const nav=(id:string,en:string,ja:string,actionEn:string,actionJa:string,extra:Partial<ProtectionStep>={})=>b.operation(id,c(en,ja),place,c(actionEn,actionJa),c('The named settings page is open.','指定した設定画面が開いていること。'),{sources,...extra});
  nav('account-settings','Open Settings','「設定」を開く','Open Settings on the actual device.','今回の実物の端末で「設定」を開きます。');
  if(apple)nav('account-name','Open your Apple Account','Apple Accountを開く','Tap your name at the top of Settings.','「設定」の上部にある自分の名前をタップします。');
  else if(a['android-maker']==='galaxy'){
    nav('account-accounts','Open Accounts and backup','「アカウントとバックアップ」を開く','Tap Accounts and backup.','「アカウントとバックアップ」をタップします。',{sources:['galaxyAccounts','galaxyAccountsJa']});
    nav('account-name','Open Manage accounts','「アカウントを管理」を開く','Tap Manage accounts. Keep all existing accounts.','「アカウントを管理」をタップします。既存のアカウントは残します。',{sources:['galaxyAccounts','galaxyAccountsJa']});
  }else nav('account-name','Open the account list','アカウントの一覧を開く','Tap Passwords, passkeys and accounts.','「パスワード、パスキー、アカウント」をタップします。');
  b.operation('account-check',c('Check the actual account','実際の本人アカウントを確認する'),place,c('Read the account shown in these settings and check that it is the same personal account you selected in this app. Check the main owner profile on Android. Keep existing sign-in methods.','この設定に表示された本人のアカウントが、アプリで選んだものと同じか確認します。Androidではメインの所有者プロフィールで確認してください。既存のログイン方法は残します。'),c('The selected actual account is shown in the device’s settings.','選んだ実際のアカウントが、今回の端末の正規設定に表示されていること。'),{sources:apple?sources:a['android-maker']==='galaxy'?['googleFind','galaxyAccounts','galaxyAccountsJa']:sources,recordKind:'prerequisite',button:c('I checked the account','本人のアカウントを確認しました')});
  if(apple){
    nav('find-menu','Open Find My','「探す」を開く','Tap Find My in the Apple Account settings.','Apple Accountの設定で「探す」をタップします。');
    const en=a.form==='ipad'?'Find My iPad':'Find My iPhone',ja=a.form==='ipad'?'iPadを探す':'iPhoneを探す';
    nav('find-device','Open this device’s finding settings','今回の端末の探索設定を開く',`Tap ${en}.`,`「${ja}」をタップします。`,{diagram:[c('Settings','設定'),c('Your name','自分の名前'),c('Find My','探す'),c(en,ja)]});
    if(!b.check('find-enabled',c(`Turn on or check ${en}`,`「${ja}」をオンにする・確認する`),place,c(`If ${en} is already on, keep it on. Otherwise turn its switch on in Settings.`,`「${ja}」がオンなら、そのまま確認します。オフなら、この設定のスイッチをオンにします。`),'find-enabled',undefined,{sources,requires:['account-check','find-device']}))return false;
    if(a['find-enabled']!=='on')return true;
    if(!b.check('find-offline',c('Check Find My network','「探す」ネットワークを確認する'),place,c('Turn on Find My network to allow nearby Apple devices to help report an offline device’s approximate location. Keep it if already on.','「“探す”ネットワーク」をオンにすると、近くのApple製デバイスの協力で、オフラインの端末のおおよその位置を探せます。すでにオンなら、そのまま確認します。'),'find-offline',undefined,{sources,requires:['find-enabled'],explanation:c('This encrypted network is different from sharing your location with another person. Availability varies by region and model. Enabling it does not guarantee that a location will be reported.','暗号化された探索ネットワークです。他の人に自分の位置を共有する設定とは別です。地域・機種で利用できる範囲が異なり、位置が必ず届くとは限りません。')}))return false;
    if(!b.check('find-last-location',c('Check Send Last Location','最後の位置情報の送信を確認する'),place,c('Turn on Send Last Location if you want the device to send Apple its location when the battery is low. Keep the current enabled setting.','電池残量が少なくなったときにAppleへ位置を送る場合は、「最後の位置情報を送信」をオンにします。すでに有効なら、そのまま確認します。'),'find-last-location',undefined,{sources,requires:['find-enabled']}))return false;
    return true;
  }
  nav('location-settings','Return to Settings','「設定」の最初の画面へ戻る','Return to the main Settings list.','「設定」の最初の一覧へ戻ります。');
  nav('location-open','Open Location','「位置情報」を開く','Tap Location.','「位置情報」をタップします。');
  if(!b.check('device-location',c('Check Use location','「位置情報の使用」を確認する'),place,c('To let the device report its location, turn on Use location. This can also make location available to other apps according to their permissions.','端末の位置を送れるようにするには、「位置情報の使用」をオンにします。他のアプリも、それぞれの権限に応じて位置情報を利用できる場合があります。'),'device-location',undefined,{sources,requires:['location-open']}))return false;
  nav('find-settings','Return to Settings','「設定」の最初の画面へ戻る','Return to the main Settings list.','「設定」の最初の一覧へ戻ります。');
  nav('find-google','Open Google settings','「Google」を開く','Tap Google.','「Google」をタップします。');
  if(!b.question('google-tabs',c('Is All services shown?','「すべてのサービス」が表示されていますか？'),[option('yes','Yes','表示されています'),option('no','There is no tab','このタブはありません')],c('Some versions have this tab; others show the services directly.','版によって、このタブがある場合と、サービスが直接並ぶ場合があります。'),{sources}))return false;
  if(a['google-tabs']==='yes')nav('find-all-services','Open All services','「すべてのサービス」を開く','Tap All services.','「すべてのサービス」をタップします。');
  nav('find-device','Open Find Hub','「Find Hub」を開く','Tap Find Hub in the services.','サービスの「Find Hub」をタップします。');
  if(!b.check('find-enabled',c('Allow this device to be located','この端末を探索できる設定を確認する'),place,c('Check Allow device to be located. If it is off, turn it on. Keep an existing enabled setting.','「デバイスの場所の特定を許可」を確認します。オフならオンにし、すでに有効ならそのまま確認します。'),'find-enabled',undefined,{sources,requires:['account-check','find-device']}))return false;
  if(a['find-enabled']!=='on')return true;
  nav('find-offline-open','Open offline finding','オフラインの探索を開く','Tap Find your offline devices.','「オフラインのデバイスを探す」をタップします。');
  if(!b.check('find-offline',c('Choose and check offline finding','オフラインの探索を選び、確認する'),place,c('Select the option you want in the official settings, then choose that same value here. Without network keeps encrypted recent locations. Busy places and Everywhere also use the encrypted device-finding network.','正規設定で使う選択肢を決め、同じ値をここで記録します。「ネットワークを使用しない」は暗号化した最近の位置を使い、人通りの多い場所／どこでもの設定は暗号化された探索ネットワークも使います。'),'find-offline',[
    option('busy','With network in busy places only','人通りの多い場所でのみネットワークを使用する'),option('everywhere','With network everywhere','どこでもネットワークを使用する'),option('recent','Without network','ネットワークを使用しない'),option('off','Off','OFF'),option('unsupported','These choices are unavailable','これらの選択肢を利用できません')
  ],{sources,requires:['find-enabled','find-offline-open'],explanation:c('Recent locations are not necessarily the current location. Powered-off finding works only on supported devices with the required Bluetooth and Location settings. This records your chosen configuration; it is not a powered-off test.','最近の位置は現在地とは限りません。電源オフ時の探索は、対応機種と必要なBluetooth・位置設定に限られます。ここでは選んだ設定を記録し、電源を切った状態での探索成功とは扱いません。')}))return false;
  b.operation('play-list',c('Keep this device visible in Google Play','Google Playで今回の端末を表示する'),c('Google Play · Devices','Google Playの端末一覧'),c('Open the official device list with the same Google Account. Find this actual device and check Show In Menus. Keep other devices and accounts.','同じGoogleアカウントで公式の端末一覧を開きます。今回の実物を見つけ、「メニューに表示する」を確認します。他の端末やアカウントは残してください。'),c('This device is listed and Show In Menus is checked.','今回の端末が一覧にあり、「メニューに表示する」が有効になっていること。'),{sources,url:'https://play.google.com/library/devices',urlLabel:c('Open the official device list','公式の端末一覧を開く'),recordKind:'prerequisite',requires:['account-check']});
  return true;
}
