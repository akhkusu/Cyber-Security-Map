import { c, type Copy } from './guideCatalog';
import type { Dataset } from './models';
import { canBeMailAccount } from './accountRoles';
import type { EnteTask } from './enteSchemas';
import { enteRecoveryFactorInputs } from './enteRecoveryData';
import type { EnteChoice, EnteStep } from './enteCatalog';
import { privateBrowserChoices, privateBrowserOperations, type PrivateBrowser, type SafariLayout } from './privateBrowserCatalog';

export type EnteSignInKind = 'root' | 'recovery';
type Screen = 'password' | 'email' | 'choice' | 'passkey' | 'totp' | 'data' | 'expired' | 'other';
type Context = {
  kind: EnteSignInKind;
  rootRef: string;
  deviceRef: string;
  place: Copy;
  refs: string[];
  prerequisites?: string[];
  requiredFactor?: 'passkey' | 'totp';
  withoutRefs?: string[];
};
const ch = (value: string, en: string, ja = en): EnteChoice => ({ value, label: c(en, ja) });
const labels: Record<Screen, Copy> = {
  password: c('An Account password field', 'Accountパスワードの入力欄'),
  email: c('An email verification code field', 'メールの確認コード欄'),
  choice: c('A choice between TOTP and passkey', 'TOTPとパスキーを選ぶ画面'),
  passkey: c('Passkey verification', 'パスキーの本人確認'),
  totp: c('An authenticator-code field', '認証アプリのコード欄'),
  data: c('This Account’s code list', 'このAccountのコード一覧'),
  expired: c('The sign-in expired or returned to the beginning', '期限切れ・ログインの最初へ戻った'),
  other: c('Another screen or a different Account', '別の画面・別のAccount'),
};

