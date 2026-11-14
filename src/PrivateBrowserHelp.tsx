import { useEffect, useRef, useState } from 'react';
import type { Dataset, Language } from './models';
import { SOURCES, type SourceId } from './guideCatalog';
import { privateBrowserChoices, privateBrowserOperations, type PrivateBrowser, type SafariLayout } from './privateBrowserCatalog';
import { tx } from './ui';

type Props = { data: Dataset; language: Language; save: (next: Dataset) => Promise<boolean>; url?: string };
const names = { safari: 'Safari', chrome: 'Chrome', firefox: 'Firefox', edge: 'Microsoft Edge' };

/** Optional navigation help. It never completes the surrounding security task. */
export function PrivateBrowserHelp({ data, language, save, url }: Props) {
  const details = useRef<HTMLDetailsElement>(null);
  const prefix = `browserHelpV1/${encodeURIComponent(data.guide.cursor)}/`;
  const read = (key: string) => data.guide.answers[prefix + key];
  const os = read('os'), browser = read('browser') as PrivateBrowser | undefined;
  const layout = read('layout') as SafariLayout | undefined;
  const operations = browser ? privateBrowserOperations(browser, os, layout) : undefined;
  const requestedIndex=Number(read('index')??'0');
  const index=Number.isSafeInteger(requestedIndex)&&requestedIndex>=0?requestedIndex:0;
  const screen=read('screen'),firefoxStage=read('firefox-stage'),firefoxReady=read('firefox-tabs');
  useEffect(()=>{const h=details.current?.querySelector('h2');if(details.current?.open&&h){h.tabIndex=-1;h.focus();}},[os,browser,layout,index,screen,firefoxStage,firefoxReady]);
  const [copyFailed, setCopyFailed] = useState(false), [copied, setCopied] = useState(false);
  const write = (values: Record<string, string>) => void save({ ...data, guide: { ...data.guide,
    answers: { ...data.guide.answers, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [prefix + key, value])) } } });
  const choose = (label: string, values: Record<string, string>) => <button key={label} className="choice" onClick={() => write(values)}>{label}</button>;
  const next = (label: string, values: Record<string, string>) => <button className="button secondary" onClick={() => write(values)}>{label}</button>;
  const close = () => { if (details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } };
  let content;
  if (!os) content = <><h2>{tx(language, 'Which device will you use for the separate login?', '別のログイン画面を開く端末は？')}</h2><div className="choices">{[
    ['ios', 'iPhone / iPad'], ['android', 'Android'], ['macos', 'Mac'], ['windows', 'Windows'], ['ubuntu', 'Ubuntu'],
  ].map(([value, label]) => choose(label, { os: value, browser: '', layout: '', index: '0', screen: '' }))}
    {choose(tx(language, 'Another device / I cannot use a separate window', '別の端末・別の画面を使えない'), { os: 'other' })}</div></>;
  else if (!privateBrowserChoices(os).length || read('browser') === 'other') content = <><h2>{tx(language, 'Keep your current account page open', '今開いているアカウントの画面を残す')}</h2><p>{tx(language,
    'Use another device or browser that you can confirm is not signed in to this service. If none is available, return to the setting and leave the login check for later.',
    '今回のサービスにログインしていないと確認できる、別の端末かブラウザーを使ってください。用意できない場合は設定の手順へ戻り、ログインの確認を後回しにできます。')}</p>
    {next(tx(language, 'Choose a device again', '端末を選び直す'), { os: '', browser: '', layout: '', index: '0', screen: '' })}</>;
  else if (!browser) content = <><h2>{tx(language, 'Which browser will you use?', 'どのブラウザーを使いますか？')}</h2><div className="choices">{privateBrowserChoices(os).map(value => choose(names[value], { browser: value, layout: '', index: '0', screen: '', 'firefox-tabs': '' }))}
    {choose(tx(language, 'Another browser / not available', '別のブラウザー・使えない'), { browser: 'other' })}</div></>;
  else if (browser === 'safari' && os === 'ios' && !layout) content = <><h2>{tx(language, 'What does Safari show?', 'Safariは、どの表示ですか？')}</h2><div className="choices">
    {choose(tx(language, 'iPhone: a More button', 'iPhone：「詳細」ボタンがある'), { layout: 'more' })}
    {choose(tx(language, 'iPhone: tab groups (iOS 17 or earlier)', 'iPhone：タブグループがある（iOS 17以前）'), { layout: 'tabs' })}
    {choose('iPad', { layout: 'ipad' })}
    {choose(tx(language, 'None of these', 'どれにも当てはまらない'), { browser: '', layout: '' })}</div></>;
  else if (browser === 'firefox' && os === 'ios' && read('firefox-tabs') !== 'ready') {
    const stage=read('firefox-stage')??'menu';
    const menu=stage==='menu',settings=stage==='settings';
    content=<><h2>{tx(language,menu?'Open Firefox’s menu':settings?'Open Firefox settings':'Check whether Firefox closes private tabs',menu?'Firefoxのメニューを開く':settings?'Firefoxの設定を開く':'プライベートタブを閉じる設定を確認する')}</h2><p>{tx(language,
      menu?'Tap the menu at the bottom of Firefox on iPhone, or at the top right on iPad.':settings?'Select Settings.':'In Privacy, find Close Private Tabs. If it is on, the sign-in screen may close when you return to this guide. Keep it off if already off; otherwise you can turn it off or choose another browser.',
      menu?'iPhoneではFirefoxの画面下、iPadでは右上にあるメニューをタップしてください。':settings?'「設定」を選んでください。':'「プライバシー」の「プライベートタブを閉じる（Close Private Tabs）」を確認してください。オンの場合は、このガイドへ戻るとログイン画面が閉じることがあります。すでにオフならそのまま使えます。オンの場合はオフにするか、別のブラウザーを選べます。')}</p>
      {menu||settings?next(tx(language,menu?'The menu is open':'Settings are open',menu?'メニューを開きました':'設定を開きました'),{'firefox-stage':menu?'settings':'privacy'}):<>{next(tx(language,'It is off','オフになっています'),{'firefox-tabs':'ready'})}{next(tx(language,'Use another browser','別のブラウザーを使う'),{browser:'',index:'0'})}</>}
      <details className="sources"><summary>{tx(language,'Official sources','公式の出典')}</summary><a href={SOURCES.privateFirefoxKeepTabs.url} target="_blank" rel="noopener noreferrer">{SOURCES.privateFirefoxKeepTabs.title}</a><small>{SOURCES.privateFirefoxKeepTabs.checked}</small></details></>;
  }
  else if (!operations) content = <><h2>{tx(language, 'Choose another browser', '別のブラウザーを選ぶ')}</h2>{next(tx(language, 'Choose a browser', 'ブラウザーを選ぶ'), { browser: '', layout: '', index: '0' })}</>;
  else if (index < operations.length) {
    const operation = operations[index];
    content = <><h2>{operation.title[language]}</h2><p>{operation.action[language]}</p><p className="subtle">{operation.expected[language]}</p>
      {next(operation.button[language], { index: String(index + 1) })}
      <details className="sources"><summary>{tx(language, 'Official sources', '公式の出典')}</summary>{operation.sources.map(id => { const source = SOURCES[id as SourceId]; return source && <p key={id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><small>{source.checked}</small></p>; })}</details></>;
  } else if (read('screen') === 'already') content = <><h2>{tx(language, 'Use a screen that shows the sign-in form', 'ログイン画面が表示される別の画面を使う')}</h2><p>{tx(language,
    'Private tabs may share an existing private login. Keep that account page open and choose another browser or device that is not signed in. Do not sign out your only working login.',
    'プライベートタブ同士でログインを共有することがあります。開いているアカウントの画面は残し、未ログインの別のブラウザーか端末を選んでください。唯一使えるログインからサインアウトする必要はありません。')}</p>
    {next(tx(language, 'Choose another browser', '別のブラウザーを選ぶ'), { browser: '', layout: '', index: '0', screen: '' })}
    {next(tx(language, 'Choose another device', '別の端末を選ぶ'), { os: '', browser: '', layout: '', index: '0', screen: '' })}</>;
  else if (read('screen') === 'form') content = <><h2>{tx(language, 'Continue in the sign-in form you opened', '用意したログイン画面で操作を続ける')}</h2><p>{tx(language,'Return to the setting and use the sign-in form you prepared.','設定の手順へ戻り、用意したログイン画面で操作してください。')}</p></>;
  else content = <><h2>{tx(language, 'Open the official site in the new screen', '用意した画面で公式サイトを開く')}</h2><p>{tx(language,
    'Keep this guide open. Paste the official address into the address bar of the private screen you prepared, then return here.',
    'このガイドは開いたまま、用意したプライベート画面のアドレス欄に公式URLを貼り付けて開いてください。開いたら、このガイドへ戻ります。')}</p>
    {url && <><input aria-label={tx(language, 'Official address to copy', 'コピーする公式URL')} readOnly value={url}/><button className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setCopyFailed(false); } catch { setCopyFailed(true); } }}>{tx(language, copied ? 'Copied' : 'Copy official address', copied ? 'コピーしました' : '公式URLをコピーする')}</button>{copyFailed && <p role="status">{tx(language, 'Select and copy the address above.', '上のURLを選択してコピーしてください。')}</p>}</>}
    <h3>{tx(language, 'What does the official site show?', '公式サイトには何が表示されましたか？')}</h3><div className="choices">
      {choose(tx(language, 'A sign-in form', 'ログイン画面が表示された'), { screen: 'form' })}
      {choose(tx(language, 'My account opened without signing in', 'ログインせずにアカウントが開いた'), { screen: 'already' })}</div></>;
  return <details className="technical private-browser-help" ref={details}><summary>{tx(language, 'How to open a separate sign-in screen', '別のログイン画面の開き方')}</summary>{content}
    <div className="step-tools"><button className="text-button" onClick={() => write({ os: '', browser: '', layout: '', index: '0', screen: '' })}>{tx(language, 'Choose the device and browser again', '端末・ブラウザーを選び直す')}</button><button className="text-button" onClick={close}>{tx(language, 'Return to the setting', '設定の手順に戻る')}</button></div></details>;
}
