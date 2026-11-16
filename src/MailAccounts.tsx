import { useEffect,useState, type FormEvent } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import {canBeMailAccount} from './accountRoles';
import { PROVIDERS } from './guideCatalog';
import { move } from './guideEngine';
import { DataUpgradeConflict, type Asset, type Dataset, type Language } from './models';
import { tx } from './ui';
import { MAIL_PROVIDERS, addListedMailbox, beginMailboxChecks, continueAfterMailboxes, listedMailboxes,
  mailboxAddress, mailboxIdentity, mailboxStatus, mailPlan, mailPurposeLabel, matchingMailboxes,
  nextMailboxes, mailboxAddresses,reuseMailboxDetails,mailDraft,resumeMailDraft,editMailboxDetails,prepareMailbox, recordMailboxPurpose, saveMailboxDetails, selectAdditionalMailProviders,
  setPrimaryMailbox, type MailProvider } from './mailAccounts';

type Props = { data: Dataset; language: Language; save: (data: Dataset) => Promise<boolean>;
  mode: 'start' | 'details' | 'purpose' | 'review' | 'add' | 'next' };
export function MailAccounts({ data, language, save, mode }: Props) {
  const plan=mailPlan(data),collection=mailDraft(data);
  const provider=collection?.provider??(MAIL_PROVIDERS.includes(data.guide.pendingProvider as MailProvider)?data.guide.pendingProvider as MailProvider:'other');
  const draft=data.assets.find(a=>a.id===(collection?collection.accountRef:data.guide.draftAccountId));
  const [address, setAddress] = useState(mailboxAddress(draft));
  const [purpose,setPurpose]=useState<'personal'|'work'>(draft?.purpose??'personal');
  const [label, setLabel] = useState(mailboxIdentity(draft)?.label ?? '');
  const [selectedProviders, setSelectedProviders] = useState<MailProvider[]>([]);
  const [primaryChoice,setPrimaryChoice]=useState(plan?.primaryRef);
  useEffect(()=>setPrimaryChoice(plan?.primaryRef),[plan?.primaryRef]);
  const [matches, setMatches] = useState<Asset[]>([]), [error, setError] = useState('');
  const act = async (change: () => Dataset) => {
    setError('');
    try { return await save(change()); }
    catch (e) { setError(tx(language, e instanceof DataUpgradeConflict
      ? 'This saved format needs a newer app. Keep your records and encrypted backup.' : 'Check the email address and the name.',
    e instanceof DataUpgradeConflict ? '保存形式に対応する版のアプリが必要です。今の記録と暗号化バックアップを保管してください。' : 'メールアドレスと呼び名を確認してください。')); return false; }
  };
  const choosePrimary=async(id:string,input:HTMLInputElement)=>{
    const previous=plan?.primaryRef;setPrimaryChoice(id);
    if(!await act(()=>setPrimaryMailbox(data,id)))setPrimaryChoice(previous);
    requestAnimationFrame(()=>{if(input.isConnected)input.focus();});
  };
  const mailCard = (a: Asset) => <><strong>{a.name}</strong>{mailboxAddress(a) && mailboxAddress(a) !== a.name && <small>{mailboxAddress(a)}</small>}
    {mailboxAddresses(a).filter(v=>v!==mailboxAddress(a)).map(v=><small key={v}>{v}</small>)}<small>{a.provider ? PROVIDERS[a.provider] : tx(language, 'Choose a service', 'サービスを選ぶ')} · {mailPurposeLabel(a, language)}</small></>;
  const progress = (done: number) => <div className="mail-progress"><span>{tx(language, 'Email details', 'メールの入力')}</span><span>{done} / 3</span>
    <progress className="guide-step-progress" value={done} max={3} aria-label={tx(language, 'Email details progress', 'メール入力の進み具合')}/></div>;
  const providers = <div className="choices provider-choices">{MAIL_PROVIDERS.map(p => <button key={p} className="choice" onClick={() => void act(() => prepareMailbox(data, p))}>
    {p === 'other' ? tx(language, 'Another service', 'その他のサービス') : PROVIDERS[p]}<ArrowRight size={17}/></button>)}</div>;
  const submitDetails = (event: FormEvent) => {
    event.preventDefault();
    const existing = !draft ? matchingMailboxes(data, provider, address) : [];
    if (existing.length) { setMatches(existing); return; }
    void act(() => saveMailboxDetails(data, provider, { address, label,...(collection?.done?{purpose}:{}) }, draft?.id));
  };
  let content;
  if (mode === 'start') {
    const accounts = listedMailboxes(data);
    content = <>{progress(0)}<h1>{tx(language, 'Which email is most important to you?', '一番重要なメールは、どれですか？')}</h1>
      <p>{tx(language, 'Start with the email you use to sign in to other services or reset their passwords.', 'ほかのサービスへのログインや、パスワードの再設定に使うメールから始めます。')}</p>
      {plan?.drafts.filter(d=>!d.done).map(d=><button className="record-link" key={d.id} onClick={()=>void act(()=>resumeMailDraft(data,d.id))}>{tx(language,`Continue ${PROVIDERS[d.provider]} details`,`${PROVIDERS[d.provider]}の入力を続ける`)}<ArrowRight size={17}/></button>)}
      {accounts.length > 0 && <div className="choices">{accounts.map(a => <button key={a.id} className="choice mailbox-choice" onClick={() => void act(() => addListedMailbox(data, a.id))}>{mailCard(a)}<ArrowRight size={17}/></button>)}</div>}
      {accounts.length ? <details className="mail-add"><summary>{tx(language, 'Add another email', 'ほかのメールを追加する')}</summary>{providers}</details> : providers}
      <button className="text-button" onClick={() => void act(() => move(data, 'manager-select'))}>{tx(language, 'I do not use email / do this later', 'メールを使っていない・後で進める')}</button></>;
  } else if (mode === 'details') {
    const candidates=data.assets.filter(a=>canBeMailAccount(a)&&a.provider===provider&&a.id!==draft?.id);
    content = <>{progress(1)}<h1>{tx(language, `${PROVIDERS[provider]} email`, `${PROVIDERS[provider]}のメール`)}</h1>
      <form className="mail-details-form" onSubmit={submitDetails}>
        <label>{tx(language, 'Email address (optional)', 'メールアドレス（任意）')}<input type="email" inputMode="email" autoComplete="off" maxLength={254} value={address} onChange={e => { setAddress(e.target.value); setMatches([]); }}/></label>
        <label>{tx(language, 'Name for this email (optional)', 'このメールの呼び名（任意）')}<input maxLength={80} autoComplete="off" value={label} onChange={e => setLabel(e.target.value)} placeholder={tx(language, 'e.g. Personal Gmail', '例：個人用Gmail')}/></label>
        {collection?.done&&<label>{tx(language,'Use','用途')}<select value={purpose} onChange={e=>setPurpose(e.target.value as 'personal'|'work')}><option value="personal">{tx(language,'Personal','個人用')}</option><option value="work">{tx(language,'Work / school','仕事・学校用')}</option></select></label>}
        <p className="subtle">{tx(language, 'An address or name helps distinguish emails from the same service. It stays in your encrypted records.', '同じサービスのメールを見分けるために使います。入力した内容も暗号化して保存します。')}</p>
        {!matches.length && <button className="button primary">{tx(language, 'Next', '次へ')}<ArrowRight size={17}/></button>}
      </form>
      {!matches.length&&candidates.length>0&&<details className="mail-add"><summary>{tx(language,'Use the same sign-in as an account in my records','記録済みのメールと同じログインで使う')}</summary><div className="choices">{candidates.map(a=><button key={a.id} className="choice mailbox-choice" onClick={()=>void act(()=>reuseMailboxDetails(data,a.id,address))}>{mailCard(a)}<ArrowRight size={17}/></button>)}</div></details>}
      {matches.length > 0 && <div className="mail-match"><p>{tx(language, 'There is already a record for this email.', 'このメールの記録があります。')}</p><div className="choices">{matches.map(a => <button key={a.id} className="choice mailbox-choice" onClick={() => void act(() => addListedMailbox(data, a.id))}>{mailCard(a)}<span>{tx(language, 'Continue this email', 'このメールの続きを進める')}</span></button>)}</div>
        <button className="text-button" onClick={() => void act(() => saveMailboxDetails(data, provider, { address, label }))}>{tx(language, 'Add it as a separate sign-in', '別のログインとして追加する')}</button></div>}
    </>;
  } else if (mode === 'purpose' && draft) {
    content = <>{progress(2)}<div className="mailbox-context">{mailCard(draft)}</div><h1>{tx(language, 'What do you use this email for?', 'このメールは何に使いますか？')}</h1>
      <div className="choices">{(['personal', 'work'] as const).map(p => <button key={p} className="choice" onClick={() => void act(() => recordMailboxPurpose(data, draft.id, p))}>
        {tx(language, p === 'personal' ? 'Personal' : 'Work / school', p === 'personal' ? '個人用' : '仕事・学校用')}<ArrowRight size={17}/></button>)}</div></>;
  } else if (mode === 'add' && plan) {
    content = <><h1>{tx(language, 'Which other email services do you use?', 'ほかに使っているメールサービスは？')}</h1>
      <p>{tx(language, 'You can select more than one. Add separate emails from the same service one at a time.', '複数選べます。同じサービスの別のメールも、1件ずつ追加できます。')}</p>
      <fieldset className="mail-provider-select"><legend className="sr-only">{tx(language, 'Email services', 'メールサービス')}</legend>{MAIL_PROVIDERS.map(p => <label key={p} className="mail-provider-option"><input type="checkbox" checked={selectedProviders.includes(p)} onChange={e => setSelectedProviders(e.target.checked ? [...selectedProviders, p] : selectedProviders.filter(v => v !== p))}/>{p === 'other' ? tx(language, 'Another service', 'その他のサービス') : PROVIDERS[p]}</label>)}</fieldset>
      <button className="button primary" disabled={!selectedProviders.length} onClick={() => void act(() => selectAdditionalMailProviders(data, selectedProviders))}>{tx(language, 'Add the selected emails', '選んだメールを追加する')}<ArrowRight size={17}/></button>
      <button className="text-button" onClick={() => void act(() => move(data, 'mail-review'))}>{tx(language, 'Return to my emails', 'メールの一覧へ戻る')}</button></>;
  } else if (mode === 'next' && plan) {
    const remaining = nextMailboxes(data);
    content = <><h1>{tx(language, remaining.length ? 'Which email will you protect next?' : 'Continue to passwords?', remaining.length ? '次に対策するメールは？' : 'パスワードの対策へ進みますか？')}</h1>
      <div className="choices">{remaining.map(a => <button key={a.id} className="choice mailbox-choice" onClick={() => void act(() => beginMailboxChecks(data, a.id, language))}>{mailCard(a)}<small>{mailboxStatus(a, language)}</small><ArrowRight size={17}/></button>)}</div>
      <button className="button primary" onClick={() => void act(() => continueAfterMailboxes(data))}>{tx(language, 'Continue to passwords', 'パスワードの対策へ進む')}<ArrowRight size={17}/></button>
      <button className="text-button" onClick={() => void act(() => move(data, 'mail-review'))}>{tx(language, 'Review my emails', 'メールの一覧を見直す')}</button></>;
  } else if (plan?.primaryRef) {
    const primaryRef=plan.primaryRef;
    content = <>{progress(plan.drafts.some(d=>!d.done)?2:3)}<h1>{tx(language, 'Your emails', '対策するメール')}</h1>
      <div className="mail-pending">{plan.drafts.filter(d=>!d.done).map(d=><button className="record-link" key={d.id} onClick={()=>void act(()=>resumeMailDraft(data,d.id))}>{tx(language,`Continue ${PROVIDERS[d.provider]} details`,`${PROVIDERS[d.provider]}の入力を続ける`)}<ArrowRight size={17}/></button>)}</div>
      <div className="mailbox-list">{plan.accountRefs.flatMap(id => data.assets.filter(a => a.id === id)).map(a => <div className="mailbox-card" key={a.id}>
        {mailCard(a)}<small>{mailboxStatus(a, language)}</small><button className="text-button" onClick={()=>void act(()=>editMailboxDetails(data,a.id))}>{tx(language,'Edit name or address','呼び名・アドレスを編集する')}</button>{plan.activeRef&&<button className="text-button" onClick={()=>void act(()=>beginMailboxChecks(data,a.id,language))}>{tx(language,'Continue this email','このメールの対策を進める')}</button>}<label className="mail-primary"><input type="radio" name="primary-mail" checked={primaryChoice === a.id} onChange={e => void choosePrimary(a.id,e.currentTarget)}/>{tx(language, 'Main email', 'メインのメール')}</label>
</div>)}</div>
      <button className="button primary" disabled={!data.assets.find(a=>a.id===primaryRef)?.purpose} onClick={() => void act(() => beginMailboxChecks(data, primaryRef, language))}>{tx(language, 'Start with my main email', 'メインのメールから対策する')}<ArrowRight size={17}/></button>
      <button className="button secondary" onClick={() => void act(() => move(data, 'mail-add-services'))}><Plus size={17}/>{tx(language, 'Add other emails', 'ほかのメールも追加する')}</button></>;
  } else content = <><h1>{tx(language, 'Choose your email', '使うメールを選ぶ')}</h1><button className="button primary" onClick={() => void act(() => move(data, 'start'))}>{tx(language, 'Choose an email service', 'メールサービスを選ぶ')}<ArrowRight size={17}/></button></>;
  return <div className="mail-accounts">{content}{error && <p className="error" role="alert">{error}</p>}</div>;
}
