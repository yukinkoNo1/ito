# 進み具合
今: Phase 4（通知） / 次にやること: 退避した Phase 4 の作業中の変更（git stash「phase4-wip」。購読・スケジューラ・SW の push・設定の画面）を戻す → マイグレーションの番号を 0004 に → 受け入れ基準 → レビュー → phase-4

## ステップ
| ステップ | 状態（未着手・作業中・完了） | タグ | メモ |
|---|---|---|---|
| Phase 0 土台 | 完了 | phase-0 | レビューの指摘（dist-e2e のコミット、zod の jitless の順番、421/413 の no-store など）を直した |
| Phase 1 予定の中核と表示用フィード | 完了 | phase-1 | レビューの指摘（非公開→公開の履歴の漏えい、通知設定の部分更新、送信待ちの畳み込み、確認スクリプトの後始末）を直した |
| Phase 2 PWA とローカルファースト | 完了 | phase-2 | レビューの指摘（ログアウトで SW の登録が残る、SW を通る遷移のテスト、競合中の編集で自分の変更が消える、送らずに戻した変更のあとの取得、429 の待ち、426 の更新、時計の巻き戻し ほか）を直した |
| Phase 6 UI 統合 | 完了 | phase-6 | Phase 2 の次に行った（§24 D15）。レビューの指摘（シートのスワイプ、テーマの監視の漏れ、自分の非公開の候補、書く画面の日時の範囲、トースト・案内、履歴・ゴミ箱の状態、人の札が 7 個以上、日付をまたぐ行、検査の範囲 ほか）を直した |
| Phase 3 繰り返し | 完了 | phase-3 | レビューの指摘（件名だけ直してもシリーズが動く、C-04 の件数とサーバーの食い違い、リセットした例外の復活、毎月の規則のずれ、回が出ない規則、pnpm dev が rrule の読み込みで起動しない、回の送信待ちの 409 ほか）を直した（§24 D34） |
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
| Phase 2 | オフライン閲覧・オフライン作成 → 復帰で送信 | E2E e2e/phase2.spec.ts「オフラインで閲覧・作成 → 復帰で送信」（context.setOffline。SW がアプリシェルを返し、IndexedDB から描画） | OK |
| Phase 2 | API だけ遮断した状態（Tailscale 切断の再現）でも同じ | E2E「Tailscale だけ切れた状態でも、読み込み直して見られ…」（context.route で /api/** を abort → 読み込み直しても IndexedDB から表示・C-02「家のサーバーにつながりません（Tailscale を確認）」→ 解除後、再試行を押さずに 60 秒ごとの同期（page.clock.runFor）で送信）、store-review.test.ts「SYNC-08」（つながった同期でバックオフ中の送信待ちをすぐ送る） | OK |
| Phase 2 | 別のメンバーが追加した予定に「新」が付き、次に開いたときには消える | E2E「別のメンバーが追加した予定に「新」が付き…」（同じ回のあいだは消えない・「新しい予定 n件」）、E2E「背面に回して前面に戻したときも…」（visibilitychange の経路）、web viewmodels.test.ts「新着の印」 | OK |
| Phase 2 | 同じ予定をオフラインで 2 回編集しても自分の変更どうしで 409 にならない | E2E「同じ予定をオフラインで 2 回編集しても…」、web store.test.ts「更新どうし → 1 件」「送信中の変更には畳まず…If-Match を書き換える」、store-review.test.ts「WD-01」 | OK |
| Phase 2 | 競合を起こして 3 通りの解決 | E2E「競合を起こして解決する: 家族の変更を採用／自分の変更で上書き／両方残す」（解決までは編集・削除が出ない、解決後の手元の一覧とサーバーの両方を確かめる）、store.test.ts「競合の 3 通りの解決」、store-review.test.ts「SYNC-01」 | OK |
| Phase 2 | `/api/*` が Cache Storage に入らない | E2E「/api/* は Cache Storage に入らない」（SW の管理下で画面を移ったあと、Cache Storage の URL に /api/ がない） | OK |
| Phase 2 | `/api/*`・`/healthz` へのページ遷移を SW が index.html で返さない（§17） | E2E「/api/export・/healthz へのページ遷移は、SW の管理下でも index.html にならない」（page.goto。fromServiceWorker が false・text/html でない・#root がない） | OK |
| Phase 2 | 「更新」を押すと新しい SW に切り替わる | E2E「「更新」を押すと新しい SW に切り替わる」（E2E 用ビルドの sw.js を一時的に書き換え → 待機 → 案内 → 更新 → waiting なし・activated） | OK |
| Phase 2 | manifest の警告がなくインストール可能 | E2E「インストールできる」（CDP の Page.getInstallabilityErrors が空、Page.getAppManifest のエラーなし。§24 D25） | OK |
| Phase 2 | §12 の応答ごとの扱い（409 は後続を止めない、404/410、422/403、401/403 not_member、426、429、5xx・通信エラーの指数バックオフ最大 1 時間、全件同期） | web test/store.test.ts・store-review.test.ts（fake-indexeddb） | OK |
| Phase 2 | S-11 はじめて（2 画面）・S-12・ホームの案内（閉じたら出ない）・この端末からログアウト | E2E「はじめて（色 → 使い方）→ ホームの案内…」（ほかの家族の色は選べない・選んだ色がサーバーに保存される）、E2E「ホーム画面から開いている（インストール済み）ときは…案内を出さない」、E2E「この端末からログアウト（…そのあともオフラインで開ける）」（SW の登録を外して入り直す）、web logout.test.ts（SW の登録の解除・ホーム画面から開いたら永続化を求める） | OK |
| Phase 2 | 全テストで CSP 違反・コンソールエラー 0 件 | e2e/fixtures.ts（auto。すべてのテストで同じ page を監視する。ネットワークを切るテストでだけ、Chromium 自身が出す「Failed to load resource」のうち、意図して失敗させた /api/ への要求のものを許す） | OK |
| Phase 2 | §12 の同期の細則（§24 D28） | store-review.test.ts「SYNC-01」（競合中は編集・削除しない）「SYNC-02」（送らずに戻したら次は全件の取得）「SYNC-04」（削除の取り消しは書き換わった版を使う）「SYNC-05」（再試行でも 429 の待ちは解かない）「SYNC-07」（時計が戻っても順番どおり・待ちの上限）「SYNC-08」 | OK |
| Phase 2 | 本番のビルドに開発用のログイン（X-Dev-Login）が残らない | `pnpm build` のあと apps/web/dist の JS を「X-Dev-Login」「ito.devLogin」で検索 → 0 件 | OK（Phase 7 の T7 のビルド成果物の検査にも入れる） |
| Phase 2 | `pnpm check`・`pnpm test:e2e`・`docker compose build` | `pnpm check`（233 件）、`pnpm test:e2e`（18 件）、`docker compose build` | OK（すべて EXIT=0） |
| Phase 6 | §6 の全画面が §22 の型の props で動く | tsc（ui/ と features/ のコンテナ）、web 単体 phase6.test.ts「ui/types.ts は §22 の型と同じ」、E2E phase6.spec.ts（9 画面＋4 つのシートを開く）、E2E「ギャラリーの全部の状態が、エラーなく描ける」（44 状態） | OK（空き時間の候補・検索の中身は Phase 7、通知の設定・端末は Phase 4、一言の解析は Phase 5、繰り返しの範囲 C-04 は Phase 3 でつなぐ。§22 の型のまま置いた） |
| Phase 6 | §6.2 今日と明日が開いてすぐ見える | E2E「今日と明日の予定が、開いてすぐスクロールなしで見える」（390×844。今日・明日の行がすべて一覧の枠の中） | OK |
| Phase 6 | §6.2 自分だけ 1 タップ | E2E「自分の予定だけを見る: 1 タップ」 | OK |
| Phase 6 | §6.2 日付へ 2 タップ | E2E「特定の日に移動する: 2 タップ（「日付」→ その月の日）、週の帯なら 1 タップ」 | OK（ほかの月は「次の月」で 1 タップ増える。週の帯なら 1 タップ） |
| Phase 6 | §6.2 予定の追加 3 タップ | E2E「予定を追加する: 3 タップ（入力バー → 最近の予定の札 → 保存）」（サーバーに 1 件増える） | OK（「一言を書いて保存」は Phase 5 で後で確認） |
| Phase 6 | §6.2 予定の時刻を直す | E2E「予定の時刻を直す: 詳細の日時 → 時刻の札 → 保存（編集画面を経由しない）」（長さを保って 15:00–15:30） | OK |
| Phase 6 | §6.2 空き → この時間で書く → 保存 | — | 後で確認（Phase 7 で空き時間の候補をつなぐ） |
| Phase 6 | §6.2 家族の追加・変更に気づく | E2E phase2「別のメンバーが追加した予定に「新」が付き…」「背面に回して前面に戻したときも…」 | OK |
| Phase 6 | 「大きめ」の文字でも崩れない | E2E「「大きめ」の文字でも崩れない」（html の文字 18.4px、9 画面＋4 つのシートで横にはみ出さない・縦にスクロールする箱の中の横はみ出しもない）、E2E「ギャラリーの全部の状態で…「大きめ」でも横にはみ出さない」 | OK |
| Phase 6 | ギャラリーと本番画面のスクリーンショットが一致 | E2E「ギャラリーの状態と本番の画面のスクリーンショットが一致する」（見本の予定を API で入れ、page.clock で 2030-09-29 14:18 に止めて、これから・月の `.app-shell` の PNG がバイト単位で同じ） | OK（詳細・書く画面・設定は、サーバーの作成・更新の時刻が実時刻のため比べない） |
| Phase 6 | axe の違反ゼロ | E2E（@axe-core/playwright、WCAG 2.0/2.1 A・AA と 2.2 AA）: 本番の 9 画面＋4 つのシート＋はじめて（ライト・ダーク）、ギャラリーの全 44 状態（ライト・ダーク。C-02・C-03・C-05・案内・他人の非公開・範囲の選択・8 人家族を含む） | OK |
| Phase 6 | CSP 違反ゼロ | e2e/fixtures.ts（全テスト） | OK（フォントが data: URI に埋め込まれて止められたので assetsInlineLimit: 0） |
| Phase 6 | ui/tokens.css の色が §22 と同じ | web 単体 phase6.test.ts「ui/tokens.css の色は §22 の値と同じ」（変数ごとに比べる） | OK |
| Phase 6 | 入力欄の文字 16px 以上・タップ領域 44px 以上 | E2E「入力欄の文字は 16px 以上、タップ領域は 44px 以上」（本番の全画面・シート）、ギャラリーの全状態（ライト・ダーク） | OK |
| Phase 6 | icon.svg から PWA のアイコン | `node scripts/gen-icons.mjs`（@resvg/resvg-js）→ public/icons、E2E「インストールできる」 | OK |
| Phase 6 | ギャラリー・見本・開発用のログインが本番のビルドに入らない | `pnpm build` のあと apps/web/dist の JS を「表示する状態」「__gallery」「X-Dev-Login」「ito.devLogin」「2030-09-29」で検索 → 0 件 | OK（JS は gzip で 184KB。§19 の 200KB 以内） |
| Phase 3 | §21 の繰り返しのテスト一式（第2・第4水曜、月末、2/29 の毎年、COUNT/UNTIL、例外・取り消し、「これ以降」の分割） | core test/recurrence.test.ts（展開・説明文・UI の形・分割と差分・expand の例外と取り消し）、server test/recurrence.test.ts（scope ごとの PATCH・DELETE） | OK |
| Phase 3 | PWA とサーバーで同じ展開結果（同じデータで 3 通り） | core「3 通りの展開で比べるデータ（手で確かめた回と同じ）」、server「3 通りの展開（サーバーの API 経由）」、web phase3.test.ts「3 通りの展開（PWA の viewmodel 経由）」（packages/core/test/fixtures/recurring.ts を共有） | OK |
| Phase 3 | COUNT のシリーズで「これ以降」→ 元は UNTIL だけ・新シリーズは残り回数 | server「COUNT のシリーズ: 元は UNTIL=前の回だけ、新シリーズは残りの回数…」、E2E phase3「繰り返しを書いて…」（COUNT=10 → 元は UNTIL、新は COUNT=9） | OK |
| Phase 3 | 後の回から「すべて」で時刻を変えても前の回が消えない | server「後の回から時刻を変えても、前の回は消えない…」、E2E phase3（3/27 から 12:00 → 3/13 も 12:00） | OK |
| Phase 3 | 時刻ありの UNTIL で最終日の回が残る | core「時刻ありの UNTIL は 23:59:59 にすると最終日の回が残る」、server「rrule は決まった順にし、時刻ありの UNTIL は 23:59:59 にして保存する」 | OK |
| Phase 3 | 「これ以降」で reminder_prefs が引き継がれる | server「COUNT のシリーズ…」（PUT /api/events/:id/reminders → 分割 → 同期の myReminderPrefs に新シリーズの行） | OK |
| Phase 3 | 表示用フィードが例のファイルと繰り返しの回まで一致、例外がフィードに出て ETag が変わる | server feed.test.ts「例のファイルと一致する（…朝練まで含めて）」「「この回だけ変更」「この回だけ削除」がフィードに出て、ETag が変わる」 | OK |
| Phase 3 | 入力制限（HOURLY 以下の拒否、INTERVAL・COUNT の上限、展開の打ち切り） | core「RRULE の検証」「1 回の展開は 2,000 回で打ち切る」「回が出ない規則（毎年 2/31）でも、すぐ終わる」、server「… は 422」 | OK |
| Phase 3 | RecurrenceEndVM（なし／◯回／◯日まで）⇔ COUNT / UNTIL | core「UI の形 ⇔ RRULE」、web「書く画面の繰り返し」 | OK |
| Phase 3 | 画面（書く画面の繰り返し・C-04・オフラインの制限） | E2E phase3.spec.ts（書く画面で毎週・10 回 → この予定だけの時刻 → この予定だけ削除 → これ以降すべて（消える 2 件を C-04 に表示）→ すべて）、「オフラインでは…選べない」、web phase3.test.ts（送信待ち・範囲の計算・月末の問い） | OK |
| Phase 3 | レビューの指摘（§24 D34） | core series.test.ts・recurrence.test.ts、server recurrence.test.ts「Phase 3 のレビューの指摘」・esm-load.test.ts（本物の Node で @ito/core・アプリ・CLI を読み込む）、web phase3.test.ts「範囲（C-04）の計算」「繰り返しの回の送信待ち（Phase 3 のレビュー）」、E2E phase3（件名だけの「これ以降」は元の回の 7:30 から） | OK |
| Phase 3 | `pnpm check`・`pnpm test:e2e`・`docker compose build`・`pnpm dev` | `pnpm check`（Biome＋tsc＋Vitest 385 件）、`pnpm test:e2e`（41 件）、`docker compose build`、`node scripts/check-dev.mjs`（/healthz・/・/api/me が 200） | OK（すべて EXIT=0） |
| Phase 6 | `pnpm check`・`pnpm test:e2e`・`pnpm build`・`docker compose build` | `pnpm check`（261 件）、`pnpm test:e2e`（39 件）、`pnpm build`、`docker compose build` | OK（すべて EXIT=0） |

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
- D28: 同期の細則（競合中は解決まで編集・削除しない、再試行でも 429 の待ちは解かない、時計が戻っても送る順番を守る、送らずに戻したら次は全件の取得、426 で「更新」、ログアウトで SW の登録も外す、ホーム画面から開いたら永続化を求める）
- D29: §22 の型を足す（AppShell の screen・overlay、詳細の children、FieldEditSheet、SyncVM の理由と「更新」）。詳細は開く前の画面の上にシート、書く画面の開け閉めは履歴に積まない
- D30: コントラストと 44px のための見た目の小さな変更。Biome の noDescendingSpecificity は ui/*.css だけ外す
- D31: ギャラリーは開発と E2E 用のビルドだけ。見本（mock-data.ts）を E2E と共有し、同じデータ・固定の時計でスクリーンショットを比べる
- D32: Phase 6 のレビューで決めた画面の細則（見出しの年、まとめの④はボタンだけ、無効の家族だけの回は出さない、スワイプはつまみ・見出しから、テーマの追従は 1 か所、書く画面のほかの日・時刻、履歴・ゴミ箱の状態 ほか）
- D33: 繰り返しの細則（例外行の key、If-Match は親、exceptionId、RRULE の制限と正規化、消える件数、この回だけ削除の取り消し、reminder_prefs の複製、C-04 のオフライン）
- D34: Phase 3 のレビューで決めた繰り返しの細則（差分だけを送る、消える件数の共通の計算、破棄した例外行は消す、毎月の規則の移動、RRULE の並びと比べ方、この回だけ変更の元に戻す、回の送信待ちの 409・404、「この予定だけ」の制限、保存したあとの回へ移る、rrule の ESM）

## 後で足すテスト
- 非公開の漏えい（まだない経路）: 書き出し（JSON・ICS。Phase 7）、Push の文面（Phase 4）、朝のまとめ・前夜の予告（Phase 4）、一言入力の重なりの警告（Phase 5。端末内で作るので他人の非公開は「予定あり」になることを確かめる）、検索（Phase 7。端末内の DB を検索する）
- T7 のビルド成果物の検査（sk-ant）に「X-Dev-Login」「ito.devLogin」「表示する状態」「__gallery」を足す（Phase 7）
- これからの一覧の範囲を、見ている日の前後 8 週に削る（今は広げるだけ。§19 の性能の確認と合わせて Phase 7）

## 要確認（持ち主がやること・確かめてほしいこと。根拠の出力も）
- **Node.js 24 LTS が開発機に入っていない**（管理者権限のインストールは持ち主の作業）。手元の開発・テストは Node 22 で行い、本番のイメージ（node:24-slim）では 24 で動くことを docker compose で確かめている（§24 D19）。
  - 根拠: `node -v` → `v22.21.0`（C:\Program Files\nodejs）。`pnpm` はコマンドとしては無い（`pnpm: command not found`）
  - 持ち主がやること: Node 24 LTS を入れる（入れたあと `pnpm install` をやり直す）。pnpm は corepack で使える（`corepack enable pnpm`、または README のとおりリポジトリ内に shim）
- pnpm は PC 全体には入れず、corepack の shim をリポジトリ内の `.tools/bin`（.gitignore 済み）に置いて使っている（`corepack enable --install-directory .tools/bin pnpm`）。版は package.json の packageManager（pnpm@10.34.5）

## 既知の問題
- E2E のコンソールエラー 0 件の確認では、ネットワークを切るテスト（オフライン・API 遮断・競合・ログアウトのあとのオフライン）と /api/export への遷移のテストに限り、Chromium が自分で出す「Failed to load resource」のうち、意図して失敗させた /api/ への要求のもの（net::ERR_INTERNET_DISCONNECTED / net::ERR_FAILED / status of 409 / /api/export の 4xx）だけを許している（URL で絞る。アプリシェル・アイコンなどの失敗やアプリのエラーは許さない。e2e/fixtures.ts の allowedConsoleErrors）
- E2E を `--repeat-each` で繰り返すと、同じサーバーに同じ件名の予定が残るため 2 回目から件名の重複で落ちる（1 回目はすべて通る。E2E のサーバーは実行のたびに空の DB で始まる。retries は 0）
- vite-plugin-pwa 1.3 が Vite 8 で「inlineDynamicImports option is deprecated」の警告を出す（ビルドは成功する。プラグイン側の問題）
- E2E の phase6.spec.ts は、ギャラリーと本番のスクリーンショットの比較を、見本の予定を変えるテスト（予定の追加・時刻の直し）より先に置いている（同じファイルの中で書いた順に走る。workers: 1）
