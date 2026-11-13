import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, ExternalLink, LockKeyhole, Mail, RotateCcw, Smartphone } from 'lucide-react';
import { makeAsset, type Asset, type Dataset, type Language } from './models';
import { c, PLATFORMS, PROVIDERS, say, SOURCES, TECHNICAL, isExtendedMail, type Platform } from './guideCatalog';
import { addRelation, afterRecipe, back, beginRecipe, completeStep, currentTask, deferStep, helpPrompt, isRecorded, move, selectAccount, undoStep } from './guideEngine';
import { tx } from './ui';

type Props = { data: Dataset; language: Language; save: (data: Dataset) => Promise<boolean> };
const isManager = (a: Asset) => a.type === 'Password manager' || a.services.includes('manager');
const titleFor = (a: Asset) => a.name;
export function Guide({ data, language, save }: Props) {
  const task = currentTask(data), cursor = data.guide.cursor;
  const [help, setHelp] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => { setHelp(false); heading.current?.focus(); }, [cursor]);
  const go = (route: string) => void save(move(data, route));
  const [route, id, recipeId] = cursor.split('/');
  const asset = data.assets.find(a => a.id === id);
  const account = data.assets.find(a => a.id === data.guide.accountId);
  const manager = data.assets.find(a => a.id === data.guide.managerId);
  const choosePlatform = (target: Asset, platform: Platform, deviceId?: string) => {
    let next = data;
    if (!deviceId && platform !== 'web') {
      const device = makeAsset({ kind: 'device', type: platform === 'ios' || platform === 'android' ? 'Smartphone' : 'Computer', name: `${PLATFORMS[platform]} ${data.assets.filter(a => a.kind === 'device').length + 1}`, importance: 'critical', operatingSystem: platform });
      next = { ...next, assets: [...next.assets, device] }; deviceId = device.id;
    }
    next = { ...next, guide: { ...next.guide, ...(deviceId ? { deviceId } : {}), answers: { ...next.guide.answers, [`${target.id}:platform`]: platform } } };
    if (route === 'auth-device') {
      next = addRelation(next, target.id, deviceId!, 'authentication');
      void save(afterAuthentication(next, target)); return;
    }
    if (target.kind === 'device') { void save(beginRecipe(next, target.id, 'device')); return; }
    if (isManager(target)) { void save(target.provider === 'bitwarden' && !next.guide.answers[`${target.id}:region`] ? move(next, `region/${target.id}`) : beginRecipe(next, target.id, 'manager')); return; }
    void save(beginRecipe(next, target.id, recipeId ?? 'email-mfa'));
  };
  const afterAuthentication = (next: Dataset, target: Asset) => {
    if (isManager(target)) {
      const email = next.assets.find(a => a.id === next.guide.accountId);
      return email && isRecorded(email, 'recovery') && isRecorded(target, 'mfa') ? beginRecipe(next, email.id, 'password') : move(next, 'password-prerequisite');
    }
    return beginRecipe(next, target.id, 'recovery');
  };
  const button = (label: string, action: () => void, secondary = false) => <button key={label} className={`button ${secondary ? 'secondary' : 'primary'}`} onClick={action}>{label}{!secondary && <ArrowRight size={18} />}</button>;
  const option = (label: string, action: () => void, description?: string, icon?: ReactNode) => <button key={label} className="choice" onClick={action}><span className="choice-icon">{icon ?? <ArrowRight size={18} />}</span><span><strong>{label}</strong>{description && <small>{description}</small>}</span><ArrowRight size={17} className="choice-arrow" /></button>;
  let content: ReactNode;
  if (task) {
    const { asset, recipe, step, index } = task;
    const recorded = data.guide.steps[cursor]?.status === 'done';
    content = <>
      <div className="task-context"><span>{titleFor(asset)}</span><span>{index + 1} / {recipe.steps.length}</span></div>
      <div className="step-track" aria-hidden="true">{recipe.steps.map((s, n) => <i key={s.id} className={n <= index ? 'active' : ''} />)}</div>
      <span className="eyebrow">{say(recipe.title, language)}</span><h1>{say(step.title, language)}</h1>
      <div className="where"><span>{tx(language, 'WHERE', '操作する場所')}</span><strong>{say(step.place, language)}</strong></div>
      <p className="instruction">{say(step.action, language)}</p>
      {step.url && <a className="button secondary external" href={step.url} target="_blank" rel="noopener noreferrer">{tx(language, 'Open official settings / app', '公式の設定・アプリを開く')}<ExternalLink size={17} /><span className="sr-only">{tx(language, '(new tab)', '（別のタブ）')}</span></a>}
      {step.url && <p className="subtle">{tx(language, 'After the action, return to this tab to continue.', '操作したら、このタブへ戻って続けてください。')}</p>}
      {step.diagram && <figure className="operation-diagram"><figcaption>{tx(language, 'Navigation diagram · not a screenshot', '操作の順序を示す説明図（実画面ではありません）')}</figcaption><div>{step.diagram.map((part, n) => <span key={n} className={n === step.diagram!.length - 1 ? 'highlight' : ''}>{say(part, language)}{n < step.diagram!.length - 1 && <ArrowRight size={16} />}</span>)}</div></figure>}
      <div className="done-condition"><Check size={20} /><div><strong>{tx(language, 'Continue when', '次へ進む目安')}</strong><p>{say(step.expected, language)}</p></div></div>
      {recorded && <p className="subtle">{tx(language, 'This step is already recorded. You can review it without erasing the record.', 'この手順は記録済みです。記録を残したまま見直せます。')}</p>}
      <div className="primary-actions">{step.choices ? step.choices.map(choice => button(say(choice.label, language), () => void save(completeStep(data, choice.next)), true)) : button(say(step.button ?? c('Next', '次へ'), language), () => void save(completeStep(data)))}</div>
      <div className="step-tools"><button className="text-button" onClick={() => setHelp(!help)}><CircleHelp size={17} />{tx(language, 'Something is different', 'うまくいかない')}</button><button className="text-button" onClick={() => void save(deferStep(data))}>{tx(language, 'Do this later', 'この作業を後回しにする')}</button></div>
      {help && <Trouble data={data} language={language} save={save} close={() => setHelp(false)} />}
      {step.technical && <details className="technical"><summary>{tx(language, 'How this helps and its limits', '仕組みと、防げること・限界')}</summary><p>{say(TECHNICAL[step.technical], language)}</p></details>}
      <details className="sources"><summary>{tx(language, 'Official sources and review date', '公式の出典・資料の確認日')}</summary>{step.sources.map(s => <p key={s}><a href={SOURCES[s].url} target="_blank" rel="noopener noreferrer">{SOURCES[s].title}<ExternalLink size={12} /></a><small>{tx(language, 'Documentation checked', '資料確認日')}: {SOURCES[s].checked} · {SOURCES[s].scope}</small></p>)}</details>
    </>;
  } else if (route === 'start') {
    const accounts = data.assets.filter(a => a.kind === 'account' && !isManager(a));
    content = <><span className="hero-step"><Mail /></span><span className="eyebrow">{tx(language, 'START WITH YOUR EMAIL', 'まず、メールから。')}</span><h1>{tx(language, 'Which email account\ndo you use most?', 'よく使うメールを\n教えてください。')}</h1><p>{tx(language, 'Email often lets you reset other accounts. We’ll protect it first, then prepare a way back in.', 'メールは、ほかのアカウントの復旧にも使われます。最初に認証を設定し、ログインできなくなったときの備えを作ります。')}</p>
      <div className="choices">{accounts.map(a => option(a.name, () => {
        const selected = { ...data, guide: { ...data.guide, accountId: a.id, draftAccountId: undefined } };
        void save(!a.provider ? move(selected, 'provider') : a.provider === 'apple' ? move(selected, `platform/${a.id}/email-mfa`) : beginRecipe(selected, a.id, 'email-mfa'));
      }, tx(language, 'Use this existing entry', '登録済みのこの項目を使う')))}</div>
      {button(tx(language, accounts.length ? 'Choose another email' : 'Choose my email service', accounts.length ? '別のメールを選ぶ' : 'メールサービスを選ぶ'), () => void save({ ...move(data, 'provider'), guide: { ...move(data, 'provider').guide, accountId: undefined, draftAccountId: undefined } }))}
      <button className="text-button" onClick={() => go('manager-select')}>{tx(language, 'I don’t use email / later', 'メールを使っていない・後で進める')}</button>
      <p className="subtle">{tx(language, 'No email address or password needed here.', 'メールアドレスやパスワードの入力は不要です。')}</p></>;
  } else if (route === 'provider') {
    content = <><span className="eyebrow">{tx(language, 'YOUR EMAIL', '使っているメール')}</span><h1>{tx(language, 'Which service do you use?', 'どのサービスを使っていますか？')}</h1><div className="choices">{(['apple', 'google', 'microsoft', 'proton', 'fastmail', 'tuta', 'zoho', 'yahoo', 'startmail', 'mailcom', 'gmx', 'other'] as const).map(provider => option(provider === 'other' ? tx(language, 'Another service', 'その他のサービス') : PROVIDERS[provider], () => {
      let next = { ...data, guide: { ...data.guide, pendingProvider: provider, draftAccountId: data.guide.pendingProvider === provider ? data.guide.draftAccountId : undefined } };
      if (account && !account.provider) { void save(selectAccount(next, provider, language, account.id)); return; }
      void save(move(next, 'identity'));
    }, provider === 'apple' ? 'iCloud Mail · Apple Account' : undefined, <Mail size={20} />))}</div></>;
  } else if (route === 'identity') {
    const provider = data.guide.pendingProvider ?? 'other';
    const candidates = data.assets.filter(a => a.kind === 'account' && !isManager(a) && (!a.provider || a.provider === provider));
    content = <><h1>{tx(language, 'Is this an account already listed?', '登録済みのアカウントと同じですか？')}</h1><p>{tx(language, 'Choose the same account only if the sign-in is the same. Personal and work accounts stay separate.', '同じログインに使うアカウントだけを選んでください。個人用と仕事用など、別のアカウントは分けて記録します。')}</p><div className="choices">{candidates.map(a => option(a.name, () => void save(selectAccount(data, provider, language, a.id)), tx(language, 'Reuse this account and its records', 'このアカウントと記録を使う')))}{option(tx(language, 'This is a different account', '別のアカウントとして追加する'), () => go('purpose'))}</div></>;
  } else if (route === 'purpose') {
    content = <><h1>{tx(language, 'Is this personal or work email?', '個人用と仕事用のどちらですか？')}</h1><p>{tx(language, 'This label keeps separate accounts from sharing completion records.', '別のアカウントの設定を、一緒に完了扱いにしないための区別です。')}</p><div className="choices">{(['personal', 'work'] as const).map(purpose => option(tx(language, purpose === 'personal' ? 'Personal' : 'Work / school', purpose === 'personal' ? '個人用' : '仕事・学校用'), () => {
      let next = selectAccount(data, data.guide.pendingProvider ?? 'other', language, data.guide.draftAccountId, purpose);
      next = { ...next, guide: { ...next.guide, draftAccountId: next.guide.accountId } };
      if (purpose === 'work') next = move(next, `managed/${next.guide.accountId}`);
      void save(next);
    }))}</div></>;
  } else if ((route === 'platform' || route === 'auth-device') && asset) {
    content = <><h1>{tx(language, route === 'auth-device' ? 'Which device holds this authenticator?' : 'Which device will you use?', route === 'auth-device' ? 'どの端末で認証していますか？' : 'どの端末で操作しますか？')}</h1><p>{tx(language, 'Choose a listed device or add the device you will use. This does not imply that it holds an authenticator.', '登録済みの端末を選ぶか、今回使う端末を追加してください。操作する端末と、認証に使う端末は別に確認します。')}</p><div className="choices">{data.assets.filter(a => a.kind === 'device' && ['ios', 'android', 'macos', 'windows'].includes(a.operatingSystem ?? '')).map(a => option(a.name, () => choosePlatform(asset, a.operatingSystem as Platform, a.id), tx(language, 'Listed device', '登録済みの端末')))}{(['ios', 'android', 'macos', 'windows'] as const).map(platform => option(`${PLATFORMS[platform]} ${tx(language, '(add device)', 'を追加')}`, () => choosePlatform(asset, platform)))}{!isManager(asset) && route !== 'auth-device' && option(tx(language, 'Use the web settings', 'Webの設定画面で進める'), () => choosePlatform(asset, 'web'), tx(language, 'For Windows, Android, or another browser', 'Windows・Androidなどのブラウザーから'))}</div></>;
  } else if (route === 'recorded' && asset) {
    content = <><span className="hero-step"><Check /></span><h1>{tx(language, 'Your existing record is kept', '以前の記録を引き継いでいます')}</h1><p>{asset.name}</p><p>{tx(language, 'This setting was already recorded. Updated instructions do not erase completed work.', 'この設定には以前の作業記録があります。説明を更新しても、完了記録を消したり、やり直しを求めたりしません。')}</p>{button(tx(language, 'Continue', '続きへ進む'), () => void save(afterRecipe(data, asset, recipeId)))}<button className="text-button" onClick={() => void save(beginRecipe(data, asset.id, recipeId, true))}>{tx(language, 'Review the setting again', '設定をもう一度見直す')}</button></>;
  } else if (route === 'auth-location' && asset) {
    content = <><h1>{tx(language, 'Where do you approve sign-ins?', 'どの端末でログインを承認しますか？')}</h1><p>{tx(language, 'Select a device only if you confirmed that this account’s codes, authenticator or passkey are on it.', '今回のアカウントの確認コード・認証アプリ・パスキーがあると確認した端末だけを選んでください。')}</p><div className="choices">{data.assets.filter(a => a.kind === 'device').map(a => option(a.name, () => void save(afterAuthentication(addRelation(data, asset.id, a.id, 'authentication'), asset)), tx(language, 'I confirmed that this device authenticates this account', 'この端末で認証することを確認した')))}{option(tx(language, 'Add another authentication device', '認証に使う別の端末を追加する'), () => go(`auth-device/${asset.id}`))}{option(tx(language, 'Not sure / do not record a connection', '分からない・つながりを記録しない'), () => void save(afterAuthentication(data, asset)))}</div></>;
  } else if (route === 'recovery-location' && asset) {
    content = <><h1>{tx(language, 'Record where the backup is kept', '予備の手段の場所を記録する')}</h1><p>{tx(language, 'Record only the type and connection. No phone number or recovery code is needed.', '種類とつながりだけを記録します。電話番号や復旧コードは入力しません。')}</p><div className="choices">{asset.provider !== 'google' && option(tx(language, 'A separate phone / phone number', '独立した予備の電話・電話番号'), () => addOffline(asset, 'phone'))}{(asset.provider === 'google' || isExtendedMail(asset.provider)) && option(tx(language, 'Printed recovery codes', '紙で保管した復旧コード'), () => addOffline(asset, 'paper'))}{asset.provider === 'microsoft' && data.assets.filter(a => a.kind === 'account' && a.id !== asset.id && !isManager(a)).map(a => option(`${a.name} ${tx(language, '(recovery email)', '（復旧用メール）')}`, () => void save(move(addRelation(data, asset.id, a.id, 'recovery-email'), 'manager-select'))))}{option(tx(language, 'Do not record a connection', 'つながりは記録しない'), () => go('manager-select'))}</div></>;
  } else if (route === 'manager-select') {
    content = <><span className="hero-step"><LockKeyhole /></span><span className="eyebrow">{tx(language, 'NEXT · PASSWORDS', '次は、パスワード。')}</span><h1>{tx(language, 'Which password manager will you use?', 'どのパスワードマネージャーを使いますか？')}</h1><p>{tx(language, 'We’ll guide you through recovery, two-factor authentication, and saving and using an important login.', '導入だけでなく、復旧の備え・マネージャー自体の認証・重要なログイン情報の保存と利用まで進めます。')}</p><div className="choices">{(['bitwarden', '1password'] as const).map(product => option(PROVIDERS[product], () => void save(move({ ...data, guide: { ...data.guide, pendingProvider: product } }, 'manager-identity')), product === 'bitwarden' ? tx(language, 'Free plan available; US / EU servers', '無料プランあり・米国／EUのサーバー') : tx(language, 'Paid subscription; individual / family account', '有料プラン・個人／家族アカウント')))}{option(tx(language, 'Another product / decide later', '別の製品を使う・後で決める'), () => void save(deferStep(data)))}</div></>;
  } else if (route === 'manager-identity') {
    const provider = data.guide.pendingProvider ?? 'bitwarden';
    const createManager = (existing?: Asset) => {
      const a = existing ? { ...existing, provider, services: [...new Set([...existing.services, 'manager' as const])] } : { ...makeAsset({ kind: 'account', type: 'Password manager', name: PROVIDERS[provider], importance: 'critical' }), provider, purpose: 'personal' as const, services: ['manager' as const] };
      const next = { ...data, assets: existing ? data.assets.map(x => x.id === a.id ? a : x) : [...data.assets, a], guide: { ...data.guide, managerId: a.id } };
      void save(move(next, `platform/${a.id}/manager`));
    };
    content = <><h1>{tx(language, 'Reuse an existing entry?', '登録済みの項目を使いますか？')}</h1><p>{PROVIDERS[provider]}</p><div className="choices">{data.assets.filter(a => isManager(a) && (!a.provider || a.provider === provider)).map(a => option(a.name, () => createManager(a)))}{option(tx(language, 'Add this manager', 'このマネージャーを追加する'), () => createManager())}</div></>;
  } else if (route === 'region' && asset) {
    content = <><h1>{tx(language, 'Which Bitwarden server do you use?', 'Bitwardenのサーバーはどちらですか？')}</h1><p>{tx(language, 'Existing accounts must use the server where they were created. Check the app’s server selection.', '既存のアカウントは、作成したサーバーを選んでください。アプリのサーバー選択で確認できます。')}</p><div className="choices">{(['us', 'eu'] as const).map(region => option(region === 'us' ? 'US · vault.bitwarden.com' : 'EU · vault.bitwarden.eu', () => void save(beginRecipe({ ...data, guide: { ...data.guide, answers: { ...data.guide.answers, [`${id}:region`]: region } } }, id, 'manager'))))}{option(tx(language, 'Self-hosted / not sure', 'セルフホスト・分からない'), () => go(`unsupported/${id}`))}</div></>;
  } else if (route === 'password-prerequisite') {
    content = <><h1>{tx(language, 'Secure recovery before changing passwords', 'パスワードの変更前に、復旧の備えを。')}</h1><p>{tx(language, 'We need a confirmed email recovery method and working two-factor authentication on the manager. Complete those tasks first.', 'メールの復旧手段と、マネージャーの認証を先に確認します。未完了の作業へ戻れます。')}</p><div className="choices">{account && option(tx(language, 'Check email recovery', 'メールの復旧手段を確認する'), () => void save(beginRecipe(data, account.id, 'recovery')))}{manager && option(tx(language, 'Finish manager setup', 'マネージャーの設定を続ける'), () => void save(beginRecipe(data, manager.id, 'manager')))}{option(tx(language, 'Protect a device first', '先に端末の対策を進める'), () => go('device-select'))}</div></>;
  } else if (route === 'device-version' && asset) {
    const windows = asset.operatingSystem === 'windows';
    content = <><h1>{tx(language, 'Which OS version does this device use?', 'この端末のOSはどの世代ですか？')}</h1><p>{tx(language, 'The backup and settings screens differ by OS version. Choose only the version you have confirmed.', 'OSの世代により、バックアップや設定の画面が異なります。確認できたものを選んでください。')}</p><div className="choices">{option(windows ? 'Windows 11' : tx(language, 'macOS Ventura 13 or later', 'macOS Ventura 13以降'), () => void save(beginRecipe({ ...data, guide: { ...data.guide, answers: { ...data.guide.answers, [`${id}:version`]: windows ? 'windows11' : 'mac13plus' } } }, id, 'device')))}{option(tx(language, 'Older version / not sure', '以前のバージョン・分からない'), () => go(`unsupported/${id}`))}</div></>;
  } else if (route === 'device-select') {
    content = <><span className="hero-step"><Smartphone /></span><h1>{tx(language, 'Which device should we protect next?', '次に、どの端末を対策しますか？')}</h1><p>{tx(language, 'Prepare a backup before installing updates.', 'バックアップを確保してから、更新を進めます。')}</p><div className="choices">{data.assets.filter(a => a.kind === 'device').map(a => option(a.name, () => void save(beginRecipe(data, a.id, 'device'))))}{(['ios', 'android', 'macos', 'windows'] as const).map(platform => option(`${PLATFORMS[platform]} ${tx(language, '(add)', 'を追加')}`, () => {
      const a = makeAsset({ kind: 'device', type: platform === 'ios' || platform === 'android' ? 'Smartphone' : 'Computer', name: `${PLATFORMS[platform]} ${data.assets.filter(a => a.kind === 'device').length + 1}`, importance: 'critical', operatingSystem: platform });
      void save(beginRecipe({ ...data, assets: [...data.assets, a], guide: { ...data.guide, deviceId: a.id } }, a.id, 'device'));
    }))}{option(tx(language, 'Later', '後で進める'), () => go('finish'))}</div></>;
  } else if (route === 'backup-location' && asset) {
    content = <><h1>{tx(language, 'Where is this device backed up?', 'この端末のバックアップ先は？')}</h1><p>{tx(language, 'Choose the account or disk you confirmed in the backup settings.', 'バックアップ画面で確認したアカウントやディスクを選んでください。')}</p><div className="choices">{data.assets.filter(a => a.kind === 'account' && !isManager(a)).map(a => option(a.name, () => void save(move(addRelation(data, asset.id, a.id, 'backup'), 'finish'))))}{option(tx(language, 'A separate backup disk', '別のバックアップ用ディスク'), () => addOffline(asset, 'disk'))}{option(tx(language, 'Leave the connection unconfirmed', 'つながりは未確認のままにする'), () => go('finish'))}</div></>;
  } else if (route === 'managed' || route === 'unsupported') {
    content = <><h1>{tx(language, route === 'managed' ? 'Check your organization’s rules first' : 'Find the right instructions for this environment', route === 'managed' ? '仕事・学校の管理ルールを確認する' : 'この環境に合う手順を確認する')}</h1><p>{tx(language, route === 'managed' ? 'Work and school settings may be controlled by an administrator. Confirm which authentication methods you are allowed to use. Do not bypass a restriction.' : 'This environment does not have a verified recipe in this guide yet. We will keep this task unfinished.', route === 'managed' ? '仕事や学校の設定は、管理者が制御している場合があります。利用できる認証方法を確認してください。制限を回避する操作は案内しません。' : 'この環境で確認済みの手順は、まだ用意できていません。この作業は未完了のまま残します。')}</p>
      {route === 'managed' && asset?.provider !== 'other' && button(tx(language, 'I am allowed to use personal-account settings', '個人アカウント向けの設定を使えると確認した'), () => void save(beginRecipe({ ...data, guide: { ...data.guide, answers: { ...data.guide.answers, [`${id}:managedAllowed`]: 'yes' } } }, id, 'email-mfa')))}
      <Trouble data={data} language={language} save={save} close={() => go('manager-select')} />{button(tx(language, 'Continue with another task', '別の対策へ進む'), () => go('manager-select'), true)}</>;
  } else {
    content = <><span className="hero-step"><Check /></span><h1>{tx(language, 'Your work is saved', 'ここまでの作業を保存しました')}</h1><p>{tx(language, 'Review your Security Map or continue with another account or device. Unfinished tasks stay unfinished.', 'Security Mapでつながりを確認したり、別のアカウントや端末の対策を続けたりできます。未完了の作業は、そのまま残っています。')}</p><div className="choices">{option(tx(language, 'Protect another account', '別のアカウントを対策する'), () => go('start'))}{option(tx(language, 'Protect another device', '別の端末を対策する'), () => go('device-select'))}{option(tx(language, 'Set up a password manager', 'パスワードマネージャーを設定する'), () => go('manager-select'))}</div></>;
  }
  function addOffline(target: Asset, kind: 'phone' | 'paper' | 'disk') {
    const item = makeAsset({ kind: 'backup', type: kind === 'phone' ? 'Independent phone' : kind === 'paper' ? 'Offline recovery' : 'Backup disk', name: tx(language, kind === 'phone' ? 'Independent backup phone' : kind === 'paper' ? 'Printed recovery information' : 'Backup disk', kind === 'phone' ? '独立した予備の電話' : kind === 'paper' ? '紙の復旧用情報' : 'バックアップディスク'), importance: 'critical' });
    item.controls = { available: 'verified' }; item.controlEvidence = { available: 'user-confirmed' };
    const next = addRelation({ ...data, assets: [...data.assets, item] }, target.id, item.id, kind === 'disk' ? 'backup' : 'offline-recovery');
    void save(move(next, route === 'backup-location' ? 'finish' : 'manager-select'));
  }
  const deferred = Object.entries(data.guide.steps).filter(([, s]) => s.status === 'later');
  const completed = Object.entries(data.guide.steps).filter(([key, s]) => s.status === 'done' && currentTask({ ...data, guide: { ...data.guide, cursor: key } })?.step.control);
  return <div className="guide-layout"><div className="guide-main"><div className="guide-back">{data.guide.history.length > 0 && <button className="text-button" onClick={() => void save(back(data))}><ArrowLeft size={17} />{tx(language, 'Back', '戻る')}</button>}<span>{tx(language, 'Progress saves as you go', '進むたびに途中保存')}</span></div><section className="guide-card" ref={heading} tabIndex={-1} aria-label={tx(language, 'Current guide step', '現在のガイド')}>{content}</section></div>
    <aside className="guide-sidebar"><span className="eyebrow">{tx(language, 'YOUR GUIDE', '今日のガイド')}</span><ol className="journey"><li className={['start', 'provider', 'identity', 'purpose', 'auth-location', 'recovery-location'].includes(route) || task?.recipe.id === 'email-mfa' || task?.recipe.id === 'recovery' ? 'current' : ''}><span>01</span><div><strong>{tx(language, 'Protect your email', 'メールの認証と復旧')}</strong><small>{tx(language, 'Start with your most important login', 'ほかのアカウントを守る起点')}</small></div></li><li className={route.startsWith('manager') || task?.recipe.id === 'manager' || task?.recipe.id === 'password' ? 'current' : ''}><span>02</span><div><strong>{tx(language, 'Manage your passwords', 'パスワードを管理する')}</strong><small>{tx(language, 'Save one and use it', '保存して、使えるところまで')}</small></div></li><li className={route.startsWith('device') || task?.recipe.id === 'device' ? 'current' : ''}><span>03</span><div><strong>{tx(language, 'Prepare your devices', '端末の紛失や故障に備える')}</strong><small>{tx(language, 'Backups and updates', 'バックアップと更新')}</small></div></li></ol>
      <details className="records"><summary>{tx(language, `Deferred · ${deferred.length}`, `後回しの作業 · ${deferred.length}件`)}</summary>{deferred.length === 0 ? <p>{tx(language, 'No deferred tasks.', '後回しの作業はありません。')}</p> : deferred.map(([key]) => <button key={key} className="record-link" onClick={() => go(key)}>{currentTask({ ...data, guide: { ...data.guide, cursor: key } })?.step.title[language] ?? tx(language, 'Resume task', '作業を再開する')}<ArrowRight size={15} /></button>)}</details>
      <details className="records"><summary>{tx(language, `Completed settings · ${completed.length}`, `設定の完了記録 · ${completed.length}件`)}</summary>{completed.map(([key]) => { const done = currentTask({ ...data, guide: { ...data.guide, cursor: key } }); return <div key={key}><span>{done?.asset.name}<br />{done?.step.title[language]}</span><button className="text-button" onClick={() => void save(undoStep(data, key))}><RotateCcw size={14} />{tx(language, 'Undo', '取り消す')}</button></div>; })}</details>
    </aside></div>;
}

