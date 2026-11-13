# Cyber-Security-Map

アカウントや端末の保護状態を自分で確認し、必要な対策を整理するアプリです。

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

1. 初回ガイドでアカウントや端末をニックネームで登録します。
2. チェックアップに回答します。
3. 保護プランの対策を確認し、自分で実施・記録します。

アカウントのパスワードや認証コードは入力しないでください。

## 保存データ

- データはブラウザー内に暗号化して保存され、サーバーには送信されません。同じブラウザーとURLで利用してください。
- アプリ用パスフレーズを忘れると保管庫を開けません。設定から暗号化バックアップを保存してください。
- コンテナーを削除してもデータは残ります。消去する場合はブラウザーのサイトデータを削除してください。

セキュリティの詳細は [SECURITY.md](./SECURITY.md) を参照してください。

## テスト

型チェック・単体テスト・本番ビルドをDocker内で実行します（ブラウザーE2Eテストは含みません）。

```sh
docker build --target checks -t cyber-security-map:checks .
```
