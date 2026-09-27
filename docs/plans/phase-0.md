# Phase 0 — 土台 計画

## 環境（2026-09-28 に確認）
- Node: v22.21.0（Program Files。24 系は入っていない。管理者権限のインストールは持ち主の作業 → PROGRESS の要確認）。手元の開発・テストは 22 で行い、本番のイメージ（node:24-slim）で 24 を確かめる。Node 24 にしかない API（URLPattern のグローバル、RegExp.escape など）は使わない
- pnpm: 未インストール。corepack の shim をリポジトリ内の `.tools/bin`（.gitignore 済み）に置いて使う（`corepack enable --install-directory .tools/bin pnpm`）。版は package.json の `packageManager: pnpm@10.34.5` で固定（SPEC §8 の例に合わせて 10 系。ビルドスクリプトの許可は pnpm 10 の書式 `onlyBuiltDependencies`）
- Docker Desktop 4.74（Engine 29.4.3）は動いている

## 版（lockfile で固定）
- typescript 7.0.2（7 系が動けばそのまま。動かなければ 6 系にして §24）
- vite 8.3 / @vitejs/plugin-react 6 / vite-plugin-pwa 1.3 / tailwindcss 4.3 / react 19.3
- react-router は 7 系（8 系は Node >=22.22 を要求し、手元の 22.21 で入らないため。ブラウザで使う API は同じ）
- hono 4.13 / @hono/node-server 2.x / drizzle-orm 0.45 / drizzle-kit 0.31 / better-sqlite3 13 / zod 4.6 / pino 10
- vitest 5 / @playwright/test 1.63 / @biomejs/biome 2.5

## 依存を足す理由（SPEC §8 にないもの）
- esbuild: サーバーと CLI を 1 ファイルにバンドルする（§20。tsdown でもよいとあるが、esbuild のほうが設定が少ない）
- tsx: 開発時にサーバーの TypeScript をそのまま動かす（`pnpm dev`・シード・CLI の開発用スクリプト）
- fake-indexeddb（Phase 2）: Dexie と outbox の単体テスト
- @axe-core/playwright（Phase 6）: axe の違反ゼロの確認

## 変更するファイル
- ルート: package.json（scripts: dev / check / build / test / test:e2e / db:generate / db:migrate / seed / feed-token）、pnpm-workspace.yaml、tsconfig.base.json、biome.json、vitest.config.ts、playwright.config.ts、.gitignore、.dockerignore、Dockerfile、README.md、CLAUDE.md（最後に追記）
- packages/core: package.json（exports は src の .ts を直接指す）、src/clock.ts、src/jst.ts（最小）、src/ids.ts（UUIDv7）、src/schemas.ts（MemberColor など最小）
- apps/server: env.ts、app.ts、main.ts、cli.ts（--help のみ）、logger.ts、errors.ts、middleware/（security-headers・host・body-limit・csrf・identity・problem）、db/（schema・client・migrate）、drizzle/（最初のマイグレーション）、scripts/seed.ts、build.mjs（esbuild）
- apps/web: Vite＋React の雛形、vite-plugin-pwa（injectManifest）の最小の sw.ts でビルドが通ることを確かめる
- deploy/: compose.yaml、ts-serve/serve.json、.env.example、app.env.example
- e2e/: 雛形（トップが開き、CSP 違反とコンソールエラーが 0 件）

## 経路ごとのミドルウェア（上から順に掛かる）
| 経路 | リクエストID・ログ | セキュリティヘッダ | Host 検査（421） | Cache-Control: no-store | 本文 32KB 上限 | プロトコル版（426） | CSRF（403） | identity（401/403） | feedAuth（Phase 1） |
|---|---|---|---|---|---|---|---|---|---|
| `/healthz` | ○ | ○ | **×**（コンテナ内のヘルスチェックが 127.0.0.1 で呼ぶ） | ○ | ○ | × | × | × | × |
| `/api/feed/*`（Phase 1） | ○ | ○ | ○ | ○ | ○ | × | **×**（GET・HEAD 以外は 405） | **×** | ○ |
| ほかの `/api/*` | ○ | ○ | ○ | ○ | ○ | ○（ヘッダがあれば版を確かめる） | ○（POST/PUT/PATCH/DELETE のみ） | ○ | × |
| 静的配信（PWA） | ○ | ○ | ○ | 資産は長期キャッシュ、index.html・sw.js は no-cache | ○ | × | × | × | × |

