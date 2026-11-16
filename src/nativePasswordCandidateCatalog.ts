import { c, type Copy, type GuideStep, type SourceId } from './guideCatalog';
import type { Asset, Dataset } from './models';
import { nativeInstallation, nativeVault } from './nativeManagers';
import { nativeCandidateMethod } from './nativePasswordContext';

export function nativeCandidateSteps(data: Dataset, account: Asset, installationId: string, official: Pick<GuideStep,'place'|'url'>): GuideStep[] {
  const app = nativeInstallation(data, installationId), vault = nativeVault(data, app?.vaultRef); if (!app || !vault) return [];
  const apple = vault.productId === 'apple-passwords', os = data.assets.find(a => a.id === app.deviceRef)?.operatingSystem, ios = os === 'ios', android = os === 'android';
  const source: SourceId = apple ? ios ? 'applePasswordNotesIos' : 'applePasswordNotesMac' : ios ? 'chromePasswordsIos' : android ? 'chromePasswordsAndroid' : 'chromePasswords';
  const place = c(apple ? 'Apple Passwords · your private saved login' : 'Google Password Manager · your private saved login', apple ? 'Apple「パスワード」の自分専用の保存項目' : 'Google パスワード マネージャーの自分専用の保存項目');
  const step = (id: string, title: Copy, action: Copy, expected: Copy, extra: Partial<GuideStep> = {}): GuideStep => ({ id, title, place, action, expected, sources: [source], ...extra });
  const choice = (en: string, ja: string, next: string, record?: false) => ({ label: c(en, ja), next, ...(record === false ? { record } : {}) });
  const method = nativeCandidateMethod(data, account.id, `native-password:${app.id}`), ownAccount = vault.authenticationAccountRef === account.id;
  const paperPlace=c('Your private paper copy','施錠して保管する紙の控え');
  const saved = ios && !apple ? c('Done', '完了') : c('Save', '保存');
  const steps: GuideStep[] = [
    step('candidate-method', c('Where will you keep the new password?', '新しいパスワードを、どこに控えますか？'),
      c('Use a private note inside your password manager, or paper you can lock away. Use paper if this login is shared or you cannot tell who can read it.', 'パスワード管理アプリ内の自分専用のメモか、施錠して保管する紙を使います。共有している項目や、誰が読めるか分からない項目には書かず、紙を選んでください。'),
      c('The candidate will remain available if the change form closes.', '変更画面を閉じても、候補を取り出せること。'), { question:true, rememberChoice: true, choices: [choice('A private note in this saved login', '自分専用の保存項目のメモ', 'candidate-note-open'), choice('Paper I can lock away', '施錠して保管する紙', 'candidate-paper'), choice('I cannot store it privately', '安全に控える場所を用意できない', 'candidate-not-ready', false)] }),
    step('candidate-note-open', c('Open the password list', 'パスワードの一覧を開く'),
      c(apple ? 'Keep the copied candidate. Return from the new-item draft without saving over a working item. In Passwords open All.' : ios || android ? 'Keep the official change form open. In Chrome open More → Settings → Autofill and passwords → Password Manager.' : 'Keep the official change form open. In Chrome open More → Passwords and autofill → Google Password Manager.', apple ? 'コピーした候補を残し、保存済みの項目を上書きせずに新規入力画面から戻ります。「パスワード」の「すべて」を開いてください。' : ios || android ? `公式の変更画面は残し、Chromeのその他アイコン→「設定」→「自動入力とパスワード」→「${android ? 'Google パスワード マネージャー' : 'パスワード マネージャー'}」を開いてください。` : '公式の変更画面は残し、Chromeのその他アイコン→「パスワードと自動入力」→「Google パスワード マネージャー」を開いてください。'),
      c('The original saved login can be selected.', '元の保存項目を選べること。'), { button: c('The list is open', '一覧を開きました') }),
    step('candidate-note-item', c('Select the original private login', '元の、自分専用の保存項目を選ぶ'),
      c('Find this service and username, and open its original saved login. Use the paper option if it is shared or you cannot identify the right item.', '今回のサービス名とユーザー名で、元の保存項目を開いてください。共有している項目や、正しい項目を特定できない場合は、紙の控えへ切り替えます。'),
      c('The correct private item is open.', '今回の、自分だけが使う項目が開いていること。'), { rememberChoice: true, choices: [choice('This is the correct private item', '自分専用の正しい項目を開きました', 'candidate-note-edit'), choice('Use paper instead', '紙に控える', 'candidate-paper')] }),
    step('candidate-note-edit', c('Open the note for editing', '項目のメモ欄を開く'),
      c('Choose Edit and select the Notes field. Leave the password field and any existing note text unchanged.', '「編集」を選び、メモ欄を開いてください。パスワード欄と、すでにあるメモの内容は、そのまま残します。'),
      c('You can add text to the note.', 'メモへ追記できること。'), { button: c('The note is ready to edit', 'メモ欄を開きました') }),
    step('candidate-note-save', c('Save the new password in the note', '新しいパスワードをメモに保存する'),
      c(`Append a clearly labeled pending candidate and the generated value. Preserve existing text. Choose ${saved.en}.`, `既存のメモの末尾に、「変更予定のパスワード」と分かる見出しと、生成した値を追記し、「${saved.ja}」で保存してください。`),
      c('The candidate is saved in the private note.', '自分専用のメモに候補が保存されていること。'), { rememberChoice: true, choices: [choice('I saved the new password in the note', '新しいパスワードをメモに保存しました', 'candidate-check'), choice('The note cannot be saved', 'メモに保存できない', 'candidate-not-ready', false)] }),
    step('candidate-paper', c('Write down the new password', '新しいパスワードを紙に控える'),
      c('Write this service, username, a pending-change label and the generated candidate on paper. Keep it separate from the current password and place it where you can lock it away. Do not photograph it.', '紙に、今回のサービス・ユーザー名、「変更予定のパスワード」と分かる見出し、生成した値を書きます。現在のパスワードと区別し、施錠して保管できる場所へ置いてください。写真には残しません。'),
      c('The paper identifies the candidate and can be kept privately.', 'どのアカウントの変更候補か分かり、他人に見られないよう保管できること。'), { place:paperPlace, rememberChoice: true, choices: [choice('I wrote down the new password', '新しいパスワードを紙に控えました', 'candidate-check'), choice('I cannot keep the paper private', '紙を安全に保管できない', 'candidate-not-ready', false)] }),
    step('candidate-check', c('Retrieve the password you saved', '控えた内容を確認する'),
      c(method === 'paper' ? 'Read the candidate from the paper without relying on an open account or device. Compare it with the generated value while it is still available.' : 'Close the item, reopen the same saved login and read the candidate from its note. Check that it is the generated value.', method === 'paper' ? '開いているアカウントや端末に頼らず、紙から候補を読んでください。生成した値がまだ表示できるうちに、書き間違いがないか照合します。' : '保存項目を一度閉じ、同じ項目を開き直して、メモから候補を取り出してください。生成した値と一致するか確認します。'),
      c('The exact candidate can be retrieved after leaving the draft or change form.', '下書きや変更画面を離れても、同じ候補を取り出せること。'), { place:method==='paper'?paperPlace:place, rememberChoice: true, choices: [choice('I retrieved the new password', '控えたパスワードを取り出せました', ownAccount && method !== 'paper' ? 'independent-candidate' : 'apply'), choice('I cannot retrieve it / it does not match', '取り出せない・一致しない', 'candidate-not-ready', false)] }),
  ];
  if (ownAccount) steps.push(step('independent-candidate', c('Write the new password on paper too', '新しいパスワードを紙にも控える'),
    c(`This account also opens ${apple?'Apple Passwords':'Google Password Manager'}. Write the new password on paper you can lock away and check you can read it without opening this app or account. Keep the current password and recovery information.`, `今回は${apple?'Apple「パスワード」':'Google パスワード マネージャー'}を開くアカウント自体を変更します。変更後に再ログインを求められた時も使えるよう、新しいパスワードを紙にも控え、このアプリやアカウントを開かずに読めるか確認してください。現在のパスワードと復旧用情報も残します。`),
    c('The new candidate remains available if the store asks you to sign in again.', '保管庫で再ログインを求められても、新しい候補を使えること。'), { place:paperPlace, rememberChoice: true, choices: [choice('I can read the copy without the app', 'アプリを開かずに新しいパスワードを読めます', 'apply'), choice('I cannot make an independent copy', '独立した控えを用意できない', 'candidate-not-ready', false)] }));
  steps.push(
    step('candidate-status', c('Has the service accepted the password change?', 'サービス側の変更は、もう済んでいますか？'),
      c('Check the official service’s result. If it has already accepted a change, update the saved login instead of generating another password.', '公式サービスの結果を確認してください。すでに変更が受け付けられている場合は、新しく生成し直さず、保存項目の更新へ進みます。'),
      c('Distinguish an accepted change from an unsubmitted or unknown result.', '変更済みか、まだ確定していないかを区別すること。'), { place:official.place, url:official.url, question:true, rememberChoice: true, choices: [choice('I have not submitted the change', 'まだ変更を確定していない', 'candidate-method'), choice('The service accepted the change', 'サービスに変更が受け付けられた', 'save-new'), choice('I cannot confirm the result', '結果を確認できない', 'candidate-not-ready', false)] }),
    step('accepted-result', c('The password change is already recorded', 'パスワードの変更は記録済みです'),
      c('Continue by updating the saved login with the password accepted by the service. If that record was mistaken, undo it before reviewing the change. Undoing the record does not change the service’s password.', 'サービスが受け付けたパスワードで、保存項目の更新を続けます。完了の記録が誤りだった場合は、取り消してから変更状況を確認できます。記録を取り消しても、サービスのパスワードは変わりません。'),
      c('Keep the accepted result instead of generating another password.', '生成や変更を繰り返さず、受け付けられた結果から続けること。'), { place:official.place, url:official.url, question:true, allowBack:false, rememberChoice:true, choices:[choice('Continue updating the saved login','保存項目の更新を続ける','save-new',false),choice('Undo the mistaken completion record','誤った完了記録を取り消す','candidate-status',false)] }),
    step('candidate-not-ready', c('Keep the change unfinished', '候補を確認できるまで、変更を止める'),
      c('Keep the working account page and current password. Do not submit an unrecorded candidate. Check an existing copy before generating another; if the service may already have accepted a change, check its result first.', '使えるアカウントの画面と、現在のパスワードを残してください。控えのない候補では変更を確定しません。生成し直す前に既存の控えを確認し、すでに変更した可能性がある場合はサービス側の結果を確認します。'),
      c('The password-change result is not recorded as successful.', '確認できるまで、変更の成功を記録しないこと。'), { rememberChoice: true, choices: [choice('Choose where to keep the candidate', '候補の保管方法を選び直す', 'candidate-method', false), choice('Return to generation', '生成画面へ戻る', 'generate', false), choice('Check whether the change was accepted', '変更済みか確認する', 'candidate-status', false)] }),
  );
  return steps;
}
