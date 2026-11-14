import type { Asset } from './models';
import { c, deviceRecipe, type Copy } from './guideCatalog';
import type { PhoneStep } from './phoneCatalog';
import type { PhoneWorkflow } from './phoneSchemas';

/** Retaining a physical phone does not prove an independent account recovery route. */
export function retainedPhoneSteps(old: Asset, workflow: PhoneWorkflow): PhoneStep[] {
  const fate = workflow.answers['old-fate'], spare = fate === 'spare';
  const place = c(`Previous phone · ${old.name}`, `これまでのスマホ · ${old.name}`);
  const action = (id: string, title: Copy, instruction: Copy, expected: Copy, requires: string[] = []): PhoneStep => ({
    id, kind: 'action', title, place, action: instruction, expected, refs: [old.id], sources: [], requires,
    variant: fate, button: c('I checked this', '確認しました'),
  });
  if (fate === 'undecided') return [action('keep-undecided', c('Keep the phone while you decide', '決めるまでは旧端末を手元に残す'),
    c('Keep the phone and its existing protection. Do not erase it, sign out, or delete synced items while you decide. You can return to the previous question later.', '旧端末と今の保護を維持してください。用途を決めるまでは、消去・サインアウト・同期データの削除を行いません。後で前の質問に戻り、用途を選べます。'),
    c('You are keeping the phone for now. Its availability and role have not been changed.', '今は旧端末を保持すること。利用できる状態や予備の役割を確認済みにはしません。'))];
  if (workflow.answers.availability !== 'available') return [{
    id: 'keep-unavailable', kind: 'blocked', title: c('Check the old phone before counting it as usable', '使える予備にする前に、旧端末の状態を確認する'), refs: [old.id], sources: [],
    text: c('A broken or locked phone cannot yet be counted as a working spare. Keep the task unfinished. If it becomes usable, return to the availability question and confirm its current state. Do not erase it to match this guide.', '故障・ロックなどで使えない端末は、まだ利用可能な予備にはできません。未完了で残してください。使えるようになったら、旧端末を操作できるかの質問へ戻って現在の状態を確認します。案内に合わせるための初期化は不要です。'),
  }];
  const steps: PhoneStep[] = [];
  for (const s of deviceRecipe(old.operatingSystem ?? 'ios').steps.filter(s => ['lock', 'update-open', 'update-install'].includes(s.id))) {
    const id = `keep-${s.id}`;
    steps.push({ ...action(id, s.title, s.action, s.expected, s.id === 'update-install' ? ['keep-update-open', 'old-backup-check'] : []),
      variant: undefined, sources: s.sources, button: s.button, ...(s.control ? { control: { targetRef: old.id, id: s.control } } : {}),
    });
  }
  const use = action(spare ? 'keep-spare-use' : 'keep-old', c('Try the old phone on its own', '旧端末だけで使えるか確認する'),
    c('Without using the new phone, try one function you will keep on the old one. For backup sign-in, sign in to the real service with the existing app or saved login. Connect to Wi-Fi if needed. Seeing an app icon or a code alone is not enough.', '新端末を使わず、旧端末に残す用途を一つ試してください。予備のログイン用なら、今あるアプリや保存情報で正規サービスにログインします。通信が必要ならWi-Fiに接続します。コードやアイコンが見えるだけでは完了にしません。'),
    c('The function you intend to keep works without using the new phone.', '新端末を使わず、旧端末で残す用途が使えること。'), ['keep-lock', 'keep-update-install']);
  use.setupHelp = { title: c('If SMS or the app no longer works here', 'SMSが届かない・アプリが使えない場合'), action: c('Moving the SIM to the new phone does not keep SMS available on both phones. Some apps also require their own secondary-device setup. Keep this check unfinished if the function does not work. Keep working authentication methods and do not delete synced entries to tidy this phone.', '回線を新端末へ移すと、旧端末では同じ番号のSMSを受け取れない場合があります。アプリによってはサブ端末用の設定も必要です。目的の操作ができなければ、この確認は未完了で残してください。使える認証方法を残し、整理のために同期データを削除しないでください。') };
  use.button = c('It worked', '使えました');
  use.sources = ['appleSale', 'googleAuth']; steps.push(use);
  if (spare) {
    const store = action('keep-old', c('Store the spare where you can retrieve it', '必要なときに取り出せる場所へ保管する'),
    c('Lock the phone and keep it where others cannot use it and you can retrieve it. Avoid carrying both phones in the same bag if this spare is for losing your main phone. Two phones using the same cloud account still share that account’s failure. Before relying on the spare again, check power, updates, connectivity and the actual function.', '旧端末をロックし、他人が使えず、自分は必要なときに取り出せる場所へ保管してください。主端末の紛失に備えるなら、2台を同じバッグに入れないようにします。同じクラウドに頼る2台は、そのアカウントを失うと両方に影響します。次に頼るときも、電源・更新・通信と実際の用途を確認してください。'),
    c('The spare is locked and stored where you can retrieve it.', 'ロックした予備を、必要なときに取り出せる場所へ保管したこと。'), ['keep-spare-use']);
    store.button = c('I stored the spare', '保管しました'); steps.push(store);
  }
  return steps;
}