- エラーはすべて problem+json（onError・notFound で組み立てる）。セキュリティヘッダはエラー応答にも付く（外側のミドルウェアが next() のあとに付ける）
- identity は `/api/*` のうち `/api/feed` と `/api/feed/…` 以外にだけ掛ける（app.ts の isFeedPath で分けるミドルウェア。サブアプリの use('*') は親の全経路に広がるため、サブアプリでは分けない）
- Cache-Control: no-store は Host 検査・本文の上限より前に置き、421・413 の API 応答にも付ける（レビューの指摘）

## テスト
- server: env の起動時検査（HOST=0.0.0.0・http の APP_ORIGIN・dev＋production で失敗）、ヘッダなし 401、未登録 403、無効 403、管理者の自動登録（名前の衝突で 2 を付ける・色は未使用の最初の色）、CSRF 4 パターン（X-Ito-Client なし・Content-Type 違い・Origin 不一致・Sec-Fetch-Site: cross-site）で 403、GET には CSRF が掛からない、Host 不一致 421、/healthz は Host に関係なく 200、セキュリティヘッダが全応答（エラーを含む）に付く、本文 32KB 超は 413、X-Dev-Login は dev モードだけで効く
- core: jst の境界、UUIDv7 の形
- 構成のテスト: ソースで Date.now() と引数なしの new Date() を clock.ts 以外で使っていない、dangerouslySetInnerHTML を使っていない

## SPEC との食い違いと決めたこと
- ステップの順番（Phase 6 を Phase 2 の次に） → §24 D15
- `STATIC_DIR`（付録A にない）: 静的配信の場所。既定はバンドルの隣の `../public`。E2E で E2E 用ビルドを配信するために使う → §24 D16
- Content-Type が JSON でない状態変更の要求も CSRF として 403（§23 Phase 0 の「CSRF 4 パターン 403」に合わせる）／管理者の自動登録も MAX_MEMBERS を超えない／MAX_MEMBERS の上限は 8（色が 8 色）／開発モードでも HOST はループバックだけ → §24 D17
- 管理者の自動登録の名前の衝突と色（RUNBOOK 3.） → §24 D18
- better-sqlite3 13 はビルド済みのバイナリを同梱する（gypfile: false）が、pnpm 10 が node-gyp を走らせて失敗する（Visual Studio がない）ため、`ignoredBuiltDependencies` に入れてビルドスクリプトを動かさない
- react-router は 7 系（8 系は Node >=22.22 を要求するため）

## レビューで直したこと（Phase 0）
- apps/web/dist-e2e がコミットされていた → .gitignore に足して追跡から外した
- z.config({ jitless: true }) がスキーマの import より後に動いていた → 入口の最初の import にする zod-setup.ts を作った（サーバー・CLI・PWA）。new Function を呼ばないことをテストで確かめる
- /api の 421・413 に no-store が付いていなかった → 順番を直してテストを足した
- 自動登録の名前の切り詰めのあとに空白が残りうる → 切り詰めたあとも正規化
- jst が 0〜99 年を受け付けていた（Date.UTC が 1900 年代にする）・オフセットの範囲を見ていなかった → 1900〜2999 年に限り、オフセットは hh≤23・mm≤59
- build.mjs の作業フォルダが URL エンコードのままだった → fileURLToPath
- E2E の problems フィクスチャを auto にした（すべてのテストで CSP 違反・コンソールエラー 0 件）
- .dockerignore を .gitignore の秘密情報のパターンとそろえた
- 却下した指摘: CLI の runCli を import できない（Phase 1 で入口と中身を分けた）
