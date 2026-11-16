# 別のログイン画面を一操作ずつ開く

確認日: 2026-11-14。これは[全体仕様](PRODUCT-SPEC.md)の「現在の利用手段を残して実際に設定・利用を確認する」を具体化する共通契約。最初の接続先は、[Enteの新しいAccount確認と変更後のパスワード確認](ENTE-AUTH-GUIDE.md#83-ログイン画面の表示順序を一操作ずつ扱う)。他のガイドにも順次適用し、全サービスの別画面の案内を置き換え済みとは扱わない。

## 1. 利用者が行うこと

1. 必要になった時だけ、その実端末で使うブラウザーを選ぶ。すでに別の未ログイン画面を用意している人は、そのまま使える。
2. ブラウザーを開き、メニューやタブグループを一操作ずつ選ぶ。iPhoneとiPad、モバイルとパソコンの操作を混ぜない。
3. このアプリで正規の公開URLをコピーし、用意した別の画面のアドレス欄へ貼り付けて開く。コピーできない場合は、読取り専用のURL欄から手動でコピーする。
4. 実際にログインの入力画面が表示されたか答える。最初からコード一覧が見える場合は、既存ログインを残して今回の確認だけを始め直す。
5. 同じログインで、サービス側の認証とデータの読取りを続ける。

通常の外部リンクを押しても、開き先をプライベート画面へ自動指定できたとは扱わない。URLをコピー・閲覧しただけで設定済み・認証済み・復旧済みを記録しない。実際のメール、パスワード、コード、トークンを含む一時URLを、このコピー機能へ渡さない。

## 2. 確認したブラウザーと表示

| 実際の端末・ブラウザー | 一画面ずつ行う操作 | 出典 |
| --- | --- | --- |
| iPhone Safari・現在の詳細ボタン | Safariを開く → 詳細 → 新規プライベートタブ | B01 |
| iPhone Safari・iOS 17以前のタブ表示 | Safariを開く → タブ一覧 → スワイプしてプライベート → ＋ | B01・B12 |
| iPad Safari | Safariを開く → タブのボタンを長押し → 新規プライベートタブ | B02 |
| Mac Safari | Safariを開く → メニューバーのファイル → 新規プライベートウインドウ | B03 |
| iPhone / iPad Chrome | Chromeを開く → その他（3点） → 新しいシークレットタブ | B04 |
| Android Chrome・現行の公式表示 | Chromeを開く → その他 → 新しいシークレットウィンドウで開く。タブレットでは「新しいシークレットウィンドウ」の場合がある | B05 |
| Windows / Mac / Linux Chrome | Chromeを開く → その他 → 新しいシークレットウインドウ | B06 |
| iPhone / iPad Firefox | 下記のタブ保持を確認 → 数字のタブアイコン → プライベート → ＋ | B07・B08 |
| Android Firefox | Firefoxを開く → アドレス欄の隣の数字アイコン → マスク → ＋ | B09 |
| Windows / Mac / Linux Firefox | Firefoxを開く → 3本線のメニュー → 新しいプライベートウィンドウ | B10 |
| Windows Edge | Edgeを開く → 設定など（3点） → 新しいInPrivateウィンドウ | B11 |
| Mac Edge | Edgeを開く → Shift・Command・Nを同時に押す | B12 |
| iOS Edge | Edgeを開く → タブ → InPrivate → ＋ | B12 |
| Android Edge | Edgeを開く → タブ → InPrivate → 新しいプライベートタブを開く | B12 |

OS・ブラウザー・表示の組み合わせで18の案内データを持つ。実際の版・管理設定で項目が違う場合は、その場で未完了にして戻れる。未知の環境へパソコンのメニューを流用しない。Android Chromeの現行資料を、以前の「新しいシークレットタブ」という表示と同一だと推測しない。LinuxのEdge等、まだ操作を照合していない組み合わせは、案内済みとしない。

すでに本人が用意した別の未ログイン画面を選ぶ経路では、プライベートタブの新設を要求しない。どの経路でも正規URLと実際のログイン画面を確認する。管理による制限を解除したり、閲覧データ・すべてのプライベートタブ・唯一の使えるログインを消したりして確認を通さない。

### FirefoxのiOS版でタブを保持する

標準設定では、プライベートの表示を離れる・アプリを終了する際にプライベートタブが閉じる場合がある。案内へ戻った際に作業中のログインを失わないよう、Firefoxのメニュー → 設定 → Privacyの「Close Private Tabs / プライベートタブを閉じる」を、それぞれ別の操作で確認する。メニューの位置はiPhoneでは下部、iPadでは右上。

オフなら維持する。オンの場合は「タブを残す設定へ変える」「設定を維持して別のブラウザーを使う」を選べる。変更する場合だけオフにし、右上の完了で戻る。タブが自動終了せず、自分で閉じるまで残ること、解除済みのブラウザーを使える人に見える場合があることを先に説明する。記録の取り消しだけで実際の設定を元へ戻した扱いにせず、使える唯一のログインを自動的に閉じない。

## 3. 保存・訂正・記録

- `privateBrowserCatalog.ts`にOS別の操作、日英の文、完了条件、ボタン、出典IDを置く。`privateBrowserSources.ts`に出典・適用範囲・最終確認日・本文と検索抜粋の別を置く。`OfficialAddress.tsx`は正規URLのコピーと手動コピーを表示する。
- Enteの新規対象作業は`browserOpeningV1: 1`で識別する。従来の`stepwiseSignInV1`、revision12、暗号化封筒、IDと未知項目を維持する。ブラウザーの回答や現在の画面は、既存の暗号化保存へ途中保存する。
- 以前の完了・途中の作業へ新しい質問を自動挿入しない。以前の一操作ずつのログインで、本人が「確認を始め直す」を選んだときだけ、新しいブラウザー案内へ移る。そのログインの確認だけを取り下げ、登録・パスワード変更・復旧・既存コードを保つ。
- 戻ってブラウザーを直した場合は、その後の確認を別のブラウザーの成功へ流用しない。前に済ませた実際のパスキー登録などは維持する。
- ブラウザーを選んだだけでは、認証手段や成功の観測を作らない。今回のブラウザー操作・正規URL・実際の認証・データ読取りは、同じ作業・同じ試行へ結ぶ。すべてのブラウザープロフィールで使えるという保証へ広げない。
- 回答で後続の長さが変わるため、未確定の残りステップ数を固定の総数のように表示しない。

## 4. 例外・仕組み・限界

プライベート画面は通常のCookieと分かれるため、現在のログインを残して別のログインを試せる。ただしプライベートタブ同士で同じログインを共有することがある。別タブを開いたことと、未ログインであることは別に確認する。

このモードで偽サイトが正規のサイトになったり、端末内のマルウェアを防げたりするわけではない。正規の公開URLを使い、実際のログイン画面を確認してから入力する。不要な匿名性や完全な履歴消去を保証しない。

項目が違う・利用できない場合は、その場の分岐と戻る操作で対処する。解決しない場合の手動AI相談では、サービス、実際のOS、許可した一覧のブラウザー名、現在の操作、期待表示、困りごと、関連する公式資料を含める。端末の呼び名、実メール、任意の回答、パスワード、コード、一時URLを含めない。自動送信はしない。

## 5. 追加の受け入れ条件

| ID | 条件 |
| --- | --- |
| PB01 | 実端末のOSに合うブラウザーだけを案内候補にし、未知の環境へメニューを推測で適用しない |
| PB02 | iPhoneの現在のSafari・以前の表示・iPadを分け、長押しとタップを混同しない |
| PB03 | モバイルFirefox・Edgeのタブグループと、パソコンのメニューを混同しない |
| PB04 | Firefox iOSの既存オフを維持し、変更しない選択でも別の方法へ戻れる |
| PB05 | URLコピーの成功・権限拒否・手動コピーが利用でき、コピーだけでは作業を完了しない |
| PB06 | 最初からコード一覧が開いた場合は新しい認証の成功へ数えず、既存の利用手段を残す |
| PB07 | 用意済みの未ログイン画面を使う人へ、プライベート画面の新設を強制しない |
| PB08 | 戻ってブラウザーを直す・期限切れでやり直す場合に、別の試行の記録を混ぜない |
| PB09 | 途中のブラウザー選択と画面を暗号化保存し、同じ位置から再開する |
| PB10 | 以前の完了・途中位置・未知項目を保ち、本人の明示した確認の再開だけを新経路へ移す |
| PB11 | 日英・390px・キーボードで使え、未確定の総ステップ数や未確認の外部画面画像を表示しない |
| PB12 | AI相談のブラウザー名は許可した値だけを含み、任意文字列・秘密・呼び名を除外する |

PB01〜12は追加の具体化であり、全体196条件・90監査・機種変更36シナリオ・AR・DP・TF・ENの残る範囲を置き換えない。アプリ内の遷移試験と、本人の実ブラウザー・実サービスでの照合を区別する。

## 6. 一次資料

すべて2026-11-14に確認。B02・B03は取得制限があるため公式検索の本文抜粋、それ以外は公式本文を確認した。外部設定画面の画像を捏造しない。

| ID | 公式資料 | 確認した範囲 |
| --- | --- | --- |
| B01 | [Apple・iPhone](https://support.apple.com/ja-jp/105030) / [英語](https://support.apple.com/en-us/105030) | 現在の詳細ボタンと新規プライベートタブ、iOS 17以前の表示 |
| B02 | [Apple・iPad](https://support.apple.com/ja-jp/111769) | タブの長押し、新規プライベートタブ。公式検索の本文抜粋 |
| B03 | [Apple・Mac](https://support.apple.com/ja-jp/102564) | ファイル、新規プライベートウインドウ。公式検索の本文抜粋 |
| B04 | [Chrome・iOS](https://support.google.com/chrome/answer/95464?co=GENIE.Platform%3DiOS&hl=ja) / [英語](https://support.google.com/chrome/answer/95464?co=GENIE.Platform%3DiOS&hl=en) | その他、新しいシークレットタブ |
| B05 | [Chrome・Android](https://support.google.com/chrome/answer/95464?co=GENIE.Platform%3DAndroid&hl=ja) / [英語](https://support.google.com/chrome/answer/95464?co=GENIE.Platform%3DAndroid&hl=en) | 現在のウィンドウの表示、タブレットの違い |
| B06 | [Chrome・パソコン](https://support.google.com/chrome/answer/95464?co=GENIE.Platform%3DDesktop&hl=ja) | メニュー、新しいシークレットウインドウ、別窓でのセッション共有 |
| B07 | [Firefox・iOS](https://support.mozilla.org/ja/kb/private-browsing-firefox-ios) / [英語](https://support.mozilla.org/en-US/kb/private-browsing-firefox-ios) | タブ、プライベート、＋、タブの自動終了 |
| B08 | [Firefox・タブを残す](https://support.mozilla.org/ja/kb/automatically-close-private-tabs-when-leaving-priv) / [英語](https://support.mozilla.org/en-US/kb/automatically-close-private-tabs-when-leaving-priv) | 設定への入口、Close Private Tabs、完了 |
| B09 | [Firefox・Android](https://support.mozilla.org/ja/kb/private-browsing-firefox-android) / [英語](https://support.mozilla.org/en-US/kb/private-browsing-firefox-android) | 数字アイコン、マスク、＋ |
| B10 | [Firefox・パソコン](https://support.mozilla.org/en-US/kb/private-browsing-use-firefox-without-history) | メニュー、新規プライベートウィンドウ、Cookieとセッションの範囲 |
| B11 | [Edge・Windows](https://support.microsoft.com/ja-jp/edge/browse-inprivate-in-microsoft-edge) / [英語](https://support.microsoft.com/en-us/edge/browse-inprivate-in-microsoft-edge) | 設定など、新しいInPrivateウィンドウ |
| B12 | [Microsoft・OS別の開き方](https://support.microsoft.com/ja-jp/accounts-billing/manage/avoid-staying-signed-in-on-a-public-computer) | Macのショートカット、iOS・AndroidのEdge、以前のSafariのタブグループ |
