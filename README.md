# Cyber-Security-Map

使っているメール・端末に合わせて、一つずつ設定を進めるセキュリティガイドです。確認したつながりと作業の記録はSecurity Mapで見られます。

## 起動

Docker（Compose v2対応）を用意し、リポジトリ内で実行します。Node.js・npmのインストールは不要です。

```sh
docker compose up --build -d --wait
```

ブラウザーで <http://localhost:18473> を開きます。ソースを変更したら、同じコマンドで再ビルドしてください。

停止:

```sh
docker compose down
```

## GitHub Pages

`Settings → Pages → Source` を `GitHub Actions` に設定すると、`main` の更新時にビルド・テスト後のアプリを公開します。

公開先: <https://akhkusu.github.io/Cyber-Security-Map/>（Pages設定とデプロイ完了後）。非公開リポジトリでの利用にはGitHub Pro等の対応プランが必要です。公開時の制約は [SECURITY.md](./SECURITY.md#公開ホスティング) を確認してください。

## 使い方

1. このアプリ専用の保存用パスフレーズを作ります。
2. よく使うメールを選び、表示された操作を一つずつ進めます。
3. 公式の設定画面で状態を確認したら、「確認しました」で記録して次へ進みます。
4. パスワード管理・復旧・端末の対策を続けます。途中保存、戻る、後回し、完了の取り消しに対応しています。
5. Security Mapで、本人が確認したメール・認証端末・バックアップ・復旧手段の関係を確認できます。

対応するメールの認証手順: iCloud、Google、Microsoft、Proton、Fastmail、Tuta、Zoho、Yahoo.com、StartMail、mail.com、GMX.com。地域・アカウント種別により対応範囲が異なります。[実装・確認状況](docs/IMPLEMENTATION-STATUS.md)をご確認ください。

[詳細プロダクト仕様](docs/PRODUCT-SPEC.md)に、今後の対応対象・例外処理・受け入れ条件も含めて定義しています。手順と根拠の更新方法は[メンテナンス手順](docs/GUIDE-MAINTENANCE.md)を参照してください。

パスワード管理・認証アプリの製品差、移行・復旧、Security Mapの循環依存は[製品別補完仕様](docs/PASSWORDS-AUTHENTICATORS-SPEC.md)で詳しく定義しています。[不足点レビュー](docs/SPEC-GAP-REVIEW.md)と、現在の実装範囲を分けて管理しています。

[Google・Apple・Bitwardenとモデルの再監査](docs/MAJOR-PLATFORMS-MODEL-AUDIT.md)では、端末・ソフトウェア・識別子・認証情報・セッション・権限・削除を含む到達モデルを定義しています。対応v1の未知項目の保持、未対応形式の書き戻し防止、元ファイルの退避は修正を実装しました。到達モデル全体は拡張対象です。

[機種変更・旧端末の扱い](docs/DEVICE-CHANGE-LIFECYCLE-SPEC.md)では、新しいスマホでの利用確認と、旧端末を使い続ける・予備にする・譲る・売る経路を、基本対策と別の任意作業として定義しています。任意ガイドの初期経路と、未完了の引き継ぎがある間の消去ガードを実装しています。対応するOS・製品と残る分岐は、実装状況をご確認ください。

機種変更は「対策を進める」の任意作業か、Security Mapのスマホ詳細から開始します。主ガイドの途中位置を残し、新端末の利用確認と旧端末を使い続ける・予備にする・手放す手順を別に進められます。

旧端末を残す場合も、ロック・更新・実際の用途の試用・予備の保管を一操作ずつ案内します。用途を選んだだけで利用可能な予備にせず、未定・故障は区別します。確認の取り消しでは別の作業の記録と、後から実行した消去の状態を保ちます。

Proton Pass・NordPassでは、実際のAccount・保管庫・端末上のアプリを分け、復旧・自動入力・保存したログインの実利用まで案内します。対応OSと、残るSSO・復旧等の経路は[実装契約](docs/CLOUD-MANAGERS-GUIDE.md)で確認できます。

Proton Pass・NordPassの既存個人保管庫は、任意の機種変更内で、同じAccountへの認証・保管庫の解除・旧端末なしの保存パスワード利用まで確認できます。旧端末だけで使い続ける場合は移行を強制せず、手放す場合は未完了を残して消去を止めます。[機種変更の対応範囲](docs/CLOUD-MANAGERS-PHONE-MOVE.md)をご確認ください。

アカウントのパスワードや認証コードは入力しないでください。

## 保存データ

- データはブラウザー内に暗号化して保存され、サーバーには送信されません。同じブラウザーとURLで利用してください。
- アプリ用パスフレーズを忘れると保管庫を開けません。設定から暗号化バックアップを保存してください。
- コンテナーを削除してもデータは残ります。消去する場合はブラウザーのサイトデータを削除してください。

セキュリティの詳細は [SECURITY.md](./SECURITY.md) を参照してください。

## テスト

型チェック・単体テスト・本番ビルドをDocker内で実行します（ブラウザーE2Eテストは下の別ターゲットで実行します）。

```sh
docker build --target checks -t cyber-security-map:checks .
```


ブラウザーを含むテストも、ホストへのnpmインストールなしで実行できます。

```sh
docker build --target browser-tests -t cyber-security-map:browser-tests .
docker run --rm --shm-size=1g cyber-security-map:browser-tests
# GitHub PagesのプロジェクトURL・オフラインPWAも検証
docker run --rm --shm-size=1g cyber-security-map:browser-tests npm run test:pages
```

手順は公式資料の確認に基づいています。アプリの経路テストは、外部サービスの実際の設定変更や全機種の実画面テストを代行するものではありません。

Apple・Google組込み管理の対応OS・保存方式・機種変更と残る範囲は、[組込み管理の実装契約](docs/BUILTIN-MANAGERS-GUIDE.md)を参照してください。

認証アプリ3製品の新規登録は[認証アプリの実装契約](docs/AUTHENTICATOR-GUIDE.md)、Microsoft・Bitwardenの確認済みの移行／復元は[認証アプリの機種変更](docs/AUTHENTICATOR-PHONE-MOVE.md)にまとめています。新端末の既存コード・実際の保存先・対象Accountを確認し、コードの表示だけでログイン済みにはしません。
