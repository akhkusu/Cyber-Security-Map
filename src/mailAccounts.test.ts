import { describe, expect, it } from 'vitest';
import { createEncryptedVault, decryptVault } from './crypto';
import { completeStep, deferStep, helpPrompt, move, taskCursor } from './guideEngine';
import { DataUpgradeConflict, datasetSchema, newDataset, type Dataset } from './models';
import { removeEntry } from './removeEntry';
import { addListedMailbox, beginMailboxChecks, continueAfterMailboxes, mailboxAddress, mailboxIdentity,
  mailPlan, matchingMailboxes, nextMailboxes, prepareMailbox, recordMailboxPurpose, saveMailboxDetails,
  selectAdditionalMailProviders, setPrimaryMailbox, trackMailboxCursor, resumeMailboxStep,reuseMailboxDetails,mailboxAddresses,mailDraft,editMailboxDetails,resumeMailDraft } from './mailAccounts';

function add(data: Dataset, address: string, purpose: 'personal' | 'work' = 'personal', provider: 'google' | 'apple' | 'proton' = 'google') {
  let next = saveMailboxDetails(prepareMailbox(data, provider), provider, { address, label: '' });
  return recordMailboxPurpose(next, next.guide.draftAccountId!, purpose);
}
describe('mail identities and the main email', () => {
  it('keeps separate personal and work mailboxes from the same provider, with an explicit primary', () => {
    let d = add(newDataset('ja'), 'personal@example.com'); const primary = mailPlan(d)!.primaryRef!;
    d = add(d, 'work@example.com', 'work'); const p = mailPlan(d)!;
    expect(d.assets).toHaveLength(2); expect(new Set(p.accountRefs).size).toBe(2); expect(p.primaryRef).toBe(primary);
    expect(d.assets.map(a => a.purpose)).toEqual(['personal', 'work']); expect(d.actions).toEqual([]);
    expect(d.assets.every(a => a.controls.mfa === 'unknown' && a.controls.recovery === 'unknown')).toBe(true);
    const second = p.accountRefs[1], changed = setPrimaryMailbox(d, second);
    expect(mailPlan(changed)!.primaryRef).toBe(second); expect(changed.assets).toEqual(d.assets);
  });
  it('accepts a name without an address and stores a long address without truncating its identity', () => {
    let d = saveMailboxDetails(prepareMailbox(newDataset('ja'), 'apple'), 'apple', { address: '', label: '家族と使うメール' });
    expect(d.assets[0].name).toBe('家族と使うメール'); expect(mailboxAddress(d.assets[0])).toBe('');
    const address = 'long-'.repeat(15) + '@example.com'; d = add(d, address);
    const a = d.assets[1]; expect(a.name.length).toBeLessThanOrEqual(80); expect(mailboxAddress(a)).toBe(address);
    expect(datasetSchema.safeParse(d).success).toBe(true);
  });
  it('suggests only the exact mailbox and provider, without merging aliases or creating work records', () => {
    const d = add(newDataset('ja'), 'user+work@Example.com');
    expect(matchingMailboxes(d, 'google', 'user+work@example.COM').map(a => a.id)).toEqual([d.assets[0].id]);
    for (const address of ['user@example.com', 'user.work@example.com', 'USER+work@example.com']) expect(matchingMailboxes(d, 'google', address)).toEqual([]);
    expect(matchingMailboxes(d, 'apple', 'user+work@example.com')).toEqual([]); expect(d.assets).toHaveLength(1);
    const duplicate = add(d, 'user+work@example.com', 'work'); expect(duplicate.assets).toHaveLength(2);
  });
  it('reuses an explicitly selected account and keeps its controls, IDs, metadata and action history', () => {
    let d = add(newDataset('ja'), 'saved@example.com'), a = d.assets[0];
    a.controls.mfa = 'verified'; a.controlEvidence.mfa = 'user-confirmed'; a.legacyOpaque = { keep: true };
    d.actions.push({ id: 'old-action', targetId: a.id, status: 'completed' }); const before = structuredClone(d.assets[0]);
    const reused = addListedMailbox(move(d, 'start'), a.id);
    expect(reused.assets).toHaveLength(1); expect({ ...reused.assets[0], updatedAt: before.updatedAt }).toEqual(before); expect(reused.actions).toEqual(d.actions);
    expect(mailPlan(reused)!.accountRefs).toEqual([a.id]);
  });
  it('adds a second address to the same real login only after explicit reuse and shares the existing security work',()=>{
    let d=add(newDataset('ja'),'main@example.com'),a=d.assets[0];a.controls.mfa='verified';a.controlEvidence.mfa='user-confirmed';
    d=reuseMailboxDetails(d,a.id,'alias@example.com');expect(d.assets).toHaveLength(1);expect(mailPlan(d)!.accountRefs).toEqual([a.id]);expect(mailboxAddresses(d.assets[0])).toEqual(['main@example.com','alias@example.com']);expect(d.assets[0].controls.mfa).toBe('verified');
    expect(matchingMailboxes(d,'google','alias@example.com').map(a=>a.id)).toEqual([a.id]);expect(d.actions).toEqual([]);
  });
  it('asks each selected service for its own details and purpose before moving to the next', () => {
    let d = add(newDataset('ja'), 'main@example.com');
    d = selectAdditionalMailProviders(d, ['apple', 'proton']); expect(d.guide.pendingProvider).toBe('apple');
    expect(d.assets).toHaveLength(1); d = saveMailboxDetails(d, 'apple', { address: 'second@example.com', label: 'iCloud' });
    const id = d.guide.draftAccountId!; expect(d.guide.cursor).toMatch(/^mail-purpose\//);
    d = recordMailboxPurpose(d, id, 'personal'); expect(d.guide.pendingProvider).toBe('proton'); expect(d.guide.cursor).toMatch(/^mail-details\//);
    expect(recordMailboxPurpose(d, id, 'personal')).toBe(d);
    d = saveMailboxDetails(d, 'proton', { address: 'third@example.com', label: 'Proton' }); d = recordMailboxPurpose(d, d.guide.draftAccountId!, 'work');
    expect(d.guide.cursor).toBe('mail-review'); expect(mailPlan(d)!.accountRefs).toHaveLength(3);
  });
  it('binds Back and editing to the original email while another provider is still being added',()=>{
    let d=add(newDataset('ja'),'main@example.com');const primary=mailPlan(d)!.primaryRef!;
    d=selectAdditionalMailProviders(d,['google','proton']);d=saveMailboxDetails(d,'google',{address:'second@example.com',label:'Second'});const second=d.guide.draftAccountId!,secondDraft=mailDraft(d)!;
    d=recordMailboxPurpose(d,second,'personal');const pending=mailDraft(d)!;expect(pending.provider).toBe('proton');
    d=recordMailboxPurpose(move(d,`mail-purpose/${secondDraft.id}`),second,'work');expect(d.assets.find(a=>a.id===second)!.purpose).toBe('work');expect(mailPlan(d)!.drafts.find(v=>v.id===pending.id)!.done).toBe(false);
    d=editMailboxDetails(d,primary);expect(mailDraft(d)!.accountRef).toBe(primary);d=saveMailboxDetails(d,'google',{address:'main@example.com',label:'Renamed'});expect(d.guide.cursor).toBe('mail-review');expect(d.assets).toHaveLength(2);
    d=resumeMailDraft(d,pending.id);expect(mailDraft(d)!.provider).toBe('proton');expect(mailDraft(d)!.accountRef).toBeUndefined();expect(mailPlan(d)!.primaryRef).toBe(primary);
  });
  it('resumes a deferred email at the same step after working on another one, without changing the main email', () => {
    let d = add(newDataset('ja'), 'main@example.com'); d = add(d, 'other@example.com'); const p = mailPlan(d)!;
    d = beginMailboxChecks(d, p.primaryRef!, 'ja'); const first = d;
    d = trackMailboxCursor(first, completeStep(first)); const cursor = d.guide.cursor;
    d = trackMailboxCursor(d, deferStep(d)); expect(nextMailboxes(d).map(a => a.id)).toEqual([p.accountRefs[1]]);
    d = beginMailboxChecks(d, p.accountRefs[1], 'ja'); d = resumeMailboxStep(d, p.primaryRef!, cursor);
    expect(d.guide.accountId).toBe(p.primaryRef); expect(mailPlan(d)!.activeRef).toBe(p.primaryRef);
    expect(d.guide.cursor).toBe(cursor); expect(mailPlan(d)!.primaryRef).toBe(p.primaryRef); expect(d.assets[0].controls.mfa).toBe('unknown');
    const next = continueAfterMailboxes(d); expect(next.guide.accountId).toBe(p.primaryRef); expect(mailPlan(next)!.phase).toBe('paused');
  });
  it('resumes the contact identity question after switching between mailboxes',()=>{
    let d=add(newDataset('ja'),'main@example.com');d=add(d,'backup@example.com');const p=mailPlan(d)!,id=p.primaryRef!,cursor=`recovery-email-link/${id}`;
    d=beginMailboxChecks(d,id,'ja');d=trackMailboxCursor(d,move(d,cursor));d=beginMailboxChecks(d,p.accountRefs[1],'ja');d=beginMailboxChecks(d,id,'ja');expect(d.guide.cursor).toBe(cursor);expect(d.guide.accountId).toBe(id);expect(mailPlan(d)!.primaryRef).toBe(id);expect(d.assets[0].controls.mfa).toBe('unknown');
  });
  it('keeps work/school permission checks and prevents removal of a queued email record', () => {
    const d = add(newDataset('ja'), 'work@example.com', 'work'), p = mailPlan(d)!;
    const next = beginMailboxChecks(d, p.primaryRef!, 'ja'); expect(next.guide.cursor).toBe(`managed/${p.primaryRef}`);
    expect(removeEntry(next, p.primaryRef!)).toBeUndefined();
  });
  it('rechecks work permission after a purpose change, then restores the saved step instead of restarting',()=>{
    for(const provider of ['google','apple'] as const){
      let d=add(newDataset('ja'),'main@example.com','personal',provider);const id=mailPlan(d)!.primaryRef!;
      d.guide.answers[`${id}:platform`]='ios';d=beginMailboxChecks(d,id,'ja');d=trackMailboxCursor(d,completeStep(d));const cursor=d.guide.cursor;
      d=editMailboxDetails(d,id);d=saveMailboxDetails(d,provider,{address:'main@example.com',label:'Main',purpose:'work'},id);
      d=trackMailboxCursor(d,beginMailboxChecks(d,id,'ja'));expect(d.guide.cursor).toBe(`managed/${id}`);expect(mailPlan(d)!.cursors[id]).toBe(cursor);
      d=trackMailboxCursor(d,resumeMailboxStep(d,id,cursor));expect(d.guide.cursor).toBe(`managed/${id}`);expect(mailPlan(d)!.cursors[id]).toBe(cursor);
      d.guide.answers[`${id}:managedAllowed`]='yes';d=beginMailboxChecks(d,id,'ja');expect(d.guide.cursor).toBe(cursor);
    }
  });
  it('preserves unknown namespaces and refuses to overwrite incompatible identity data', () => {
    const original = newDataset('ja'); original.guide.mailAccountsV1 = { version: 8, foreign: { preserve: true } };
    const before = structuredClone(original); expect(() => prepareMailbox(original, 'google')).toThrow(DataUpgradeConflict); expect(original).toEqual(before);
    const d = add(newDataset('ja'), 'saved@example.com'); d.assets[0].mailboxIdentityV1 = { foreign: true };
    expect(() => saveMailboxDetails(d, 'google', { address: 'saved@example.com', label: '' }, d.assets[0].id)).toThrow(DataUpgradeConflict);
    expect(datasetSchema.parse(d).assets[0].mailboxIdentityV1).toEqual({ foreign: true });
  });
  it('round-trips addresses, queued services, the current step and opaque metadata in the existing encrypted backup', async () => {
    let d = add(newDataset('ja'), 'private@example.com'); d = selectAdditionalMailProviders(d, ['apple', 'proton']);
    d.guide.externalLegacy = { keep: true }; d.assets[0].mailboxIdentityV1 = { ...mailboxIdentity(d.assets[0]), foreign: { keep: true } };
    const saved = await createEncryptedVault('test only app storage passphrase', d), raw = JSON.stringify(saved.envelope);
    expect(raw).not.toContain('private@example.com'); expect(saved.envelope.format).toBe('personal-cyber-os-v1');
    const restored = (await decryptVault(saved.envelope, 'test only app storage passphrase')).data;
    expect(restored.guide).toEqual(d.guide); expect(restored.assets).toEqual(d.assets); expect(mailDraft(restored)!.nextProviders).toEqual(['proton']);
  });
  it('excludes optional addresses, labels and unknown identity metadata from AI help', () => {
    let d = add(newDataset('ja'), 'private@example.com'); const a = d.assets[0]; a.name = 'PRIVATE LABEL';
    a.mailboxIdentityV1 = { ...mailboxIdentity(a), privateNote: 'PRIVATE NOTE' }; d = beginMailboxChecks(d, a.id, 'ja');
    d = move(d, taskCursor(a.id, 'email-mfa', 'ready'));
    for (const language of ['ja', 'en'] as const) { const prompt = helpPrompt(d, language === 'ja' ? '画面が違う' : 'The screen differs', language); expect(prompt).not.toContain('private@example.com'); expect(prompt).not.toContain('PRIVATE'); }
  });
});
