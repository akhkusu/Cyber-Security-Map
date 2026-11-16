import { c, type Copy } from './guideCatalog';

export type PrivateBrowser = 'safari' | 'chrome' | 'firefox' | 'edge';
export type SafariLayout = 'more' | 'tabs' | 'ipad';
export type BrowserOperation = { key: string; title: Copy; action: Copy; expected: Copy; button: Copy; sources: string[] };
export const privateBrowserChoices = (os?: string): PrivateBrowser[] => ['ios', 'macos'].includes(os ?? '') ? ['safari', 'chrome', 'firefox', 'edge'] : os === 'ubuntu' ? ['chrome', 'firefox'] : ['android', 'windows'].includes(os ?? '') ? ['chrome', 'firefox', 'edge'] : [];

/** Only confirmed menus are included. Calling UIs must handle other layouts. */
export function privateBrowserOperations(browser: PrivateBrowser, os?: string, layout?: SafariLayout): BrowserOperation[] | undefined {
  if (!privateBrowserChoices(os).includes(browser)) return;
  const mobile = os === 'ios' || os === 'android';
  const operations: BrowserOperation[] = [];
  const add = (key: string, title: Copy, action: Copy, expected: Copy, button: Copy, sources: string[]) => operations.push({ key, title, action, expected, button, sources });
  const menu = (label: Copy, sources: string[]) => add('menu', c('Open the browser menu', 'ブラウザーのメニューを開く'), c(`In ${browser === 'safari' ? 'Safari' : browser === 'chrome' ? 'Chrome' : browser === 'firefox' ? 'Firefox' : 'Edge'}, open ${label.en}. Keep this guide and all working sessions open.`, `${browser === 'safari' ? 'Safari' : browser === 'chrome' ? 'Chrome' : browser === 'firefox' ? 'Firefox' : 'Edge'}の${label.ja}を開きます。このガイドと、使えるログインは残してください。`), c('The browser menu is visible.', 'ブラウザーのメニューが表示されること。'), c('The menu is open', 'メニューを開きました'), sources);
  const newTab = (label: Copy, sources: string[]) => add('new', c('Open the private tab or window', 'プライベートのタブ・ウインドウを開く'), c(`Choose ${label.en}. Keep existing tabs; opening another private tab may share a login with existing private tabs.`, `${label.ja}を選びます。既存のタブは残してください。プライベート画面でも、開いている別のプライベート画面とログインを共有する場合があります。`), c('The private tab or window is open.', 'プライベートのタブかウインドウが開くこと。'), c('The private screen is open', 'プライベート画面を開きました'), sources);
  if (browser === 'safari') {
    if (os === 'macos') { menu(c('the File menu in the menu bar', 'メニューバーの「ファイル」'), ['privateSafariMac']); newTab(c('New Private Window', '「新規プライベートウインドウ」'), ['privateSafariMac']); }
    else if (layout === 'more') { menu(c('the More button', '「詳細」ボタン'), ['privateSafariPhone']); newTab(c('New Private Tab', '「新規プライベートタブ」'), ['privateSafariPhone']); }
    else if (layout === 'ipad') { add('menu', c('Open the iPad tab menu', 'iPadのタブのメニューを開く'), c('In Safari on the iPad, touch and hold the Tabs button. Keep existing tabs.', 'iPadのSafariで、タブのボタンを長押しします。既存のタブは残してください。'), c('The tab options menu is visible.', 'タブの操作メニューが表示されること。'), c('The tab menu is open', 'タブのメニューを開きました'), ['privateSafariPad']); newTab(c('New Private Tab', '「新規プライベートタブ」'), ['privateSafariPad']); }
    else if (layout === 'tabs') {
      add('tabs', c('Open Safari’s tab view', 'Safariのタブ一覧を開く'), c('Tap Safari’s Tabs button. Keep the guide and existing tabs.', 'Safariのタブのボタンをタップします。このガイドと既存のタブは残してください。'), c('The tab groups are visible.', 'タブグループが表示されること。'), c('The tab view is open', 'タブ一覧を開きました'), ['privateSafariPhone']);
      add('private', c('Choose the Private tab group', '「プライベート」のタブグループを選ぶ'), c('Swipe the tab groups to Private and select it.', 'タブグループを横にスワイプし、「プライベート」を選びます。'), c('The private tab group is selected.', 'プライベートのタブグループが選ばれること。'), c('I selected Private', '「プライベート」を選びました'), ['privateSafariPhone']);
      newTab(c('the plus (+) button in Private', 'プライベートの「＋」ボタン'), ['privateBrowserShortcuts']);
    } else return;
  } else if (browser === 'chrome') {
    const source = os === 'ios' ? 'privateChromeIOS' : os === 'android' ? 'privateChromeAndroid' : 'privateChromeDesktop';
    menu(c('More (the three dots)', '「その他」（3点）のメニュー'), [source]);
    newTab(os === 'ios' ? c('New Incognito Tab', '「新しいシークレットタブ」') : os === 'android' ? c('Open in a new Incognito window (New Incognito window on some tablets)', '「新しいシークレットウィンドウで開く」（タブレットでは「新しいシークレットウィンドウ」の場合があります）') : c('New Incognito window', '「新しいシークレット ウインドウ」'), [source]);
  } else if (browser === 'firefox' && !mobile) {
    menu(c('the menu button (three lines)', 'メニューボタン（3本線）'), ['privateFirefoxDesktop']); newTab(c('New private window', '「新しいプライベートウィンドウ」'), ['privateFirefoxDesktop']);
  } else if (browser === 'edge' && !mobile) {
    if (os === 'macos') add('new', c('Open an InPrivate window', 'InPrivateウインドウを開く'), c('With Edge active, press Shift + Command + N together. Keep existing windows.', 'Edgeを選んだ状態で、Shift・Command・Nを同時に押します。既存のウインドウは残してください。'), c('An InPrivate window opens.', 'InPrivateのウインドウが開くこと。'), c('The InPrivate window is open', 'InPrivateウインドウを開きました'), ['privateBrowserShortcuts']);
    else { menu(c('Settings and more (three dots)', '「設定など」（3点）のメニュー'), ['privateEdgeDesktop']); newTab(c('New InPrivate window', '「新しい InPrivate ウィンドウ」'), ['privateEdgeDesktop']); }
  } else {
    const source = browser === 'edge' ? 'privateBrowserShortcuts' : os === 'ios' ? 'privateFirefoxIOS' : 'privateFirefoxAndroid';
    add('tabs', c('Open the browser’s tab view', 'ブラウザーのタブ一覧を開く'), browser === 'firefox' ? c(os === 'ios' ? 'Tap the numeric Tabs icon at the bottom of Firefox.' : 'Tap the numeric Tabs icon next to Firefox’s address bar.', os === 'ios' ? 'Firefoxの画面下にある、数字のタブアイコンをタップします。' : 'Firefoxのアドレスバーの隣にある、数字のタブアイコンをタップします。') : c('In Edge, tap Tabs.', 'Edgeの「タブ」をタップします。'), c('The tab view is visible.', 'タブ一覧が表示されること。'), c('The tab view is open', 'タブ一覧を開きました'), [source]);
    add('private', c('Select the private tab group', 'プライベートのタブグループを選ぶ'), browser === 'edge' ? c('Select InPrivate in the tab view.', 'タブ一覧の「InPrivate」を選びます。') : os === 'ios' ? c('Tap Private near the top or bottom center of the tab view.', 'タブ一覧の上部か下部の中央にある「プライベート」をタップします。') : c('Tap the mask icon in the tab view.', 'タブ一覧のマスクのアイコンをタップします。'), c('Private tabs are selected.', 'プライベートのタブが選ばれること。'), c('I selected private tabs', 'プライベートのタブを選びました'), [source]);
    newTab(browser === 'edge' && os === 'android' ? c('Open a new private tab', '「新しいプライベート タブを開く」') : c('the plus (+) button', '「＋」ボタン'), [source]);
  }
  return operations;
}