const PROBLEMS = [c('The screen looks different', '画面が違う'), c('I cannot find the item', '項目が見つからない'), c('I do not have permission', '権限がない'), c('This device or account is unsupported', '対応していない'), c('I cannot use my recovery method', '復旧手段が使えない'), c('There is not enough storage', '保存容量が足りない'), c('The authentication code is rejected', '認証コードが合わない'), c('I cannot scan a QR code on the same device', '同じ端末でQRコードを読めない'), c('I am offline or the change is pending', '通信がない・変更が保留されている')];
function Trouble({ data, language, save, close }: Props & { close: () => void }) {
  const [selected, setSelected] = useState<number | null>(null), [unresolved, setUnresolved] = useState(false), [copied, setCopied] = useState(false), [copyFailed, setCopyFailed] = useState(false);
  const task = currentTask(data);
  const problem = selected === null ? '' : say(PROBLEMS[selected], language);
  return <div className="trouble"><h2>{tx(language, 'What is getting in the way?', 'どこで困っていますか？')}</h2><div className="problem-options">{PROBLEMS.map((p, n) => <button className={`chip ${selected === n ? 'selected' : ''}`} key={p.en} aria-pressed={selected === n} onClick={() => { setSelected(n); setUnresolved(false); setCopied(false); setCopyFailed(false); }}>{say(p, language)}</button>)}</div>
    {selected !== null && <><p>{tx(language,
      selected === 0 || selected === 1 ? 'Check that you are in the correct account and in the service’s account settings, rather than the mail app’s settings. Reopen the official settings. For iCloud, you can switch to the verified web route.' : selected === 2 ? 'Work, school and family settings may be restricted. Keep the task unfinished and ask the administrator which methods are allowed.' : selected === 3 ? 'Do not try to bypass the restriction. Use another supported device, or defer this task while you arrange a supported method.' : selected === 4 ? 'Stop before changing authentication or signing out. Keep your existing session and current methods. Restore access to the existing recovery method first.' : selected === 5 ? 'Do not delete the only copy of important data. Check available storage and backup size. Use another backup destination or defer this task until space is available.' : 'Keep your current session and existing authentication methods while resolving this issue.',
      selected === 0 || selected === 1 ? '正しいアカウントで、メールアプリの設定ではなくサービスのアカウント設定を開いているか確認してください。公式設定を開き直せます。iCloudは確認済みのWeb手順へ切り替えられます。' : selected === 2 ? '仕事・学校・家族の設定は、管理者が制限している場合があります。作業を未完了のまま残し、利用できる方法を管理者へ確認してください。' : selected === 3 ? '制限を回避せず、対応する別の端末を使うか、対応する方法を用意できるまで後回しにしてください。' : selected === 4 ? '認証の変更やログアウトの前に止めてください。現在のログインと認証方法を残し、先に既存の復旧手段を使える状態へ戻します。' : selected === 5 ? '大切なデータの唯一のコピーは削除しないでください。空き容量とバックアップのサイズを確認し、別の保存先を使うか、容量を確保するまで後回しにしてください。' : '解決するまで現在のログインと既存の認証方法を残してください。')}</p>
      {selected === 6 && <p>{tx(language, 'Check the account label and automatic date/time on the authenticator device. Use the current code after it refreshes, entering it only in the official service. Do not delete the existing registration while troubleshooting.', '認証アプリの対象アカウントと、端末の日時の自動設定を確認してください。コードが更新されてから、現在のコードを公式画面だけに入力します。解決するまで既存の登録を削除しないでください。')}</p>}
      {selected === 7 && <p>{tx(language,
        task?.asset.provider === 'proton' ? 'On Proton select Enter key manually instead. Enter that key directly into the authenticator’s manual account setup. Do not paste it in this app or a message.' : task?.asset.provider === 'mailcom' || task?.asset.provider === 'gmx' ? 'Select Copy code below the QR. On this same device, paste it directly into your authenticator’s manual setup. Do not send the secret by email or chat.' : 'If the official setup offers a manual key, enter it directly into your authenticator. Otherwise display the QR on a second device you control and scan it. Do not save or send a screenshot of the secret.',
        task?.asset.provider === 'proton' ? 'Protonの「Enter key manually instead」を選び、そのキーを認証アプリの手入力による追加画面へ直接入力してください。このアプリやメッセージへ貼り付けません。' : task?.asset.provider === 'mailcom' || task?.asset.provider === 'gmx' ? 'QRコードの下の「Copy code」を選び、同じ端末の認証アプリの手入力画面へ直接貼り付けてください。秘密情報をメールやチャットで送らないでください。' : '公式画面に手入力用キーがある場合は認証アプリへ直接入力してください。なければ、自分が管理する別の端末にQRを表示して読み取ります。秘密情報のスクリーンショットは保存・送信しないでください。')}</p>}
      {selected === 8 && <p>{tx(language, 'Keep the task unfinished. Reconnect before submitting the setting. If the service shows a security waiting period, keep existing access and return after the stated time; do not bypass it.', '作業は未完了のまま残します。接続を回復してから設定を確定してください。サービスが待機期間を示している場合は、既存のアクセスを残し、指定された時刻以降に戻ります。待機を回避しません。')}</p>}
      {task?.asset.provider === 'apple' && (selected === 0 || selected === 1) && <button className="button secondary" onClick={() => void save(beginRecipe({ ...data, guide: { ...data.guide, answers: { ...data.guide.answers, [`${task.asset.id}:platform`]: 'web' } } }, task.asset.id, task.recipe.id, true))}>{tx(language, 'Switch to the web instructions', 'Webの手順へ切り替える')}</button>}
      <div className="help-actions"><button className="button secondary" onClick={close}>{tx(language, 'Try this and return', '確認して操作へ戻る')}</button><button className="text-button" onClick={() => setUnresolved(true)}>{tx(language, 'This still does not resolve it', 'この案内でも解決しない')}</button></div>
      {unresolved && <div className="ai-help"><h3>{tx(language, 'Prepare a question for an AI', 'AIへの相談文を用意する')}</h3><p>{tx(language, 'Nothing is sent automatically. Copy the text and choose where to ask. Hide personal details, passwords and codes in any screenshot.', '自動送信はしません。相談先を自分で選んで、コピーした文章を貼り付けてください。画像を添える場合は、個人情報・パスワード・各種コードを隠してください。')}</p><textarea readOnly aria-label={tx(language, 'AI consultation prompt', 'AIへの相談文')} value={helpPrompt(data, problem, language)} rows={8} /><button className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(helpPrompt(data, problem, language)); setCopied(true); setCopyFailed(false); } catch { setCopyFailed(true); } }}>{tx(language, copied ? 'Copied' : 'Copy the question', copied ? 'コピーしました' : '相談文をコピーする')}</button>{copyFailed && <p role="status">{tx(language, 'Copy was unavailable. Select and copy the text above.', 'コピー機能が使えませんでした。上の文章を選択してコピーしてください。')}</p>}</div>}
    </>}
  </div>;
}
