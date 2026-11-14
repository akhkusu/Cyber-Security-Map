import { z } from 'zod';
import { canBeMailAccount } from './accountRoles';
import { PROVIDERS } from './guideCatalog';
import { beginRecipe, move, selectAccount } from './guideEngine';
import { DataUpgradeConflict, makeAsset, type Asset, type Dataset, type Language } from './models';

export const MAIL_PROVIDERS = ['apple', 'google', 'microsoft', 'proton', 'fastmail', 'tuta', 'zoho', 'yahoo', 'startmail', 'mailcom', 'gmx', 'other'] as const;
export type MailProvider = typeof MAIL_PROVIDERS[number];
const addressSchema = z.string().trim().min(3).max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u);
export const mailboxIdentitySchema = z.object({
  version: z.literal(1), address: addressSchema.optional(), additionalAddresses:z.array(addressSchema).default([]), label: z.string().trim().max(80).optional(),
}).passthrough();
export type MailboxIdentity = z.infer<typeof mailboxIdentitySchema>;
export const mailDraftSchema=z.object({id:z.string().min(1),provider:z.enum(MAIL_PROVIDERS),accountRef:z.string().min(1).optional(),done:z.boolean().default(false),nextProviders:z.array(z.enum(MAIL_PROVIDERS)).default([])}).passthrough();
export type MailDraft=z.infer<typeof mailDraftSchema>;
export const mailPlanSchema = z.object({
  version: z.literal(1), accountRefs: z.array(z.string().min(1)).default([]), primaryRef: z.string().min(1).optional(),
  activeRef: z.string().min(1).optional(), visitedRefs: z.array(z.string().min(1)).default([]),
  phase: z.enum(['collect', 'protect', 'paused']), cursors: z.record(z.string(), z.string()).default({}), drafts:z.array(mailDraftSchema).default([]),
}).passthrough();
export type MailPlan = z.infer<typeof mailPlanSchema>;

