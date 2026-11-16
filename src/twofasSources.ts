const source=(title:string,url:string,scope:string)=>({title,url,scope,checked:'2026-11-14',reviewMethod:'official-documentation' as const});
export const TWOFAS_SOURCES={
  twofasTutorial:source('2FAS Auth · 操作とPIN','https://2fas.com/support/2fas-auth-mobile-app/2fas-auth-app-tutorial/','2FAS Auth / iOS・Android / TOTP'),
  twofasIcloud:source('2FAS Auth · iCloud同期','https://2fas.com/support/2fas-auth-mobile-app/how-does-icloud-synchronization-work/','iOS / actual Apple Account / additional password'),
  twofasDrive:source('2FAS Auth · Google Drive同期','https://2fas.com/support/2fas-auth-mobile-app/how-does-google-drive-synchronization-work/','Android / actual Google Account / additional password'),
  twofasTransfer:source('2FAS Auth · iOSとAndroid間の移行','https://2fas.com/support/2fas-auth-mobile-app/i-want-to-move-copy-transfer-tokens-codes-between-ios-and-android/','Password-protected .2fas file / import'),
  twofasLost:source('2FAS Auth · コードを失った場合','https://2fas.com/support/2fas-auth-mobile-app/i-have-lost-all-of-my-tokens-codes/','Existing backup or service-specific recovery'),
  twofasAndroid:source('2FAS Auth · Android配布版の操作実装','https://github.com/twofas/2fas-android/tree/bd3180cf94da4d2bf38a9689eaf2edb33a45aa2c','6.1.0 / Android 9+ / actual screen and resource references'),
  twofasIos:source('2FAS Auth · iOS配布版の操作実装','https://github.com/twofas/2fas-ios/tree/2079179093937cfc1681a2de89c35b4ab0c7bce1','6.0.3 / iOS・iPadOS 18.6+ / actual screen and resource references'),
};
