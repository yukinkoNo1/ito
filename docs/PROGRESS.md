# 進み具合
今: Phase 1（予定の中核と表示用フィード） / 次にやること: 作業中の変更（stash）を戻し、Phase 1 の API・CLI・フィードのテストを通す → web の最小の画面 → 受け入れ基準の確認・レビュー

## ステップ
| ステップ | 状態（未着手・作業中・完了） | タグ | メモ |
|---|---|---|---|
| Phase 0 土台 | 完了 | phase-0 | レビューの指摘（dist-e2e のコミット、zod の jitless の順番、421/413 の no-store など）を直した |
| Phase 1 予定の中核と表示用フィード | 作業中 | phase-1 | |
| Phase 2 PWA とローカルファースト | 未着手 | phase-2 | |
| Phase 6 UI 統合 | 未着手 | phase-6 | Phase 2 の次に行う（§24 D15） |
| Phase 3 繰り返し | 未着手 | phase-3 | |
| Phase 4 通知 | 未着手 | phase-4 | |
| Phase 5 一言入力 | 未着手 | phase-5 | |
| Phase 7 仕上げ | 未着手 | phase-7 | |
| 総点検 | 未着手 | audit | |
| 最終確認 | 未着手 | — | |

## 受け入れ基準
| ステップ | 項目 | 確認方法 | 結果（後で確認を含む） |
|---|---|---|---|
| Phase 0 | `pnpm dev` で web と server が起動 | `node scripts/check-dev.mjs`（pnpm dev を起動 → server /healthz 200・web / 200・web 経由の /api/me 200 → 起動したプロセスの木だけを止める） | OK（EXIT=0。終わったあと 5173・8787 の待ち受けなし） |
| Phase 0 | `pnpm check` 成功 | `pnpm check`（Biome＋tsc 7.0.2＋Vitest） | OK（70 件） |
| Phase 0 | ヘッダなし 401・未登録 403・無効 403 | apps/server/test/middleware.test.ts「identity」 | OK |
| Phase 0 | CSRF 4 パターン 403 | middleware.test.ts「CSRF」（X-Ito-Client なし・Content-Type 違い・Origin 不一致/なし・Sec-Fetch-Site: cross-site/same-site） | OK |
| Phase 0 | Host 不一致 421 | middleware.test.ts「Host が APP_ORIGIN と一致しなければ 421」 | OK |
| Phase 0 | `/healthz` は Host に関係なく 200（例外はこのパスだけ） | middleware.test.ts「/healthz は Host に関係なく 200」「/healthz ちょうどだけ」 | OK |
| Phase 0 | GET には CSRF 検査が掛からない | middleware.test.ts「GET には CSRF の検査を掛けない」 | OK |
| Phase 0 | 本番設定で HOST=0.0.0.0 なら起動失敗・本番で dev モードなら起動失敗 | apps/server/test/env.test.ts | OK |
| Phase 0 | セキュリティヘッダが全応答に付く・本文 32KB 上限・no-store | middleware.test.ts「ヘッダ・本文の上限」 | OK（421・413 も no-store） |
| Phase 0 | `docker compose config` が通る | `docker compose config -q` | OK（EXIT=0） |
| Phase 0 | build 成功・app が読み取り専用・uid 10001 で healthy・空の volume でマイグレーション | `docker compose down -v` → `build` → `up -d --wait` → `exec app id` → `docker inspect` → /data/ito.db のテーブル一覧 → `exec app node dist/cli.js --help` → `down` | OK（BUILD/UP/EXEC/DOWN すべて EXIT=0。uid=10001 gid=10001、ReadonlyRootfs=true、CapDrop=[ALL]、healthy、テーブル __drizzle_migrations・members） |
| Phase 0 | ts はカーネルモード・鍵なしで起動を試す | `docker inspect`（TS_USERSPACE=false）、ts のログ（ログイン待ち） | OK（ts は tailnet に参加しないまま動く。鍵は使っていない） |
| Phase 0 | SIGTERM で DB を閉じてから終了 | `docker compose stop app` のログ（signal → shutting down → stopped、ExitCode=0）、runtime.test.ts（shutdown を直接呼ぶ） | OK |
| Phase 0 | E2E の雛形（CSP 違反・コンソールエラー 0 件） | `pnpm test:e2e`（e2e/smoke.spec.ts） | OK |
| Phase 0 | zod を jitless で使う（new Function を呼ばない） | apps/server/test/zod-setup.test.ts | OK |

## 決めたこと（SPEC §24 に書いたもの）
- D15: 作業の順番（Phase 6 を Phase 2 の次に）。後のフェーズの機能が要る受け入れ項目は「後で確認」
- D16: `STATIC_DIR`（静的配信の場所。E2E モード用）
- D17: 安全側の細則（Content-Type 違いも CSRF の 403、自動登録も MAX_MEMBERS まで、MAX_MEMBERS の上限は 8、開発モードでも HOST はループバックだけ）
- D18: 管理者の自動登録の名前の衝突（末尾に 2, 3…）と色（§22 の順で未使用の最初の色）
- D19: 手元の開発は Node 22.12 以上でも可（本番は node:24-slim）、react-router は 7 系
- D20: 開発モードの「人の端末」は X-Dev-Login 付きの要求

## 後で足すテスト
（Phase 1 で書く）

## 要確認（持ち主がやること・確かめてほしいこと。根拠の出力も）
- **Node.js 24 LTS が開発機に入っていない**（管理者権限のインストールは持ち主の作業）。手元の開発・テストは Node 22 で行い、本番のイメージ（node:24-slim）では 24 で動くことを docker compose で確かめている（§24 D19）。
  - 根拠: `node -v` → `v22.21.0`（C:\Program Files\nodejs）。`pnpm` はコマンドとしては無い（`pnpm: command not found`）
  - 持ち主がやること: Node 24 LTS を入れる（入れたあと `pnpm install` をやり直す）。pnpm は corepack で使える（`corepack enable pnpm`、または README のとおりリポジトリ内に shim）
- pnpm は PC 全体には入れず、corepack の shim をリポジトリ内の `.tools/bin`（.gitignore 済み）に置いて使っている（`corepack enable --install-directory .tools/bin pnpm`）。版は package.json の packageManager（pnpm@10.34.5）

## 既知の問題
- vite-plugin-pwa 1.3 が Vite 8 で「inlineDynamicImports option is deprecated」の警告を出す（ビルドは成功する。プラグイン側の問題）
