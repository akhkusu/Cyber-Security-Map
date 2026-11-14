const source=(title:string,url:string,scope:string)=>({title,url,scope,checked:'2026-11-14',reviewMethod:'official-documentation' as const});
export const ENTE_SOURCES={
  enteVersionSource:source('Ente Auth · 設定画面の版表示','https://github.com/ente/ente/blob/9684542adf1881515c49a60685cbf53423223e63/mobile/packages/ui/lib/components/settings/app_version_widget.dart','Settings footer reads the installed PackageInfo version'),
  enteInstall:source('Ente Auth · 正規の配布とWebの入口','https://ente.com/help/auth/faq/installing','Official stores, native desktop versus iOS build, auth.ente.com migration'),
  enteAuth:source('Ente Auth · 正規配布とコード登録','https://ente.com/auth/','Official iOS / Android apps; Auth 4.4.26'),
  enteFaq:source('Ente Auth · 登録・秘密・復旧の区別','https://ente.com/help/auth/faq/','QR / manual setup / current access / recovery'),
  enteOffline:source('Ente Auth · 端末内利用とOSの鍵','https://ente.com/help/auth/features/offline-mode','Offline mode / secure storage / device changes'),
  enteExport:source('Ente Auth · 暗号化書き出しと自動バックアップ','https://ente.com/help/auth/migration/export','Manual encrypted JSON / local backup / import'),
  enteCycle:source('Ente · Accountとメールの循環依存','https://ente.com/help/auth/faq/enteception/','Actual shared Account / email verification / independent recovery'),
  entePasskey:source('Ente Account · パスキーの登録・利用・復旧','https://ente.com/help/photos/features/account/passkeys','Second factor; account password remains separate; .io / .com'),
  enteRecovery:source('Ente Account · 保護・復旧・共有する削除の影響','https://ente.com/help/photos/faq/security-and-privacy','Same Account in Photos / Auth / Locker; separate recovery key'),
  enteMobileSource:source('Ente Auth · 配布版の画面と保存処理','https://github.com/ente/ente/tree/9684542adf1881515c49a60685cbf53423223e63/mobile/apps/auth','4.4.26+1118; Android 7+ / iOS 15+'),
  enteSharedSource:source('Ente · 配布版の共通画面と日英表示','https://github.com/ente/ente/tree/9684542adf1881515c49a60685cbf53423223e63/mobile/packages','Account / recovery / lock / actual translations and English fallback'),
  enteWebSource:source('Ente Accounts · パスキーの画面実装','https://github.com/ente/ente/tree/9684542adf1881515c49a60685cbf53423223e63/web/apps/accounts','Name before Add passkey; service-generated authenticated URL'),
};
