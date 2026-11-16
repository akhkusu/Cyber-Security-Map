import type {Copy,Source} from './guideCatalog';
const c=(en:string,ja:string):Copy=>({en,ja});
export const BITWARDEN_SERVER_SOURCES={
 bwServer:{title:'Bitwarden · Choose My Server',url:'https://bitwarden.com/help/choose-my-server/',checked:'2026-11-14',scope:'US / EU / self-hosted',reviewMethod:'official-documentation'},
 bwAccountMenu:{title:'Bitwarden · Log in to Multiple Accounts',url:'https://bitwarden.com/help/account-switching/',checked:'2026-11-14',scope:'Mobile account menu; official published image inspected',reviewMethod:'official-documentation'},
} satisfies Record<string,Source>;
const mobileAction=c('In the open Bitwarden app, tap the round account icon at the top. Find the selected account and read the server below its email address. Keep the current account signed in.','開いているBitwardenの上部にある丸いアカウントアイコンを押してください。選択中のアカウントを見つけ、そのメールアドレスの下にあるサーバー名を確認します。ログアウトはしません。');
const mobileExpected=c('The server is shown below the account you are checking.','今回確認するアカウントの下に、サーバー名が表示されること。');
export const BITWARDEN_SERVER_SCREENS={
 web:{place:c('Your usual Bitwarden web vault','いつも利用しているBitwardenのWeb画面'),action:c('Open the web vault you normally use for this account. Read the host after https:// and before the next slash in its address bar. Keep this vault open.','このアカウントでいつも利用するWeb画面を開き、アドレスバーのホスト名（「https://」の後から、次の「/」の手前まで）を確認してください。今開いている保管庫は閉じません。'),expected:c('You can read the host of the web vault you normally use.','いつも利用するWeb画面のホスト名が分かること。')},
 ios:{place:c('Bitwarden · iPhone / iPad','Bitwarden · iPhone / iPad'),action:mobileAction,expected:mobileExpected},
 android:{place:c('Bitwarden · Android','Bitwarden · Android'),action:mobileAction,expected:mobileExpected},
 login:{place:c('Bitwarden login screen','Bitwardenのログイン画面'),action:c('Read Server or Logging in on on this account’s login screen. Keep other signed-in accounts open. An Add Account screen’s default does not identify an existing account.','今回のアカウントのログイン画面で「Server」または「Logging in on」を確認してください。別のアカウントを開いている場合は残します。「Add Account」で新しく開いた画面の初期値では、利用中のアカウントを判断できません。'),expected:c('The selected server belongs to the account you intend to sign in to.','今回ログインするアカウントに合うサーバーが選ばれていること。')},
};
