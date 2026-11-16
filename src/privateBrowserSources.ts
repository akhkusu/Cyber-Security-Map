const source = (title: string, url: string, scope: string, reviewMethod: 'official-documentation' | 'official-search-excerpt' = 'official-documentation') => ({ title, url, scope, checked: '2026-11-14', reviewMethod });
export const PRIVATE_BROWSER_SOURCES = {
  privateSafariPhone: source('Apple · iPhoneのプライベートブラウズ', 'https://support.apple.com/ja-jp/105030', 'Current More / New Private Tab; iOS 17 and earlier Tabs layout'),
  privateSafariPad: source('Apple · iPadのプライベートブラウズ', 'https://support.apple.com/ja-jp/111769', 'Hold Tabs, then New Private Tab; official search excerpt', 'official-search-excerpt'),
  privateSafariMac: source('Apple · MacのSafariの別ウインドウ', 'https://support.apple.com/ja-jp/102564', 'File / New Private Window; preserve working sessions; official search excerpt', 'official-search-excerpt'),
  privateChromeIOS: source('Google · iPhone / iPadのシークレット画面', 'https://support.google.com/chrome/answer/95464?co=GENIE.Platform%3DiOS&hl=ja', 'More / New Incognito Tab; private tabs share the private session'),
  privateChromeAndroid: source('Google · Androidのシークレット画面', 'https://support.google.com/chrome/answer/95464?co=GENIE.Platform%3DAndroid&hl=ja', 'Current Open in a new Incognito window / tablet New Incognito window'),
  privateChromeDesktop: source('Google · パソコンのシークレット画面', 'https://support.google.com/chrome/answer/95464?co=GENIE.Platform%3DDesktop&hl=ja', 'More / New Incognito window; Windows / Mac / Linux'),
  privateFirefoxIOS: source('Mozilla · iOSのプライベートタブ', 'https://support.mozilla.org/ja/kb/private-browsing-firefox-ios', 'Numeric tabs / Private / plus; private tabs may close on leaving the app'),
  privateFirefoxKeepTabs: source('Mozilla · iOSのプライベートタブの自動終了', 'https://support.mozilla.org/ja/kb/automatically-close-private-tabs-when-leaving-priv', 'Menu / Settings / Privacy / Close Private Tabs / Done; optional change, keep existing off state'),
  privateFirefoxAndroid: source('Mozilla · Androidのプライベートタブ', 'https://support.mozilla.org/ja/kb/private-browsing-firefox-android', 'Numeric tabs / mask / plus; no account changes'),
  privateFirefoxDesktop: source('Mozilla · パソコンのプライベート画面', 'https://support.mozilla.org/en-US/kb/private-browsing-use-firefox-without-history', 'Menu / New private window; private session is separate from ordinary cookies'),
  privateEdgeDesktop: source('Microsoft · WindowsのInPrivate', 'https://support.microsoft.com/ja-jp/edge/browse-inprivate-in-microsoft-edge', 'Settings and more / New InPrivate window'),
  privateBrowserShortcuts: source('Microsoft · OSごとのプライベート画面', 'https://support.microsoft.com/ja-jp/accounts-billing/manage/avoid-staying-signed-in-on-a-public-computer', 'Mac shortcuts; iOS / Android Edge Tabs / InPrivate / new tab; Safari older Tabs / Private / plus'),
};
