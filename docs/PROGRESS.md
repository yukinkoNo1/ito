# 進み具合
今: Phase 2（PWA とローカルファースト） / 次にやること: Phase 1 のレビューの PWA のデータ層の指摘（WD-01〜15）を直す → Phase 2 の受け入れ基準の確認 → レビュー → phase-2

## ステップ
| ステップ | 状態（未着手・作業中・完了） | タグ | メモ |
|---|---|---|---|
| Phase 0 土台 | 完了 | phase-0 | レビューの指摘（dist-e2e のコミット、zod の jitless の順番、421/413 の no-store など）を直した |
| Phase 1 予定の中核と表示用フィード | 完了 | phase-1 | レビューの指摘（非公開→公開の履歴の漏えい、通知設定の部分更新、送信待ちの畳み込み、確認スクリプトの後始末）を直した |
| Phase 2 PWA とローカルファースト | 作業中 | phase-2 | |
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
| Phase 1 | 2 人の開発ログインで、片方が作った予定がもう片方に出る | E2E e2e/phase1.spec.ts「2 人の開発ログインで…」、API apps/server/test/events.test.ts「作った予定が、ほかの家族の同期に出る」 | OK |
| Phase 1 | 他人の非公開は全 API（409 の本文を含む）で「予定あり」の形 | events.test.ts「他人の非公開（§10・§14。T5）」（sync・差分 sync・activity・trash・409 の本文・403 の本文）、feed.test.ts（持ち主の ID ヘッダでも title: null）、core/test/events.test.ts「projectEvent」 | OK（まだない経路は「後で足すテスト」） |
| Phase 1 | 他人の非公開の更新は 409 ではなく 403 | events.test.ts「他人の非公開の更新・削除・復元は 409 ではなく 403（古い If-Match でも）」 | OK |
| Phase 1 | 409 と Idempotency のテスト | events.test.ts「If-Match が合えば…」「Idempotency-Key がなければ 400…」「更新の再送（同じ Idempotency-Key）は…」 | OK |
| Phase 1 | 祝日が月と日に出る | E2E phase1.spec.ts（2026-10-12 スポーツの日が月のセルと日の一覧に出る）、core「祝日」、web viewmodels.test.ts「MonthVM」 | OK |
| Phase 1 | 削除 → 元に戻す | E2E phase1.spec.ts「削除 → 元に戻す」（サーバーにも残る） | OK |
| Phase 1 | §21 の表示用フィードのテストが通る（例のファイルとの比較は朝練を除く） | apps/server/test/feed.test.ts（§21 の一覧すべて） | OK（朝練は Phase 3 で後で確認） |
| Phase 1 | CLI で発行したキーで 200、止めると 401 | `node scripts/feed-check.mjs`（手元）と `docker compose exec -T app node --input-type=module - < scripts/feed-check-inner.mjs`（Docker）。キーは表示せず状態コードだけ | OK（手元・Docker とも キーなし 401 / キーあり 200 / 止めたあと 401） |
| Phase 1 | CLI（create / list / revoke、5 つまで、キーの平文を DB・一覧・ログに出さない） | apps/server/test/cli.test.ts、feed.test.ts「連携キーの平文はログ・DB・エラー応答に出ない」 | OK |
| Phase 1 | メンバーの名前の重複禁止（追加・変更・再有効化・/api/me）、最後の管理者 | apps/server/test/members.test.ts | OK |
| Phase 1 | 履歴の差分（人が読める文字列） | events.test.ts「作成・更新・削除・復元が残り、差分は人が読める文字列」 | OK |
| Phase 1 | `pnpm check`・`docker compose build` | `pnpm check`（188 件）、`docker compose build`・`up -d --wait`・`down` | OK |

## 決めたこと（SPEC §24 に書いたもの）
- D15: 作業の順番（Phase 6 を Phase 2 の次に）。後のフェーズの機能が要る受け入れ項目は「後で確認」
- D16: `STATIC_DIR`（静的配信の場所。E2E モード用）
- D17: 安全側の細則（Content-Type 違いも CSRF の 403、自動登録も MAX_MEMBERS まで、MAX_MEMBERS の上限は 8、開発モードでも HOST はループバックだけ）
- D18: 管理者の自動登録の名前の衝突（末尾に 2, 3…）と色（§22 の順で未使用の最初の色）
- D19: 手元の開発は Node 22.12 以上でも可（本番は node:24-slim）、react-router は 7 系
- D20: 開発モードの「人の端末」は X-Dev-Login 付きの要求
- D21: feed_tokens に last_user_device_at（5 分に 1 回まで書く）
- D22: 予定の API の細則（更新・削除・復元でも Idempotency-Key を効かせる、ゴミ箱の予定は 410、担当なしは不可、他人の非公開はゴミ箱に出さない、終日は 366 日まで）
- D23: 連携キーの確認はキーを表示しないスクリプトで状態コードだけ
- D24: 祝日の表は holiday_jp から 2000 年以降の日付と名前だけを取り出して使う（ライブラリと一致をテスト）
- D25: 手で確かめる受け入れ項目の代わり（CDP の Page.getInstallabilityErrors、long task）
- D26: 前回開いた時刻などは localStorage（端末ごと）。作成・更新の時刻はミリ秒まで
- D27: 履歴の非公開の扱い（公開前の差分は持ち主だけ、非公開にしたら前の履歴も持ち主だけ）

## 後で足すテスト
- 非公開の漏えい（まだない経路）: 書き出し（JSON・ICS。Phase 7）、Push の文面（Phase 4）、朝のまとめ・前夜の予告（Phase 4）、一言入力の重なりの警告（Phase 5。端末内で作るので他人の非公開は「予定あり」になることを確かめる）、検索（Phase 7。端末内の DB を検索する）
- 表示用フィードの例のファイルとの比較に朝練（繰り返し）を含める・例外がフィードに出る（Phase 3）

## 要確認（持ち主がやること・確かめてほしいこと。根拠の出力も）
- **Node.js 24 LTS が開発機に入っていない**（管理者権限のインストールは持ち主の作業）。手元の開発・テストは Node 22 で行い、本番のイメージ（node:24-slim）では 24 で動くことを docker compose で確かめている（§24 D19）。
  - 根拠: `node -v` → `v22.21.0`（C:\Program Files\nodejs）。`pnpm` はコマンドとしては無い（`pnpm: command not found`）
  - 持ち主がやること: Node 24 LTS を入れる（入れたあと `pnpm install` をやり直す）。pnpm は corepack で使える（`corepack enable pnpm`、または README のとおりリポジトリ内に shim）
- pnpm は PC 全体には入れず、corepack の shim をリポジトリ内の `.tools/bin`（.gitignore 済み）に置いて使っている（`corepack enable --install-directory .tools/bin pnpm`）。版は package.json の packageManager（pnpm@10.34.5）

## 既知の問題
- vite-plugin-pwa 1.3 が Vite 8 で「inlineDynamicImports option is deprecated」の警告を出す（ビルドは成功する。プラグイン側の問題）