export function mailboxIdentity(asset?: Asset): MailboxIdentity | undefined {
  const result = mailboxIdentitySchema.safeParse(asset?.mailboxIdentityV1);
  return result.success ? result.data : undefined;
}
export function mailPlan(data: Dataset): MailPlan | undefined {
  const result = mailPlanSchema.safeParse(data.guide.mailAccountsV1);
  if (!result.success) return;
  const p = result.data;
  if (new Set(p.accountRefs).size !== p.accountRefs.length || (p.accountRefs.length>0? !p.primaryRef||!p.accountRefs.includes(p.primaryRef):!!p.primaryRef)
    || p.activeRef && !p.accountRefs.includes(p.activeRef)
    || p.visitedRefs.some(id => !p.accountRefs.includes(id))
    || p.accountRefs.some(id => !data.assets.some(a => a.id === id && canBeMailAccount(a)))
    || new Set(p.drafts.map(d=>d.id)).size!==p.drafts.length||p.drafts.some(d=>d.accountRef&&!p.accountRefs.includes(d.accountRef))) return;
  return p;
}
function assertPlanWritable(data: Dataset) {
  if (Object.hasOwn(data.guide, 'mailAccountsV1') && !mailPlan(data)) throw new DataUpgradeConflict();
}
function putPlan(data: Dataset, plan: MailPlan): Dataset {
  return { ...data, guide: { ...data.guide, mailAccountsV1: plan } };
}
export function listedMailboxes(data: Dataset): Asset[] {
  return data.assets.filter(a => canBeMailAccount(a) && (a.services.includes('mail') || a.type === 'Primary email' || !a.provider));
}
export function mailboxAddress(asset?: Asset): string {
  return mailboxIdentity(asset)?.address ?? '';
}
export function mailboxAddresses(asset?:Asset):string[]{const m=mailboxIdentity(asset);return m?[...(m.address?[m.address]:[]),...m.additionalAddresses]:[];}
export function mailPurposeLabel(asset: Asset, language: Language): string {
  return asset.purpose === 'work' ? language === 'ja' ? '仕事・学校用' : 'Work / school'
    : asset.purpose === 'personal' ? language === 'ja' ? '個人用' : 'Personal'
    : language === 'ja' ? '用途を選ぶ' : 'Choose a use';
}
export function mailboxStatus(asset: Asset, language: Language): string {
  const confirmed = (id: string) => ['verified', 'implemented'].includes(asset.controls[id]);
  return confirmed('mfa') && confirmed('recovery') ? language === 'ja' ? '認証と復旧の記録あり' : 'Authentication and recovery recorded'
    : confirmed('mfa') ? language === 'ja' ? '復旧方法を確認する' : 'Recovery needs checking'
    : language === 'ja' ? '認証を設定・確認する' : 'Set up or check authentication';
}
// Exact address suggestions are never an automatic account merge. In particular,
// do not collapse dots, plus aliases, identical display names, or separate providers.
export function matchingMailboxes(data: Dataset, provider: MailProvider, address: string): Asset[] {
  const parsed = addressSchema.safeParse(address); if (!parsed.success) return [];
  const key = (v: string) => { const at = v.lastIndexOf('@'); return v.slice(0, at) + '@' + v.slice(at + 1).toLowerCase(); };
  return data.assets.filter(a => canBeMailAccount(a) && a.provider === provider && mailboxAddresses(a).some(v=>key(v)===key(parsed.data)));
}
export function mailDraft(data:Dataset):MailDraft|undefined{
  const [route,id]=data.guide.cursor.split('/');return ['mail-details','mail-purpose'].includes(route)?mailPlan(data)?.drafts.find(d=>d.id===id):undefined;
}
export function resumeMailDraft(data:Dataset,id:string):Dataset{
  const d=mailPlan(data)?.drafts.find(d=>d.id===id);return d?move(data,`${d.accountRef&&!d.done?'mail-purpose':'mail-details'}/${d.id}`):data;
}
export function prepareMailbox(data: Dataset, provider: MailProvider, nextProviders:MailProvider[]=[]): Dataset {
  assertPlanWritable(data);
  const p=mailPlan(data)??mailPlanSchema.parse({version:1,phase:'collect'}),draft=mailDraftSchema.parse({id:crypto.randomUUID(),provider,nextProviders});
  const next=putPlan(data,{...p,phase:'collect',drafts:[...p.drafts,draft]});
  return move({...next,guide:{...next.guide,pendingProvider:provider,draftAccountId:undefined}},`mail-details/${draft.id}`);
}
function withDraft(data:Dataset,provider:MailProvider):Dataset{const d=mailDraft(data);if(d&&d.provider!==provider)throw Error('wrong-mail-provider');return d?data:prepareMailbox(data,provider);}
function bindDraft(data:Dataset,asset:Asset):Dataset{
  const p=mailPlan(data)!,draft=mailDraft(data)!;
  return putPlan({...data,guide:{...data.guide,accountId:asset.id,draftAccountId:asset.id,pendingProvider:draft.provider}},
    {...p,accountRefs:p.accountRefs.includes(asset.id)?p.accountRefs:[...p.accountRefs,asset.id],primaryRef:p.primaryRef??asset.id,
      drafts:p.drafts.map(d=>d.id===draft.id?{...d,accountRef:asset.id}:d)});
}
export function editMailboxDetails(data:Dataset,id:string):Dataset{
  assertPlanWritable(data);const a=data.assets.find(a=>a.id===id&&canBeMailAccount(a));if(!a?.provider||!MAIL_PROVIDERS.includes(a.provider as MailProvider))return data;
  const p=mailPlan(data),draft=p?.drafts.find(d=>d.accountRef===id&&d.done);
  if(draft)return move(data,`mail-details/${draft.id}`);
  const next=prepareMailbox(data,a.provider as MailProvider);return bindDraft(next,a);
}
export function saveMailboxDetails(data: Dataset, provider: MailProvider, values: { address: string; label: string; purpose?:'personal'|'work' }, existingId?: string): Dataset {
  assertPlanWritable(data);
  data=withDraft(data,provider);existingId??=mailDraft(data)?.accountRef;
  const existing = existingId ? data.assets.find(a => a.id === existingId && canBeMailAccount(a) && (!a.provider || a.provider === provider)) : undefined;
  if (existingId && !existing) throw Error('mailbox-not-found');
  if (existing && Object.hasOwn(existing, 'mailboxIdentityV1') && !mailboxIdentity(existing)) throw new DataUpgradeConflict();
  const identity = mailboxIdentitySchema.parse({ ...mailboxIdentity(existing), version: 1,
    address: values.address.trim() || undefined, label: values.label.trim() || undefined });
  const ordinal = data.assets.filter(a => a.provider === provider).length + 1;
  const name = identity.label || (identity.address && identity.address.length <= 80 ? identity.address : existing?.name) || `${PROVIDERS[provider]} ${ordinal}`;
  const editingDone=mailDraft(data)!.done;
  const asset: Asset = { ...(existing ?? makeAsset({ kind: 'account', type: 'Primary email', name, importance: 'critical' })),
    name, provider, ...(existing&&values.purpose?{purpose:values.purpose}:{}), services: [...new Set([...(existing?.services ?? []), 'mail' as const])],
    mailboxIdentityV1: identity, updatedAt: new Date().toISOString() };
  const changed={...data,assets:existing?data.assets.map(a=>a.id===asset.id?asset:a):[...data.assets,asset]};
  const next=bindDraft(changed,asset),draft=mailDraft(next)!;
  return move(next,editingDone?'mail-review':`mail-purpose/${draft.id}`);
}
export function reuseMailboxDetails(data:Dataset,id:string,address:string):Dataset{
  const a=data.assets.find(a=>a.id===id&&canBeMailAccount(a));if(!a)return data;
  const value=address.trim();if(!value)return addListedMailbox(data,id);
  if(Object.hasOwn(a,'mailboxIdentityV1')&&!mailboxIdentity(a))throw new DataUpgradeConflict();
  const parsed=addressSchema.parse(value),previous=mailboxIdentity(a),values=mailboxAddresses(a);
  const identity=mailboxIdentitySchema.parse({...previous,version:1,...(!previous?.address?{address:parsed}:{}),additionalAddresses:previous?.address&&!values.includes(parsed)?[...previous.additionalAddresses,parsed]:previous?.additionalAddresses??[]});
  return addListedMailbox({...data,assets:data.assets.map(v=>v.id===id?{...v,mailboxIdentityV1:identity,updatedAt:new Date().toISOString()}:v)},id);
}
export function addListedMailbox(data: Dataset, id: string): Dataset {
  assertPlanWritable(data);
  const a = data.assets.find(a => a.id === id && canBeMailAccount(a)); if (!a) return data;
  let next:Dataset={...data,assets:data.assets.map(v=>v.id===id?{...v,services:[...new Set([...v.services,'mail' as const])]}:v),guide:{...data.guide,accountId:id,draftAccountId:id}};
  if(!a.provider)return move(next,'provider');
  next=withDraft(next,a.provider as MailProvider);next=bindDraft(next,next.assets.find(v=>v.id===id)!);
  const draft=mailDraft(next)!;next=move(next,`mail-purpose/${draft.id}`);
  return a.purpose?recordMailboxPurpose(next,id,a.purpose):next;
}
export function recordMailboxPurpose(data: Dataset, id: string, purpose: 'personal' | 'work'): Dataset {
  const draft=mailDraft(data);if(!data.guide.cursor.startsWith('mail-purpose/')||draft?.accountRef!==id)return data;
  assertPlanWritable(data);
  const a = data.assets.find(a => a.id === id && canBeMailAccount(a)); if (!a) return data;
  const p=mailPlan(data)!;
  let next=putPlan({...data,assets:data.assets.map(v=>v.id===id?{...v,purpose,updatedAt:new Date().toISOString()}:v)},
    {...p,phase:'collect',drafts:p.drafts.map(d=>d.id===draft.id?{...d,done:true}:d)});
  if(!draft.done&&draft.nextProviders.length){const [provider,...remaining]=draft.nextProviders;return prepareMailbox(next,provider,remaining);}
  return move(next,'mail-review');
}
export function selectAdditionalMailProviders(data: Dataset, providers: MailProvider[]): Dataset {
  assertPlanWritable(data);if(!providers.length)return data;const [first,...remaining]=providers;return prepareMailbox(data,first,remaining);
}
export function setPrimaryMailbox(data: Dataset, id: string): Dataset {
  assertPlanWritable(data); const p = mailPlan(data); return p?.accountRefs.includes(id) ? putPlan(data, { ...p, primaryRef: id }) : data;
}
export function beginMailboxChecks(data: Dataset, id: string, language: Language): Dataset {
  assertPlanWritable(data); const p = mailPlan(data), a = data.assets.find(a => a.id === id && canBeMailAccount(a));
  if (!p?.accountRefs.includes(id) || !a?.provider||!a.purpose) return data;
  const visitedRefs = p.activeRef && p.activeRef !== id ? [...new Set([...p.visitedRefs, p.activeRef])] : p.visitedRefs;
  const planned = putPlan(data, { ...p, activeRef: id, visitedRefs, phase: 'protect' });
  let next = selectAccount(planned, a.provider, language, a.id, a.purpose);
  if(a.purpose==='work'&&data.guide.answers[`${id}:managedAllowed`]!=='yes')return move(next,`managed/${id}`);
  if (a.provider === 'apple' && data.guide.answers[`${id}:platform`]) next = beginRecipe(next, id, 'email-mfa');
  const resume=p.cursors[id];
  return resume&&mailCursorFor(id,resume)?move(next,resume):next;
}
function mailCursorFor(id:string,cursor:string):boolean{
  const parts=cursor.split('/');
  return parts[1]===id&&(parts[0]==='do'||parts[0]==='platform'||parts[0]==='managed'||parts[0]==='recorded'||parts[0]==='auth-location'||parts[0]==='recovery-location'||parts[0].startsWith('authenticator-'));
}
export function resumeMailboxStep(data:Dataset,id:string,cursor:string):Dataset{
  const p=mailPlan(data);if(!p?.accountRefs.includes(id)||!mailCursorFor(id,cursor))return move(data,cursor);
  const a=data.assets.find(a=>a.id===id),target=a?.purpose==='work'&&data.guide.answers[`${id}:managedAllowed`]!=='yes'?`managed/${id}`:cursor;
  return move(putPlan({...data,guide:{...data.guide,accountId:id}},{...p,phase:'protect',activeRef:id,cursors:{...p.cursors,[id]:cursor}}),target);
}
export function trackMailboxCursor(previous:Dataset,next:Dataset):Dataset{
  const p=mailPlan(next),id=p?.activeRef;if(!p||!id||p.phase!=='protect'||previous.guide.accountId!==id)return next;
  const cursors={...p.cursors};
  if(mailCursorFor(id,next.guide.cursor)){
    if(next.guide.cursor!==`managed/${id}`||!cursors[id])cursors[id]=next.guide.cursor;
  }
  else if(next.guide.cursor==='manager-select'){
    if(next.guide.steps[previous.guide.cursor]?.status==='later'&&mailCursorFor(id,previous.guide.cursor))cursors[id]=previous.guide.cursor;
    else delete cursors[id];
  }
  return putPlan(next,{...p,cursors});
}
export function continueAfterMailboxes(data: Dataset): Dataset {
  assertPlanWritable(data); const p = mailPlan(data); if (!p?.primaryRef) return move(data, 'manager-select');
  return move(putPlan({ ...data, guide: { ...data.guide, accountId: p.primaryRef } }, {
    ...p, phase: 'paused', visitedRefs: [...new Set([...p.visitedRefs, ...(p.activeRef ? [p.activeRef] : [])])],
  }), 'manager-select');
}
export function nextMailboxes(data: Dataset): Asset[] {
  const p = mailPlan(data); if (!p) return [];
  return p.accountRefs.filter(id => id !== p.activeRef && !p.visitedRefs.includes(id)).flatMap(id => data.assets.filter(a => a.id === id&&!!a.provider&&!!a.purpose));
}
