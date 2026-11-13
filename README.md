# Personal Cybersecurity OS

個人のデジタル資産を整理し、保護状態を手動で確認して、次に取り組むことを決めるローカルファーストのPWAです。端末やアカウントを自動検査せず、回答に基づいて行動案と公式ガイドを提示します。回答と資産情報はブラウザー内の暗号化保管庫に保存されます。

## 開発を始める

Node.js 22.12以降を用意してください。

```sh
npm install
npm run dev
```

静的配布用ビルドとローカルプレビュー:

```sh
npm run build
npm run preview
```

品質確認:

```sh
npm run test
npm run test:e2e
npm run lint
npm audit --omit=dev
```

E2EテストにはPlaywrightのChromiumが必要です。

## 使い方

1. 初回ガイドで保護したい領域、利用する資産、基本的な確認事項を選びます。
2. 資産名は「メインのメール」などのニックネームで登録します。アドレスや認証情報は入力しません。
3. 6領域に分かれたセキュリティチェックアップを進めます。途中で閉じても回答した場所から再開できます。
4. 保護プランで優先理由と手順を確認します。改善操作は本人が行い、結果を自分で記録します。
5. 更新手順などが必要な場合はOSを選び、メーカーの案内を開きます。アプリが端末設定を変更することはありません。

資産情報と回答はWeb Crypto APIによるAES-256-GCMで暗号化し、IndexedDBに保存します。アプリ用パスフレーズを忘れると保管庫を開けません。設定から暗号化バックアップを保存し、安全な別の場所に保管してください。

## プライバシーと機能の境界

- アカウント、端末、ネットワーク、インストール済みソフトを読み取りません。
- シェル、ネイティブエージェント、ローカル管理サーバー、バックグラウンド監視を含みません。
- 評価データをサーバーに送信する機能、分析、広告、テレメトリー、外部AI連携はありません。
- 外部サイトへ移動するのは、利用者が公式ガイドを選んだときだけです。
- PWAはアプリの静的シェルだけをキャッシュし、保管庫や復号済みの評価をキャッシュしません。
- 優先度は作業順を決めるための規則です。侵害確率や安全度スコアではありません。

配信元から読み込むJavaScriptは信頼境界です。ローカル暗号化は、侵害された端末や悪意ある配信コードから、ロック解除中のデータを保護するものではありません。詳細は [SECURITY.md](./SECURITY.md) を参照してください。

## Run locally with Docker (no host npm required)

Install Docker Desktop (Windows/macOS) or Docker Engine with Compose v2 (Linux).
From this repository directory:

```sh
docker compose up --build -d --wait
```

Open `http://localhost:8080` in your browser. Keep using the same hostname and
port: the encrypted vault belongs to that browser origin. After changing source
files, repeat the command to rebuild. This serves a production build, without hot reload.

Node and npm run only during the image build. Dependencies come from the lockfile
with integrity verification and lifecycle install scripts disabled. Builds run
as a non-root user; build/type-check/test steps have no network access. The final
image contains nginx and static assets, without Node, npm, or node_modules.
The running service is non-root, has a read-only filesystem and temporary `/tmp`,
drops all Linux capabilities and publishes only
to your computer's loopback interface. No host folders, Docker socket, secrets,
or persistent Docker volumes are mounted. Docker reduces host exposure; you still
need to trust the app JavaScript that runs in your browser and Docker itself.

Run the existing unit tests, type check, and production build inside Docker:

```sh
docker build --target checks -t cyber-security-map:checks .
```

This target does not run Playwright browser E2E tests.

Stop and remove this project's containers and network:

```sh
docker compose down --remove-orphans
```

Also remove its tagged images (the checks image exists only if you built it):

```sh
docker compose down --rmi all --volumes --remove-orphans
docker image rm cyber-security-map:checks
```

Docker may retain reusable build cache and downloaded base images. In Docker
Desktop, use its storage management UI to remove unused cache/images if desired.
`docker builder prune` removes unused build cache across projects; it is optional
and can make other projects rebuild. Avoid a system-wide prune just to remove this app.

**Browser data is separate:** removing containers does not erase the encrypted
vault, service worker, or offline PWA cache. Export an encrypted backup first if
needed, then clear site data for `http://localhost:8080` in your browser (and remove
the installed PWA, if any) to remove that local data. The PWA can still open offline
until its browser storage is cleared.
