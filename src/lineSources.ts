import type { Source } from './guideCatalog';
const source = (title: string, url: string, scope: string): Source => ({ title, url, scope, checked: '2026-11-14', reviewMethod: 'official-documentation' });
export const LINE_SOURCES: Record<string, Source> = {
  lineICloud: { ...source('Apple · iPhoneのiCloud Drive', 'https://support.apple.com/guide/iphone/set-up-icloud-drive-iphbbcf8827d/ios', 'Official indexed English/Japanese text: Settings / name / iCloud / Drive / Sync this iPhone; full request429'), reviewMethod: 'official-search-excerpt' },
  lineQrGuide: { ...source('LINE · QR引き継ぎの復元・スキップ', 'https://guide.line.me/ja/account-and-settings/account-transfer.html', 'Official indexed text: same-OS backup restore versus QR last 14 days; Skip may still carry recent chats'), reviewMethod: 'official-search-excerpt' },
  lineAndroid: source('LINE · Android間の引き継ぎ', 'https://help2.line.me/line/smartphone?contentId=200002101&lang=ja', 'Cloud account / backup date and size / Skip differs by actual method'),
  lineAccount: source('LINE · パスワードとメールの確認', 'https://help2.line.me/line/smartphone?contentId=20000060&lang=ja', 'Existing main account / password not displayed / registered email / 24-hour restrictions'),
  lineNumber: source('LINE · 電話番号の確認と変更', 'https://help2.line.me/line/smartphone?contentId=20000120&lang=ja', 'Existing main account / 24-hour change restriction / SMS or call'),
  lineQr: source('LINE · かんたん引き継ぎQRコード', 'https://help.line.me/line/smartphone?contentId=20023519&lang=ja', 'Both main phones available / QR / old session ends'),
  lineBackup: source('LINE · 標準バックアップ', 'https://help.line.me/line/smartphone?contentId=20023473&lang=ja', 'Same OS / text / iCloud Drive or Google Drive'),
  linePin: source('LINE · バックアップ用PIN', 'https://help.line.me/line/smartphone?contentId=20020033&lang=ja', 'Six-digit backup PIN / last 14 days / main device'),
  lineData: source('LINE · 移行できるデータ', 'https://help2.line.me/line/smartphone?contentId=20000100&lang=ja', 'OS / text and media / paid items differ'),
  linePremium: source('LINE · プレミアムバックアップ', 'https://help.line.me/line/smartphone?contentId=200000425&lang=ja', 'Initial backup / exclusions / password reset deletes backup'),
  lineRestore: source('LINE · バックアップしたトークの復元', 'https://help.line.me/line/smartphone/?contentId=20007389', 'iOS during transfer / Android Settings / English full text'),
  lineDevices: source('LINE · Main and sub devices', 'https://help.line.me/line/smartphone/?contentId=20000132', 'iPhone main only / Android sub restrictions / English full text'),
  linePrepare: source('LINE · 引き継ぎ前の準備', 'https://help.line.me/line/smartphone?contentId=20023724&lang=ja', 'Existing account / app versions / data preparation'),
  lineEnvironment: source('LINE · 利用環境', 'https://help2.line.me/line/smartphone?contentId=10002433&lang=ja', 'Current recommended iOS18+ / Android11+; old usable editions differ'),
  lineMethods: source('LINE · 引き継ぎ方法と例外', 'https://help2.line.me/line/smartphone?contentId=20000098&lang=ja', 'QR / passkey / number / linked providers; not all routes implemented'),
};
