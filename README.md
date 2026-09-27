# いと — 家族のカレンダー

家族（大人 2〜6 人）だけで使う共有カレンダーの PWA。自宅サーバーに置き、Tailscale 経由でのみアクセスする。
仕様は [docs/SPEC.md](docs/SPEC.md) が唯一の正。

## 開発の始め方

必要なもの: Node.js 24 LTS（22.12 以降でも動く）、Docker Desktop（本番と同じ形で試すとき）。
pnpm は corepack で使う（版は package.json の `packageManager` で固定）。PC 全体に入れずに試すなら、リポジトリ内に shim を置く:

```sh
corepack enable --install-directory .tools/bin pnpm   # .tools は .gitignore 済み
export PATH="$PWD/.tools/bin:$PATH"                    # PowerShell: $env:Path = "$PWD\.tools\bin;$env:Path"
pnpm install
node scripts/dev-setup.mjs   # 開発用の鍵と設定（deploy/app.env・deploy/.env・.data/dev.secrets.env）を作る。値は表示しない
pnpm seed                    # 開発用の家族 4 人（お父さん・お母さん・はると・さき。ログインは *@example.com）
pnpm dev                     # http://localhost:5173 （API は :8787。開発モードでは X-Dev-Login で本人を切り替えられる）
```

よく使うコマンド:

| コマンド | 内容 |
|---|---|
| `pnpm check` | Biome ＋ 型検査 ＋ 単体・API テスト |
| `pnpm build` | PWA とサーバー（1 ファイルにバンドル）をビルド |
| `pnpm test:e2e` | E2E 用ビルドを Hono が配信するモードで Playwright（chromium・iPhone 15 のビューポート） |
| `pnpm db:generate` / `pnpm db:migrate` | マイグレーションの生成（列やテーブルを足すだけ）／開発 DB への適用 |

## 本番の立て方（SPEC §20）

### Tailscale の準備（管理画面）
1. DNS で MagicDNS と HTTPS Certificates を有効にする
2. アクセス制御ポリシー: `tag:ito` に届くのは `group:family` と `tag:ieboard` の 443 だけにする。既定の全許可ルールは「人の端末から人の端末へ」（`autogroup:member` → `autogroup:member:*`）に絞る（SPEC §20 の例のとおり）
3. 認証キーを作る: タグ `tag:ito`、再利用なし、エフェメラルなし、事前承認あり
4. 家族を tailnet に招待する
5. いえボードを動かす端末はタグ `tag:ieboard` で参加させる

### サーバー（Ubuntu ＋ Docker Compose）
```sh
git clone <このリポジトリ> ito && cd ito/deploy
cp .env.example .env            # TS_AUTHKEY に認証キーを書く
cp app.env.example app.env      # APP_ORIGIN・ADMIN_LOGINS・VAPID の鍵などを書く
chmod 600 .env app.env
docker compose up -d --build
```
- `https://ito.<tailnet>.ts.net` を開く（`ADMIN_LOGINS` のログインは初回アクセスで管理者として登録される）→ 設定の「家族」から家族のログインを登録する
- ts が tailnet に参加したら `deploy/.env` の `TS_AUTHKEY` は空にしてよい
- 設置後の確認: tailnet の別の端末から `curl -m 3 http://ito.<tailnet>.ts.net:8787/healthz` が**失敗する**こと、`https://ito.<tailnet>.ts.net/healthz` が 200 になること
- 更新: `git pull && docker compose up -d --build`（マイグレーションは起動時に自動で適用される）
- バックアップ: `/data/backups` を restic の対象にする。復元はコンテナを止め、`/data` の `ito.db-wal` と `ito.db-shm` を消してから `ito.db` を差し替えて起動する
- 監視: `docker compose ps` のヘルスと、ログの `level>=40`（warn 以上）

## 家族の端末のセットアップ（SPEC 付録B）

**iPhone**
1. App Store で Tailscale を入れ、招待メールのアカウントでログイン
2. Tailscale の設定（右上のプロフィール）→ VPN On Demand をオンにし、Wi-Fi・モバイルデータとも「Always」
3. Safari で `https://ito.<tailnet>.ts.net` を開く → 共有ボタン → 「ホーム画面に追加」
4. **ホーム画面のアイコンから**開き、名前と色を確かめる → 「通知をオンにする」

**Android**
1. Google Play で Tailscale を入れてログイン
2. Android の設定 → ネットワーク → VPN → Tailscale の歯車 → 「常時接続 VPN」をオン
3. Chrome で開く → 「アプリをインストール」→ 起動して通知を許可