/** The questions describe the actual screen; they do not assume an MFA order. */
export function enteSignInSteps(data: Dataset, task: EnteTask, ctx: Context): EnteStep[] {
  if (data.version !== 2) return [];
  const prefix = `signin/${ctx.kind}/`, a = task.answers, steps: EnteStep[] = [];
  let sources = ['enteSignInSource', 'entePasskey'];
  const actions = [...(ctx.prerequisites ?? [])];
  let signInPlace = ctx.place;
  const extra = task.kind === 'recovery' && a['recovery-place'] === 'web'
    ? { webDeviceRef: ctx.deviceRef } : { appRef: task.appRef };
  const without = ctx.withoutRefs?.length
    ? c('Without using the previous phone: ', '旧端末を使わずに、')
    : c('', '');
  const ask = (key: string, title: Copy, choices: EnteChoice[], more: Partial<EnteStep> = {}) => {
    steps.push({ id: prefix + key, kind: 'question', title, choices, refs: ctx.refs, sources, requires: [], restartSignIn: ctx.kind, ...more });
  };
  const act = (id: string, title: Copy, action: Copy, expected: Copy, more: Partial<EnteStep> = {}) => {
    steps.push({ id, kind: 'action', title, place: signInPlace,
      action: c(without.en + action.en, without.ja + action.ja), expected,
      button: c('I checked this', '確認しました'), refs: ctx.refs, sources,
      requires: [...actions], restartSignIn: ctx.kind, ...extra, ...more });
    actions.push(id);
  };
  const stop = (key: string, title: Copy, action: Copy) => {
    steps.push({ id: prefix + key, kind: 'blocked', title, action, refs: ctx.refs, sources, requires: [], restartSignIn: ctx.kind });
  };
  const screen = (key: string, title: Copy, allowed: Screen[]): Screen | undefined => {
    ask(key, title, allowed.map(value => ({ value, label: labels[value] })));
    const selected = a[prefix + key] as Screen | undefined;
    if (!selected) return;
    if (selected === 'expired' || selected === 'other') {
      stop(key + '-unfinished', c('Keep access and restart only this sign-in check', '利用手段を残し、このログインの確認だけを始め直す'),
        c('Keep the app, current sessions, codes and recovery information. Use another environment that is not signed in to this exact Account. Restarting withdraws this check; it does not submit a password change or disable authentication again.',
          'アプリ・現在のログイン・コード・復旧情報を残します。この正しいAccountに未ログインの別の環境を使ってください。始め直すのは今回の確認だけで、パスワード変更・認証解除の再送信はしません。'));
      return;
    }
    return selected;
  };
  const candidate = ctx.kind === 'recovery' && !!task.recoveryStateV1?.password;
  const password = (again = false) => {
    const id = ctx.kind === 'recovery' && !again ? 'recovery-password-test' : prefix + (again ? 'password-again' : 'password');
    act(id, candidate ? c('Enter the new Account password in Ente', '新しいAccountパスワードをEnteへ入力する') : c('Enter the current Account password in Ente', '現在のAccountパスワードをEnteへ入力する'),
      c(`${again ? 'Ente is asking for the password again in this same sign-in. ' : ''}Use ${candidate ? 'the exact new value from the reminder prepared for this change' : 'the current value from your independent reminder'} in Ente’s Password field and submit its form. Check the value rather than accepting an autofilled old password. Keep this same sign-in open for the next screen.`,
        `${again ? '同じログインの中で、Enteがもう一度パスワードを求めています。' : ''}${candidate ? '今回の変更用に控えた、新しい値そのもの' : '独立した控えの、現在の値'}を、Enteの「Password / パスワード」欄へ入れて進みます。自動入力の古い値で代用せず、同じログインを開いたまま次の表示を確認してください。`),
      c('Ente accepts this exact value and advances to an additional check or the intended code list. An error or unchanged password form stays unfinished.',
        'Enteが今回の正確な値を受け付け、追加の確認か、正しいコード一覧へ進むこと。エラー・同じ入力欄のままなら未完了です。'),
      { ...(candidate ? { effect: 'recovery-new-password' } : {}), button: c('The password was accepted', 'パスワードが受け付けられました') });
  };

  if (task.browserOpeningV1 === 1) {
    const os = data.assets.find(d => d.id === ctx.deviceRef)?.operatingSystem;
    ask('browser', c('Which browser will you use on this device?', 'この端末では、どのブラウザーを使いますか？'), [
      ...privateBrowserChoices(os).map(value => ch(value, value === 'safari' ? 'Safari' : value === 'chrome' ? 'Chrome' : value === 'firefox' ? 'Firefox' : 'Microsoft Edge')),
      ch('ready', 'I already have a separate window that is not signed in', 'すでに別の未ログイン画面を用意している'), ch('other', 'Another browser / I cannot open a private screen', '別のブラウザー・プライベート画面を開けない'),
    ]);
    const browser = a[prefix + 'browser'];
    if (!browser) return steps;
    if (browser !== 'ready') {
      if (!privateBrowserChoices(os).includes(browser as PrivateBrowser)) {
        stop('browser-unavailable', c('Keep your working access and choose another available window', '使えるログインを残し、別の利用できる画面を選ぶ'), c('Keep the guide and working sessions. Do not disable device management, close every private tab or remove authentication to force this check. Use Back to select an available browser, or a separate profile that you have already confirmed is not signed in.', 'このガイドと使えるログインを残します。確認のために管理設定を解除したり、すべてのプライベートタブを閉じたり、認証を削除したりしません。「戻る」で実際に使えるブラウザーか、未ログインだと確認した別プロフィールを選んでください。'));
        return steps;
      }
      const label = browser === 'safari' ? 'Safari' : browser === 'chrome' ? 'Chrome' : browser === 'firefox' ? 'Firefox' : 'Microsoft Edge';
      const device = data.assets.find(d => d.id === ctx.deviceRef)?.name ?? '';
      signInPlace = c(`${device} · ${label}`, `${device} · ${label}`);
      act(prefix + 'browser-app', c(`Open ${label} on the chosen device`, `選んだ端末で${label}を開く`), c(`Open ${label} on the device shown here. Keep this guide and existing working sessions.`, `ここに表示した端末で${label}を開きます。このガイドと、現在使えるログインは残してください。`), c('The chosen browser is open on the intended device.', '今回使う端末で、選んだブラウザーが開くこと。'), { button: c('The browser is open', 'ブラウザーを開きました') });
      if (browser === 'firefox' && os === 'ios') {
        const firefoxSources = ['privateFirefoxIOS', 'privateFirefoxKeepTabs'];
        act(prefix + 'firefox-menu', c('Open Firefox’s menu before starting the private check', 'プライベートの確認を始める前に、Firefoxのメニューを開く'), c('Tap Firefox’s menu button at the bottom of the iPhone screen, or at the top right on an iPad.', 'Firefoxのメニューボタンをタップします。iPhoneでは画面下部、iPadでは右上にあります。'), c('Firefox’s menu is visible.', 'Firefoxのメニューが表示されること。'), { sources: firefoxSources, button: c('The menu is open', 'メニューを開きました') });
        act(prefix + 'firefox-settings', c('Open Firefox Settings', 'Firefoxの「設定」を開く'), c('Select Settings in that menu.', 'そのメニューで「Settings / 設定」を選びます。'), c('Firefox’s settings are visible.', 'Firefoxの設定が表示されること。'), { sources: firefoxSources, button: c('Settings are open', '設定を開きました') });
        act(prefix + 'firefox-privacy', c('Find Close Private Tabs without changing it yet', 'まだ変更せず「プライベートタブを閉じる」を探す'), c('Scroll to Privacy and find Close Private Tabs. Firefox can close private tabs when you leave private browsing or quit the app. Check the current switch first.', 'プライバシーの項目までスクロールし、「Close Private Tabs / プライベートタブを閉じる」を探します。Firefoxではプライベートの表示を離れる・アプリを終了する際にタブが閉じる場合があるため、まず現在のスイッチを確認してください。'), c('The current switch is visible.', '現在のスイッチが見えること。'), { sources: firefoxSources, button: c('I found the current setting', '現在の設定を確認しました') });
        ask('firefox-close-tabs', c('What is the current Close Private Tabs setting?', '「プライベートタブを閉じる」は、現在どちらですか？'), [ch('off', 'Off; keep it', 'オフ。そのまま保つ'), ch('change', 'On; let private tabs stay open so I can return to this guide', 'オン。案内へ戻れるよう、タブを残す設定に変える'), ch('keep', 'On; keep this setting and choose another browser', 'オン。変更せず、別のブラウザーを使う'), ch('unknown', 'I cannot confirm it', '確認できない')], { sources: firefoxSources });
        const close = a[prefix + 'firefox-close-tabs'];
        if (!close) return steps;
        if (!['off', 'change'].includes(close)) {
          stop('firefox-tabs-unavailable', c('Keep this setting and use another available screen', '設定を保ち、使える別の画面を選ぶ'), c('Use Back to choose another installed browser or an already prepared unsigned-in profile. Keep working sessions. Do not count a lost private tab as a completed sign-in.', '「戻る」で、インストール済みの別ブラウザーか、用意済みの未ログインプロフィールを選びます。使えるログインは残し、閉じたプライベートタブをログインの完了にはしません。'));
          return steps;
        }
        if (close === 'change') act(prefix + 'firefox-keep-tabs', c('Allow this Firefox private tab to stay open', 'Firefoxのプライベートタブを残せるようにする'), c('Turn Close Private Tabs off. If it is already off, keep it. Private tabs will then remain until you close them, so other people with access to this unlocked browser may see them.', '「プライベートタブを閉じる」をオフにします。すでにオフならそのまま保ちます。以後は自分で閉じるまでタブが残るため、解除済みのこのブラウザーを使える人には見える場合があります。'), c('Close Private Tabs is off.', '「プライベートタブを閉じる」がオフになっていること。'), { sources: firefoxSources, physical: true, button: c('The setting is off', 'オフになっています') });
        act(prefix + 'firefox-done', c('Return from Firefox Settings', 'Firefoxの設定から戻る'), c('Select Done at the top right. Keep existing tabs and sessions.', '右上の「Done / 完了」を選びます。既存のタブとログインは残してください。'), c('Firefox has returned from Settings.', 'Firefoxの設定を閉じて戻れること。'), { sources: firefoxSources, button: c('I returned from Settings', '設定から戻りました') });
      }
      let layout: SafariLayout | undefined;
      if (browser === 'safari' && os === 'ios') {
        ask('safari-device', c('Are you using Safari on an iPhone or an iPad?', 'Safariを使うのはiPhoneですか、iPadですか？'), [ch('iphone', 'iPhone'), ch('ipad', 'iPad')]);
        if (!a[prefix + 'safari-device']) return steps;
        if (a[prefix + 'safari-device'] === 'ipad') layout = 'ipad';
        else {
          ask('safari-layout', c('Which Safari controls do you see?', 'Safariには、どの操作ボタンが表示されていますか？'), [ch('more', 'More button — current layout', '「詳細」ボタンがある'), ch('tabs', 'Tabs button — iOS 17 or earlier layout', 'タブのボタンを使う以前の表示'), ch('other', 'Neither / the item is unavailable', 'どちらも見つからない・使えない')]);
          if (!a[prefix + 'safari-layout']) return steps;
          layout = a[prefix + 'safari-layout'] as SafariLayout;
        }
      }
      const recipe = privateBrowserOperations(browser as PrivateBrowser, os, layout);
      if (!recipe) {
        stop('browser-layout-unavailable', c('Keep this browser step unfinished', 'このブラウザーの操作を未完了で残す'), c('Keep your current sessions. Use Back to match the actual controls or choose another available browser. Do not guess a menu, change restrictions or erase browsing data to force the check.', '現在のログインを残し、「戻る」で実際の表示に合わせるか、使える別のブラウザーを選びます。メニューの推測・制限の解除・閲覧データの消去で確認を通そうとしません。'));
        return steps;
      }
      for (const operation of recipe) act(prefix + 'browser-' + operation.key, operation.title, operation.action, operation.expected, { button: operation.button, sources: operation.sources });
      sources = [...new Set([...sources, ...recipe.flatMap(operation => operation.sources), ...(browser === 'firefox' && os === 'ios' ? ['privateFirefoxKeepTabs'] : [])])];
    }
    const device = data.assets.find(d => d.id === ctx.deviceRef)?.name ?? '';
    signInPlace = browser === 'ready' ? c(`${device} · Separate unsigned-in screen`, `${device} · 用意した別の未ログイン画面`) : c(`${device} · ${browser === 'safari' ? 'Safari' : browser === 'chrome' ? 'Chrome' : browser === 'firefox' ? 'Firefox' : 'Microsoft Edge'} · Private screen`, `${device} · ${browser === 'safari' ? 'Safari' : browser === 'chrome' ? 'Chrome' : browser === 'firefox' ? 'Firefox' : 'Microsoft Edge'} · プライベート画面`);
    act(ctx.kind === 'root' ? 'root-login-open' : prefix + 'open', c('Open Ente in the separate screen', '別の画面で、EnteのログインURLを開く'),
      c('Copy the address below, paste it into the address bar of the separate private tab or profile you prepared, and open it. Then return to this guide.', '下のURLをコピーし、用意したプライベートのタブか別プロフィールのアドレス欄へ貼り付けて開きます。開いたら、このガイドへ戻ってください。'),
      c('Ente has opened in that separate screen. Next, we will check what it shows.', '用意した別の画面でEnteが開くこと。次に実際の表示を確認します。'), { copyUrl: 'https://auth.ente.com/', button: c('It is open in the separate screen', '別の画面で開きました') });
    ask('session', c('What is shown at the Auth address?', 'AuthのURLを開くと、何が表示されましたか？'), [ch('login', 'The login form', 'ログインの入力画面'), ch('signed-in', 'A code list is already open', '最初からコード一覧が開いている'), ch('other', 'Another screen / a different address', '別の画面・別のURL')]);
    if (!a[prefix + 'session']) return steps;
    if (a[prefix + 'session'] !== 'login') {
      stop('session-not-fresh', c('Use a screen that is actually not signed in', '実際に未ログインの画面を使う'), c('A new private tab can share an existing private login. Keep that working access. Restart only this check and choose another unsigned-in browser or profile; do not close all tabs, sign out the only working session or count the existing list as a new login.', '新しいプライベートタブでも、既存のプライベートのログインを共有することがあります。その利用手段は残し、今回の確認だけを始め直して、未ログインの別ブラウザーかプロフィールを選びます。すべてのタブを閉じたり、唯一の使えるログインからサインアウトしたりせず、既存一覧を新しいログインの成功にしません。'));
      return steps;
    }
  } else {
  act(ctx.kind === 'root' ? 'root-login-open' : prefix + 'open', c('Open an Ente sign-in that is not already logged in', 'Enteに未ログインの画面を開く'),
    c('Keep working sessions. Open the official Auth web app in another browser profile or a private session that is not already signed in. Private windows can share a session with other private windows. If a code list opens immediately, use a different unsigned-in environment instead of counting it as a new sign-in.',
      '使えるログインを残し、別のブラウザープロフィールか、Enteに未ログインのプライベート画面で正規のAuth Webを開きます。プライベート画面同士でログインを共有する場合があります。最初からコード一覧が開いた場合は、新しいログインとして数えず、別の未ログイン環境を使ってください。'),
    c('The official Auth login is open; an existing code list is not being reused.', '正規Authのログイン画面が開き、既存のコード一覧を流用していないこと。'),
    { url: 'https://auth.ente.com/', button: c('The login screen is open', 'ログイン画面を開きました') });
  }
  act(prefix + 'email', c('Enter this existing Account’s email in Ente', 'この既存AccountのメールをEnteへ入力する'),
    c('Enter the email address for this Ente account in Ente’s login form and select Login.',
      '今回使うEnteアカウントのメールアドレスをEnteのログイン画面に入力し、「Login / ログイン」を選んでください。'),
    c('Ente shows its next check for the intended existing Account.', '今回の正しい既存Accountについて、次の確認が表示されること。'), { button: c('I entered the email in Ente', 'Enteへメールを入力しました') });
  let next = screen('entry', c('What is Ente asking for after the email?', 'メールを入れた後、Enteで何を求められていますか？'), ['password', 'email', 'other', 'expired']);
  if (!next) return steps;
  let passwordUsed = false, factorUsed = false;
  if (next === 'email') {
    const mailRef = ctx.kind === 'root' ? a['root-mail']?.slice(8) : task.resources.recoveryMail;
    if (!mailRef || Object.hasOwn(a, prefix + 'mail')) {
      ask('mail', c('Which actual mailbox receives this check?', '今回の確認を受け取る、実際のメールはどれですか？'),
        [...data.assets.filter(canBeMailAccount).map(v => ch(`account:${v.id}`, v.name)), ch('unknown', 'Not recorded or unsure', '未登録・分からない')], { question: 'recovery-mail' });
      if (!a[prefix + 'mail']) return steps;
      if (a[prefix + 'mail'] === 'unknown') {
        stop('mail-unavailable', c('Identify an accessible mailbox first', '開ける正しいメールを先に確認する'), c('Keep all working access. Identify this Account’s actual mailbox without replacing it with a different personal or work account.', '使える利用手段を残し、今回のAccountの実際のメールを確認します。別の個人用・仕事用Accountで代用しません。'));
        return steps;
      }
      if (!mailRef) return steps; // The selected mailbox is available on the next render.
    }
    act(prefix + 'mail-open', c('Read the new Ente verification message', '今回のEnteの確認メールを読む'),
      c('Open the correct mailbox using a working method outside this unavailable sign-in. Read the verification message for this attempt. Keep its code in that mailbox; do not enter it here.',
        '今回のログインがまだ使えなくても開ける方法で、正しいメールを開き、今回届いたEnteの確認メールを読みます。コードはメール側で扱い、このアプリへ入力しません。'),
      c('The new message belongs to this exact Account and this attempt.', '今回の正しいAccount・今回のログイン用の新しいメールを読めること。'), { refs: [...ctx.refs, mailRef], button:c('I read the verification message','確認メールを読めました'), place:c(`Mailbox · ${data.assets.find(v=>v.id===mailRef)?.name??''}`,`メール · ${data.assets.find(v=>v.id===mailRef)?.name??''}`) });
    act(prefix + 'email-verify', c('Submit the email code only in Ente', 'メールのコードをEnteだけへ入力する'),
      c('Enter the code from that message in Ente’s verification field and select Verify. Keep the same sign-in open; receiving email alone does not prove data can be opened.',
        'そのメールのコードをEnteの確認欄だけへ入れ、「Verify / 認証」を選びます。同じログインを残し、受信しただけでデータを開けたとは扱いません。'),
      c('Ente accepts this email check and shows the next screen.', 'Enteが今回のメール確認を受け付け、次の画面へ進むこと。'),
      { refs: [...ctx.refs, mailRef], button:c('The email verification was accepted','メールの確認が受け付けられました'), ...(ctx.kind === 'recovery' ? { effect: 'recovery-mail-access' } : {}) });
    next = screen('after-email', c('What appears after the email check?', 'メール確認の後、何が表示されていますか？'), ['password', 'choice', 'passkey', 'totp', 'data', 'other', 'expired']);
    if (!next) return steps;
  }
  if (next === 'password') {
    password(); passwordUsed = true;
    next = screen('after-password', c('What appeared after the password was accepted?', 'パスワードが受け付けられた後、何が表示されましたか？'), ['choice', 'passkey', 'totp', 'data', 'other', 'expired']);
    if (!next) return steps;
  }
  if (next === 'choice') {
    const method = ctx.requiredFactor ?? a[prefix + 'method'];
    if (!ctx.requiredFactor) {
      ask('method', c('Which available method will you use in this sign-in?', '今回のログインでは、どの使える方法を使いますか？'), [ch('passkey', 'Passkey', 'パスキー'), ch('totp', 'Authenticator code', '認証アプリのコード'), ch('unknown', 'Neither is available', 'どちらも使えない')]);
      if (!method) return steps;
    }
    if (!['passkey', 'totp'].includes(method!)) {
      stop('method-unavailable', c('Keep remaining access before recovering a factor', '追加認証を復旧する前に、残る利用手段を保つ'), c('Keep the signed-in app and independent Recovery key. Do not remove a working method or repeat a previous recovery to force this check. Use the local recovery help for the unavailable method.', 'ログイン済みアプリと独立した復旧キーを残します。今回の確認を通すために使える方式を削除したり、以前の復旧を繰り返したりせず、その場の復旧のヘルプを使ってください。'));
      return steps;
    }
    act(prefix + 'method-select', c('Choose the method on Ente’s Two-factor screen', 'Enteの二要素の画面で、今回の方法を選ぶ'),
      method === 'totp' ? c('Select Login with TOTP on the displayed choice screen.', 'いま表示されている選択画面で「Login with TOTP / TOTPでログイン」を選びます。') : c('Select Login with passkey on the displayed choice screen.', 'いま表示されている選択画面で「Login with passkey / パスキーでログイン」を選びます。'),
      method === 'totp' ? c('Ente shows its authenticator-code field.', 'Enteの認証アプリのコード欄が表示されること。') : c('Ente starts this Account’s passkey verification.', '今回のAccountのパスキーの本人確認が開くこと。'), { button: c('I selected this method', '今回の方法を選びました') });
    next = method as 'passkey' | 'totp';
  }
  if (next === 'passkey' || next === 'totp') {
    const type = next;
    if (ctx.requiredFactor && type !== ctx.requiredFactor) {
      stop('different-factor', c('This is a different authentication method', '今回試すものとは別の認証方法です'), c('Do not count this as the selected method’s test. Keep existing access. Correct the selected method with Back, or restart this sign-in and choose the intended method if Ente offers a choice.', '選んだ方法を使えた確認にはしません。現在の利用手段を残し、「戻る」で実際に試す方法を直すか、ログインを始め直してEnteに選択画面が出た場合は今回の方法を選んでください。'));
      return steps;
    }
    let factorRefs: string[];
    if (ctx.kind === 'root') {
      const storeRef = task.resources.factorStore, store = data.securityModel.entities.find(e => e.id === storeRef);
      const host = store?.kind === 'installation' ? [store.deviceRef] : store?.kind === 'vault' && store.storageMode === 'local' && store.primaryDeviceRef ? [store.primaryDeviceRef] : [];
      const known = data.securityModel.entities.filter(e => e.kind === 'credential' && e.subjectRef === ctx.rootRef && e.credentialType === type && e.storageRef === storeRef);
      let selected = known.find(e => e.id === task.resources.factorCredential) ?? (type === 'totp' && known.length === 1 ? known[0] : undefined);
      if (type === 'totp' && known.length > 1) {
        ask('credential', c('Which actual TOTP entry is this?', '今回の実際のTOTPの項目はどれですか？'), [...known.map(e => ch(`credential:${e.id}`, e.label)), ch('unknown', 'I cannot identify the entry', '項目を見分けられない')], { question: 'signin-root-credential' });
        if (!a[prefix + 'credential']) return steps;
        selected = known.find(e => `credential:${e.id}` === a[prefix + 'credential']);
        if (!selected) {
          stop('entry-unconfirmed', c('Identify the intended entry first', '今回の正しい項目を先に確認する'), c('Keep the codes; do not guess an entry or delete duplicates to force this check.', 'コードを残し、項目を推測したり、今回の確認を通すために重複項目を削除したりしません。'));
          return steps;
        }
      }
      if (type === 'passkey' && !selected) {
        stop('registration-unconfirmed', c('Review this registration before testing it', '試す前に、この登録の記録を確認する'), c('Keep existing registrations and go Back to identify this exact passkey and its store.', '既存の登録を残し、「戻る」で今回の正しいパスキーと保存先を確認してください。'));
        return steps;
      }
      factorRefs = [storeRef, ...host, ...(selected ? [selected.id] : [])].filter((v): v is string => !!v);
    } else {
      ask('credential', c('Which actual registration will complete this check?', '今回の確認に使う、実際の登録はどれですか？'),
        [...data.securityModel.entities.filter(e => e.kind === 'credential' && e.credentialType === type && !!enteRecoveryFactorInputs(data, ctx.rootRef, e.id)).map(e => ch(`credential:${e.id}`, e.label)), ch('record', 'Record the existing method I am using', 'いま使う既存の方法を記録する'), ch('unavailable', 'I cannot use this method', 'この方法を使えない')], { question: 'signin-recovery-credential' });
      const selected = a[prefix + 'credential'];
      if (!selected) return steps;
      if (selected === 'unavailable') {
        stop('factor-unavailable', c('Preserve access and the correct Recovery key', '利用手段と、正しい復旧キーを残す'), c('Keep the app, existing sessions and independent key. This check does not remove or recover a factor automatically. Use the local recovery help before changing authentication.', 'アプリ・既存ログイン・独立したキーを残します。この確認で認証方式を自動解除・復旧しません。認証を変更する前に、その場の復旧のヘルプを使ってください。'));
        return steps;
      }
      if (selected === 'record') {
        ask('store', c('Where is the method in the real verification prompt?', '実際の本人確認で使う方法は、どこにありますか？'),
          [...data.securityModel.entities.filter(e => type === 'passkey' ? e.kind === 'vault' || e.kind === 'security-key' : e.kind === 'installation' || e.kind === 'vault').map(e => ch(`store:${e.id}`, e.label)), ...(type === 'passkey' ? [ch('local', 'Confirmed to be stored only on this device', 'いま操作する端末だけの保存だと確認した')] : []), ch('unknown', 'I cannot identify the storage', '保存先が分からない')], { question: 'signin-recovery-store', ...extra });
        if (!a[prefix + 'store']) return steps;
        if (a[prefix + 'store'] === 'unknown') {
          stop('store-unconfirmed', c('Identify the actual method before recording success', '成功を記録する前に、実際の方法を確認する'), c('Keep this check unfinished. Do not guess a password store or physical key, and do not enter a secret here.', '確認を未完了で残します。保存先・物理キーを推測で決めず、秘密の値もここへ入力しません。'));
          return steps;
        }
      }
      const known = task.resources.recoveryFactor && enteRecoveryFactorInputs(data, ctx.rootRef, task.resources.recoveryFactor);
      const storeRef = task.resources.recoveryFactorStore, store = data.securityModel.entities.find(e => e.id === storeRef);
      const host = store?.kind === 'installation' ? [store.deviceRef] : store?.kind === 'vault' && store.storageMode === 'local' && store.primaryDeviceRef ? [store.primaryDeviceRef] : [];
      factorRefs = known || [storeRef, ...host].filter((v): v is string => !!v);
    }
    if (!factorRefs.length || factorRefs.some(id => ctx.withoutRefs?.includes(id) || ['lost', 'unavailable', 'revoked', 'deleted', 'retired', 'transferred'].includes(data.securityModel.lifecycle[id]?.state ?? ''))) {
      stop('factor-location-unavailable', c('Use an actually available method', '実際に使える方法を確認する'), c('The chosen method or its host is unavailable. Keep the current app and codes. Go Back to identify a usable method; a lost phone is not made available by correcting a record.', '選んだ方法か保存端末を使えません。現在のアプリとコードを残し、「戻る」で使える実物を選んでください。記録を直すだけで紛失したスマホは戻りません。'));
      return steps;
    }
    act(ctx.kind === 'root' ? 'root-factor-use' : prefix + 'factor-use', type === 'totp' ? c('Submit this Account’s authenticator code in Ente', 'このAccountの認証コードをEnteへ入力する') : c('Use this exact passkey in Ente’s verification', 'Enteの本人確認で、今回のパスキーを使う'),
      type === 'totp' ? c('Read this exact Account’s current code in the selected authenticator and enter it only in Ente’s code field. Do not use another service’s code, an old session or a Recovery key.', '選んだ認証アプリで、この正しいAccountの現在のコードを読み、Enteのコード欄だけへ入力します。別サービスのコード・既存ログイン・復旧キーで代用しません。') : c('In Ente’s browser or OS prompt use this exact registration from the selected store or physical key. Do not count another passkey, a TOTP or a Recovery key as this registration’s test.', 'Enteが開くブラウザー・OSの本人確認で、選んだ保存先・物理キーの今回の登録を使います。別のパスキー・TOTP・復旧キーを、この登録を使えた確認にはしません。'),
      c('Ente accepts this exact additional method in the same new sign-in.', '同じ新しいログインで、今回の正しい追加認証がEnteに受け付けられること。'),
      { refs: [...ctx.refs, ...factorRefs], effect: ctx.kind === 'root' ? 'account-factor-use' : 'signin-recovery-factor', signInFactorType: type, button: c('This additional authentication was accepted', '今回の追加認証が受け付けられました') });
    factorUsed = true;
    next = screen('after-factor', c('What appears after this authentication?', '今回の認証の後、何が表示されていますか？'), ['password', 'data', 'other', 'expired']);
    if (!next) return steps;
    if (next === 'password') { password(passwordUsed); passwordUsed = true; }
  }
  if (!passwordUsed) {
    stop('password-not-used', c('This has not verified the intended password', '今回のパスワードを使った確認には、まだなっていません'), c('A code list without using the intended password may be an existing session. Preserve it, and restart this check in an unsigned-in environment. Do not change the password again.', '今回のパスワードを使わずに見えたコード一覧は、既存ログインかもしれません。その利用手段を残し、未ログイン環境から確認を始め直します。パスワードをもう一度変更しません。'));
    return steps;
  }
  if (ctx.requiredFactor && !factorUsed) {
    stop('factor-not-used', c('The selected additional method has not been tested', '選んだ追加認証は、まだ使って確認できていません'), c('Do not count a password-only or existing-session sign-in as this additional authentication. Keep access and restart in a truly unsigned-in environment, or correct the actual setting with Back.', 'パスワードだけ・既存ログインで開けたことを、今回の追加認証の成功にはしません。利用手段を残して未ログイン環境からやり直すか、「戻る」で実際の設定を確認してください。'));
    return steps;
  }
  const readId = ctx.kind === 'root' ? 'root-data-read' : 'recovery-data-read';
  act(readId, c('Read the intended Account’s code list in this same sign-in', '同じログインで、正しいAccountのコード一覧を確認する'),
    c('Continue this same sign-in and confirm its existing code list is readable. For a genuinely new Account without codes, confirm the correct empty list. Do not sign in again, re-register the Account or delete entries to obtain a matching screen.',
      'この同じログインの続きを使い、今回の正しいAccountの既存コード一覧を読めるか確認します。コードがまだない本当の新規Accountなら、正しい空の一覧を確認してください。画面に合わせるための再ログイン・Accountの作り直し・項目の削除はしません。'),
    c('The correct code list is readable after the password and any required authentication in this same attempt.', 'この同じ試行で、パスワードと必要な認証を通した後に、正しいコード一覧を読めること。'),
    { effect: ctx.kind === 'root' ? 'account-data-read' : 'recovery-data-read', button: c('I opened this Account’s code list', 'このAccountのコード一覧を開けました') });
  return steps;
}
