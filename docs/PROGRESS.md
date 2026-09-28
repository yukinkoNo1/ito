# 進み具合
今: 最終確認 / 次にやること: RUNBOOK の最終確認のコマンド（pnpm install --frozen-lockfile・pnpm check・pnpm build・pnpm test:e2e・docker compose build・up -d --wait・exec app node dist/cli.js feed-token list・down）→ 受け入れ基準の見直し → 最終報告

## ステップ
| ステップ | 状態（未着手・作業中・完了） | タグ | メモ |
|---|---|---|---|
| Phase 0 土台 | 完了 | phase-0 | レビューの指摘（dist-e2e のコミット、zod の jitless の順番、421/413 の no-store など）を直した |
| Phase 1 予定の中核と表示用フィード | 完了 | phase-1 | レビューの指摘（非公開→公開の履歴の漏えい、通知設定の部分更新、送信待ちの畳み込み、確認スクリプトの後始末）を直した |
| Phase 2 PWA とローカルファースト | 完了 | phase-2 | レビューの指摘（ログアウトで SW の登録が残る、SW を通る遷移のテスト、競合中の編集で自分の変更が消える、送らずに戻した変更のあとの取得、429 の待ち、426 の更新、時計の巻き戻し ほか）を直した |
| Phase 6 UI 統合 | 完了 | phase-6 | Phase 2 の次に行った（§24 D15）。レビューの指摘（シートのスワイプ、テーマの監視の漏れ、自分の非公開の候補、書く画面の日時の範囲、トースト・案内、履歴・ゴミ箱の状態、人の札が 7 個以上、日付をまたぐ行、検査の範囲 ほか）を直した |
| Phase 3 繰り返し | 完了 | phase-3 | レビューの指摘（件名だけ直してもシリーズが動く、C-04 の件数とサーバーの食い違い、リセットした例外の復活、毎月の規則のずれ、回が出ない規則、pnpm dev が rrule の読み込みで起動しない、回の送信待ちの 409 ほか）を直した（§24 D34） |
| Phase 4 通知 | 完了 | phase-4 | レビューの指摘（止めた端末の再購読、まとめ待ちの件名の漏れ、pnpm dev のログアウト、renotify、終日⇔時刻ありの通知 ほか）を直し、修正もレビューして直した（§24 D36） |
| Phase 5 一言入力 | 完了 | phase-5 | 退避した作業を戻し、Anthropic の呼び出しを公式 SDK にした。レビューの 21 件（high 1・medium 11・low 9）を直した（§24 D37） |
| Phase 7 仕上げ | 完了 | phase-7 | 空き時間・検索・書き出し・バックアップと掃除・同期と静的の gzip・これからの一覧の範囲・ビルドの検査・性能・security-map。レビューの 16 件を直した（§24 D38） |
| 総点検 | 完了 | audit | 5 つの観点（本人確認・CSRF と XSS と SW・非公開・フィード・入力と秘密とコンテナ）で攻撃の経路を洗い出し、反証できなかった 18 件（高 2・中 5・低 11）を再現テストを書いてから直した（docs/security-review.md、§24 D39） |
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
| Phase 0 | GET には CSRF 検査が掛からない | middleware.test.ts「ホーム画面・通知から開くとき…のページの遷移（/api の外）には CSRF の検査を掛けない」 | OK（総点検で §14 の 4. を改めた: /api/* の GET も X-Ito-Client と same-origin が要る。ページの遷移には掛けない。§24 D39） |
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
| Phase 6 | §6.2 空き → この時間で書く → 保存 | E2E phase7.spec.ts「§6.2 みんなが空いている時間に予定を入れる…」 | OK（Phase 7 で確認） |
| Phase 6 | §6.2 家族の追加・変更に気づく | E2E phase2「別のメンバーが追加した予定に「新」が付き…」「背面に回して前面に戻したときも…」 | OK |
| Phase 6 | 「大きめ」の文字でも崩れない | E2E「「大きめ」の文字でも崩れない」（html の文字 18.4px、9 画面＋4 つのシートで横にはみ出さない・縦にスクロールする箱の中の横はみ出しもない）、E2E「ギャラリーの全部の状態で…「大きめ」でも横にはみ出さない」 | OK |
| Phase 6 | ギャラリーと本番画面のスクリーンショットが一致 | E2E「ギャラリーの状態と本番の画面のスクリーンショットが一致する」（見本の予定を API で入れ、page.clock で 2030-09-29 14:18 に止めて、これから・月の `.app-shell` の PNG がバイト単位で同じ） | OK（詳細・書く画面・設定は、サーバーの作成・更新の時刻が実時刻のため比べない） |
| Phase 6 | axe の違反ゼロ | E2E（@axe-core/playwright、WCAG 2.0/2.1 A・AA と 2.2 AA）: 本番の 9 画面＋4 つのシート＋はじめて（ライト・ダーク）、ギャラリーの全 44 状態（ライト・ダーク。C-02・C-03・C-05・案内・他人の非公開・範囲の選択・8 人家族を含む） | OK |
| Phase 6 | CSP 違反ゼロ | e2e/fixtures.ts（全テスト） | OK（フォントが data: URI に埋め込まれて止められたので assetsInlineLimit: 0） |
| Phase 6 | ui/tokens.css の色が §22 と同じ | web 単体 phase6.test.ts「ui/tokens.css の色は §22 の値と同じ」（変数ごとに比べる） | OK |
| Phase 6 | 入力欄の文字 16px 以上・タップ領域 44px 以上 | E2E「入力欄の文字は 16px 以上、タップ領域は 44px 以上」（本番の全画面・シート）、ギャラリーの全状態（ライト・ダーク） | OK |
| Phase 6 | icon.svg から PWA のアイコン | `node scripts/gen-icons.mjs`（@resvg/resvg-js）→ public/icons、E2E「インストールできる」 | OK |
| Phase 6 | ギャラリー・見本・開発用のログインが本番のビルドに入らない | `pnpm build` のあと apps/web/dist の JS を「表示する状態」「__gallery」「X-Dev-Login」「ito.devLogin」「2030-09-29」で検索 → 0 件 | OK（Phase 6 のとき JS は gzip で 184KB。Phase 7 で 1 本のままだと 218KB になったので、開いたときに読む画面を分け、初回表示を 197KB にした。`scripts/check-dist.mjs` がいつも測る） |
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
| Phase 4 | §21 の通知のテスト一式（開始時・当日 7:00・前日 20:00／同じ回は二度送らない／動かしたら新しい時刻で送る／5xx のあと 10 分以内に再送・過ぎたら諦める／朝のまとめと前夜の予告が両方届く／静かな時間と 2 分まとめ） | server test/notify.test.ts（偽の時計と記録するだけの送信）「予定の通知」「朝のまとめ・前夜の予告」「家族の変更」、core test/notify.test.ts（通知の時刻・送る範囲・静かな時間・キー） | OK |
| Phase 4 | 非公開の通知文（持ち主以外は「予定あり」） | server notify.test.ts「非公開: 持ち主には件名で送り…」「朝のまとめ…（10:00 予定あり）」「持ち主は自分の非公開の件名をまとめで見られる」「mine は…他人の非公開は「予定あり」」 | OK |
| Phase 4 | メンバー無効化で購読が消える | server notify.test.ts「無効化したメンバーには送らない（購読も消える）」「削除は本人と管理者だけ…」 | OK |
| Phase 4 | 購読 API（端末の一覧・削除・管理者の一括削除・endpoint を返さない）、テスト通知、TTL と urgency、ロック画面の表示、404/410・fail_count、再起動後の 10 分 | server notify.test.ts「購読の API」「予定の通知」、E2E phase4.spec.ts「設定: 通知を受け取る端末の一覧から止められる…」「家族の管理: この人の端末の通知を止める」 | OK |
| Phase 4 | 起動・前面復帰の購読の確認と再購読、最初の await が requestPermission、ログアウトで購読を解除 | web test/phase4.test.ts「購読（§15）」、logout.test.ts | OK |
| Phase 4 | SW の push（showNotification の前に await を置かない・読めない中身でも出す・url は同一オリジンのパスだけ）・バッジ | web phase4.test.ts「SW の push の中身」、E2E phase4-push.spec.ts（DevTools の deliverPushMessage で届けて getNotifications で確かめる） | OK |
| Phase 4 | ホームの案内（F-23 のうち通知）と iPhone の未インストールの分岐 | web phase4.test.ts「ホームの案内（F-23 のうち通知）と通知の許可の状態」 | OK |
| Phase 4 | reminder_prefs と既定値（詳細・書く画面の自分への通知） | E2E phase4.spec.ts「詳細の「自分への通知」で選ぶと保存され…」、web phase4.test.ts「自分への通知の保存」「端末の一覧・自分への通知の VM」 | OK |
| Phase 4 | 実機確認の手順を README に | README「通知（Web Push。SPEC §15）」の「実機での確認の手順」 | OK（実機での確認は「要確認」） |
| Phase 4 | レビューの指摘（§24 D36） | web phase4.test.ts「ログアウト・この端末の削除のあとは…」「購読を確かめているあいだに止めたら…」「画面を開いたときに鍵が取れていなければ…」「書く画面: 終日⇔時刻ありを切り替えたら…」「送れていない自分への通知があるうちは…」、logout.test.ts、phase3.test.ts「最初の回の「これ以降すべて」の変更は…」、server notify.test.ts「2 分以内に非公開にしたら…」「担当から外したら…」「送る前に…」「別の人の変更は…」「送っているあいだに…」「「この回だけ」の変更は…」「シリーズ全体を変えても…」「送信の結果の扱い」（5 件）、core「offsetLabel」（翌日 0:00）、E2E phase4.spec.ts「書く画面の自分への通知」2 件 | OK |
| Phase 4 | `pnpm check`・`pnpm test:e2e`・`docker compose build`・`up -d --wait` | 修正後（Node 24.21.0）: `pnpm check`（Vitest 462 件）、`pnpm test:e2e`（47 件）、`docker compose build`・`up -d --wait`・`exec app node dist/cli.js feed-token list`・`down`。修正前: `pnpm check`（Vitest 444 件）、`pnpm test:e2e`（45 件）、`docker compose build`・`up -d --wait`（healthz 200、ログに push disabled が出ない＝鍵で push が有効）・`down` | OK（すべて EXIT=0） |
| Phase 5 | ルール解析 38 件（§21 の表） | core test/nlp-rules.test.ts（fixtures/nlp-cases.ts。偽の時計 2026-09-27 14:18） | OK |
| Phase 5 | AI 応答の差し替え（正常・形の不正・refusal・max_tokens・タイムアウト・HTTP エラー → ルール解析へ） | server test/parse.test.ts「POST /api/parse」「Anthropic の呼び出し」（公式 SDK の fetch を差し替え。タイムアウトは SDK が止める） | OK |
| Phase 5 | 入力文がログ・DB・エラー応答に残らない | server parse.test.ts「入力文はログ・DB・エラー応答に残らない」 | OK |
| Phase 5 | スキーマの member_keys は m1〜mN（実名を入れない）、送るのは入力文・日付表・呼び名だけ、大文字小文字を無視 | server parse.test.ts | OK |
| Phase 5 | 日本語入力の変換確定の Enter で送信しない | E2E phase5.spec.ts「日本語入力の変換確定の Enter（isComposing・keyCode 229）では確認へ進まない」 | OK |
| Phase 5 | 一言で書いて保存 → これから・月に出る（§21 の E2E） | E2E phase5.spec.ts「一言（ルール解析）で書いて保存すると…」（入力バー → 一言 → 保存） | OK |
| Phase 5 | 重なりの警告（他人の非公開は「予定あり」） | web test/phase5.test.ts「重なりの警告」 | OK |
| Phase 5 | レビューの指摘（§24 D37 (10)） | core nlp-rules.test.ts「ルール解析のレビューの指摘（Phase 5）」（10 件）・「呼び名は長い順に…」、server parse.test.ts「Phase 5 のレビューの指摘」（3 件）、web phase5.test.ts「一言と札の組み合わせ」「重なりの警告の範囲」、E2E phase5.spec.ts「非公開の「最近の予定」を…」 | OK |
| Phase 5 | `pnpm check`・`pnpm test:e2e`・`docker compose build`・`up -d --wait` | `pnpm check`（Vitest 554 件）、`pnpm test:e2e`（50 件）、`docker compose build`・`up -d --wait`・`exec app node dist/cli.js feed-token list`・`down` | OK（すべて EXIT=0） |
| Phase 6 | §6.2「一言を書いて保存」の手数 | E2E phase5.spec.ts（入力バーを押す → 一言を書く → 「…に保存」を押す。タップは 2 回） | OK（Phase 5 で確認） |
| Phase 7 | 空き時間（core/freebusy。夜・休日・終日、今日は切り上げた今より後、busy=false は除く、他人の非公開は中身なしでふさぐ、終了なしは 60 分、日付をまたぐ予定は翌日も） | core test/freebusy.test.ts（11 件）、web phase7.test.ts「空き時間の VM」 | OK |
| Phase 7 | §6.2 空き → この時間で書く → 保存 | E2E phase7.spec.ts「§6.2 みんなが空いている時間に予定を入れる…」（空き → 「この時間で書く」→ 一言 → 保存。候補の日時で保存される） | OK（Phase 6 の「後で確認」を確かめた） |
| Phase 7 | 検索（件名・場所・メモ、人で絞り込み、最近の検索語、他人の非公開は出ない） | web phase7.test.ts「検索（§6 S-10）」（6 件）、E2E phase7.spec.ts「検索: …」 | OK |
| Phase 7 | 書き出し JSON・ICS（VTIMEZONE、終日の DTEND は翌日、例外は RECURRENCE-ID、他人の非公開は含めない） | server export.test.ts（9 件）、web phase7.test.ts「書き出し（§17）」、E2E phase7.spec.ts「書き出し」（JSON はダウンロード、ICS は iPhone の共有シート） | OK（iPhone のカレンダーへの取り込みは要確認） |
| Phase 7 | バックアップと掃除（14 世代のローテーション） | server maintenance.test.ts（掃除・VACUUM INTO・14 世代・スケジューラの時刻） | OK |
| Phase 7 | 性能: 1 年分の同期サイズ・表示用フィード（20KB 未満・100ms 未満・304）・60fps（50ms を超える long task なし） | server perf.test.ts（約 2,200 行で gzip の転送量 1MB 未満、フィード 3 日分）、E2E phase7.spec.ts「§19 これからの一覧…」（毎日 8 本＋毎週 4 本の 1 年分でスクロール。範囲を足して削り、long task なし） | OK（§24 D38 (5) (6)） |
| Phase 7 | T7 ビルド成果物の検査 | `pnpm build` の最後の `scripts/check-dist.mjs`（見つけたら EXIT=1。わざと入れた X-Dev-Login を見つけることを確かめた） | OK |
| Phase 7 | §18 の表の対応表 | docs/security-map.md | OK |
| Phase 7 | 依存の監査 | `pnpm audit --prod`（0 件）、`pnpm audit`（drizzle-kit の中の esbuild の moderate 1 件。開発用の道具でバンドルに入らない） | OK（既知の問題に記録） |
| Phase 7 | レビューの指摘（§24 D38 (8)〜(11)） | web phase7.test.ts（検索の今日の境目・回ごとの絞り込み・他人の非公開・全員の予定、メモのリンク、これからの一覧の範囲）、server maintenance.test.ts（失敗したバックアップの書きかけ・ログの項目）、static.test.ts（gzip）、E2E phase7.spec.ts（今日に戻る・位置が飛ばない・メモのリンク）、`pnpm build` の check-dist（初回表示の JS 197KB） | OK |
| Phase 7 | `pnpm check`・`pnpm build`・`pnpm test:e2e`・`docker compose build`・`up -d --wait` | `pnpm check`（Vitest 603 件）、`pnpm build`（check-dist: 初回表示の JS 198KB）、`pnpm test:e2e`（56 件）、`docker compose build`（Docker の中でも check-dist）・`up -d --wait`・`exec app node dist/cli.js feed-token list`・`down`、Docker の中でバックアップと掃除が動く（/data/backups/ito-20260928.db、uid 10001） | OK（すべて EXIT=0） |
| 総点検 | 観点ごとの洗い出し（本人確認・CSRF・非公開・フィードと連携キー・XSS・SW・入力・秘密情報・コンテナ・依存） | 書き換えなしのサブエージェントが洗い出し、指摘ごとに別のエージェントが反証を試みる → docs/security-review.md（ID・深刻度・経路・再現テスト・修正コミット・残るリスク） | OK（反証できなかった 18 件（高 2・中 5・低 11）をすべて直した。却下 5 件。未検証は A4 の通信の長さの測定だけ） |
| 総点検 | 疑わしい点ごとに失敗する再現テストを書いてから直す | server audit.test.ts（A1〜A11・A6・B3・B5）、audit-routes.test.ts、core recurrence-cost.test.ts（B1）・ids-text.test.ts（A6・B5）・notify.test.ts（B4）、server notify.test.ts（B2・B4）・perf.test.ts（B1）・architecture.test.ts（A12・B6）、web phase7.test.ts（A5）・phase4.test.ts（B4）、E2E phase2.spec.ts（A5） | OK |
| 総点検 | CSRF をルートの一覧から機械的に確かめる | server audit-routes.test.ts（状態を変える全ルート × 6 通りの壊し方で 403 csrf、GET の /api も 4 通りで 403、/api の外は GET /healthz だけ、ID ヘッダなしは 401、フィードは ID ヘッダだけでは 401） | OK |
| 総点検 | Tailscale のポリシーを手で確かめる手順を README に書く | README「設置したあとの確かめ方（アクセス制御）」 | OK（確かめるのは持ち主。要確認） |
| 総点検 | 依存の監査 | `pnpm audit --prod`（EXIT=0、0 件）、`pnpm audit`（EXIT=0。受け入れた drizzle-kit の esbuild の 1 件だけを外す） | OK |
| 総点検 | コンテナ（非 root・読み取り専用・cap_drop・app.env） | `docker compose build`・`up -d --wait`・`exec app id`（uid=10001）・/app に書けない・CapEff 0・NoNewPrivs 1・待ち受けは 127.0.0.1:8787 だけ・イメージに .env なし・`feed-token list`・`feed-check-inner.mjs`（401/200/401）・`down` | OK（すべて EXIT=0） |
| 総点検 | `pnpm check`・`pnpm build`・`pnpm test:e2e` | `pnpm check`（Vitest 643 件）、`pnpm build`（check-dist: 初回表示の JS 199KB）、`pnpm test:e2e`（56 件中 55 件。「§19 これからの一覧…long task」が 52ms で落ちた。原因を調べて直した（§24 D40）あとは 56 件とも通る） | OK |
| 総点検 | 修正のレビュー（1 回目） | 総点検の修正（32fce57）を 3 観点で別のエージェントがレビューし、指摘ごとに反証 → 確かめられた 10 件（C1〜C10。高 1・中 3・低 6）を、失敗する再現テストを書いてから直した（bad774b。docs/security-review.md「修正のレビュー（1 回目）」、§24 D41） | OK（core recurrence-cost.test.ts・ids-text.test.ts、server audit.test.ts「C5〜C10」・notify.test.ts「C4」「C8」・perf.test.ts・architecture.test.ts、`node scripts/check-dev.mjs` EXIT=0） |
| 総点検 | 修正のレビュー（2 回目） | 1 回目の直し（bad774b）を同じやり方でレビュー → 確かめられた 10 件（2 回目の D1〜D10。高 1・中 2・低 7）を、失敗する再現テストを書いてから直した（93bdb5d。docs/security-review.md「修正のレビュー（2 回目）」、§24 D41） | OK（core recurrence-cost.test.ts（形からの判定と周期をたどる判定の比べ・COUNT の毎月・毎年の乱数の比べを含む）、server notify.test.ts「D5」・audit.test.ts「D6」、web phase7.test.ts「D8」「D10」、E2E phase7.spec.ts「§19 端で読み足している最中に「次の週」で移っても…」） |
| 総点検 | 修正のレビュー（3 回目） | 2 回目の直し（93bdb5d）をレビュー → 確かめられた 4 件（E1〜E4。中 2・低 2）を、失敗する再現テストを書いてから直した（045c38d。docs/security-review.md「修正のレビュー（3 回目）」、§24 D41） | OK（core recurrence-cost.test.ts「E1」「E2」、E2E phase7.spec.ts「§19 …「次の週」で移っても…」（直しを外すと落ちることを確かめた）、web phase7.test.ts「sortMembersKeepingSame」、architecture.test.ts「useMembers は…」） |
| 総点検 | 修正のレビュー（4 回目） | 3 回目の直し（045c38d）をレビュー → 確かめられた 6 件（F1〜F6。高 1・中 3・低 2）を直した（752d180・2316e6f・5e0262d。繰り返しの予定の上限、E1・E2 のテストは仕事の数で確かめる。docs/security-review.md「修正のレビュー（4 回目）」、§24 D41 (13)） | OK（server audit.test.ts「F1・F2 …」、core recurrence-cost.test.ts「E1」「E2」（直しを外すと落ちることを確かめた）「F1」「F2」） |
| 総点検 | 修正のレビュー（5 回目） | 4 回目の直しをレビュー → 確かめられた 6 件（G1〜G6。中 2・低 4）を、失敗する再現テストを書いてから直した（982819a。繰り返しの上限は持ち主ごとに 100 件、検索は文字で絞ってから展開、BYSETPOS は 7 個まで、ゴミ箱から戻せない理由を出す。docs/security-review.md「修正のレビュー（5 回目）」、§24 D41 (13)〜(16)） | OK（server audit.test.ts「G1 …」「持ち主の繰り返しが 100 件あるとき…」、web phase7.test.ts「G2」「G4」、core recurrence-cost.test.ts「G3」「E1」） |
| 総点検 | 修正のレビュー（6 回目） | 5 回目の直しをレビュー → 確かめられた 2 件（H1・H2。低 2）を、失敗する再現テストを書いてから直した（検索は合うシリーズを今日から広げる窓で展開し、行ごとに 1 回だけ確かめる。繰り返しの上限は終わっていないもの 100 件・終わったものを含めて 400 件。docs/security-review.md「修正のレビュー（6 回目）」、§24 D41 (17)(18)）。深刻度が下がりきったのでレビューはここで止めた | OK（web phase7.test.ts「…6 回目 H1」3 件、server audit.test.ts「H2 …」2 件、core recurrence-cost.test.ts「…6 回目）H2…」） |
| 総点検 | E2E の long task（52ms で落ちた 1 件）の原因を調べて直す | Chrome のトレースと CPU プロファイル（一時的な調べるための spec。調べたあとに消した）→ 端で足すたびに 140 日分を組み立て直して描き直すタスクと描画のタスクが 50ms すれすれ → 変わらない日を描き直さない・日ごとにレイアウトと描画を閉じ込める・位置の合わせ直しを次の描画の直前に（§24 D40）。しきい値と測り方は変えていない | OK（同じ測り方で最大 52.3ms → 34.7ms、描画のタスクはなくなった。web phase7.test.ts「これからの一覧の描き直しを小さくする」、`pnpm test:e2e` 56 件） |
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
- D35: 通知の細則（この端末の印、送信の記録と再送、まとめ・予告、家族の変更のまとめ待ち、通知の文と url、テスト通知、鍵がないとき、自分への通知の候補と保存、SW の知らせ、E2E の push）
- D36: Phase 4 のレビューで決めた通知の細則（自分で止めた印、まとめ待ちの件名の見え方と消し方・同じ人だけまとめる・読んだ行だけ片づける、renotify、終日⇔時刻ありの通知と行の書き換え、最初の回の「これ以降」、公開鍵の状態と文言、ready を待たない、翌日 0:00）
- D38: 仕上げの細則（空き時間は今日から、検索の範囲と並び、書き出しは fetch だけ・JSON と ICS の形、バックアップと掃除の時刻、同期の gzip、これからの一覧は 140 日まで、ビルドの検査）
- D39: 総点検で決めたこと（/api/* の GET も X-Ito-Client と same-origin、本文を読んでから本人を確かめる・家族の管理は確かめ直す、名前の見えない文字、「これ以降」で公開・非公開にしたときの履歴と消した例外、フィードの人の端末の判定と失敗の WARN、SW の遷移の除外、設置後の確認で連携キーをコマンドラインに書かない、回の出ない繰り返しを拒み開始を送って展開する、Web Push の送り先はプッシュサービスだけ・1 人 10 台・送信の締め切り、変更・削除・復元は 120 件/分・取り消した回は 1000 まで、1 文字と全体の長さ、依存の監査は開発用も含む）
- D40: これからの一覧の描き直しを小さくする（文脈と家族の一覧を中身が変わったときだけ作り直す、変わらない日は描き直さない、日ごとにレイアウトと描画を閉じ込める、位置の合わせ直しは次の描画の直前）
- D41: 総点検の修正のレビューで決めたこと（COUNT の規則の展開、回の出ない期間の検査の省き方と覚え方、範囲の外の日付、BYSETPOS の重複、「これ以降」で非公開にしたときのまとめ待ち、フィードの失敗の WARN のタイマー、途中で切れた本文、端末の引き継ぎ、名前を比べる鍵）
- D37: 一言入力の細則（found と reason、先に選んだ日を残す、回数制限はルール解析、AI の出力の検証、公式 SDK・再試行なし、例の作り方、時間帯、重なりの警告、ai:eval）

## 後で足すテスト
- （Phase 7 ですべて足した）書き出し（JSON・ICS）と検索の非公開の漏えい（export.test.ts・phase7.test.ts）、T7 のビルド成果物の検査（scripts/check-dist.mjs）、これからの一覧の範囲（MAX_FLOW_DAYS と E2E）

## 要確認（持ち主がやること・確かめてほしいこと。根拠の出力も）
- **本番の設置とアクセス制御（Tailscale のポリシー）の確かめ**（SPEC §18 T1・T2・T12・T16、§20）。管理画面と実際の tailnet が要るので持ち主の作業。
  - 根拠: 手元では compose の設定（カーネルモード・network_mode・127.0.0.1・AllowFunnel: false）を `docker compose config`・`docker inspect` で確かめ、アプリ側の ID ヘッダ・CSRF・連携キーの検査はテスト（server audit-routes.test.ts ほか）で確かめた。ACL と、別の端末から :8787 に届かないことは実物がないと確かめられない
  - 持ち主がやること: README「本番の立て方」のとおりに設置し、「設置したあとの確かめ方（アクセス制御）」の 4 項目を行う。ホスト名・tailnet 名に家族の名前を使わない
- **いえボードとつなぐ（連携キーの発行）**（SPEC §13.1・§20）。本物の連携キーは本番のサーバーで作り、いえボードの設定に書く必要があるので持ち主の作業（こちらでは本物の秘密情報を使わない）。
  - 根拠: 手元と Docker で、キーを表示しないスクリプトが キーなし 401・キーあり 200・止めたあと 401 を確かめた（`docker compose exec -T app node --input-type=module - < ../scripts/feed-check-inner.mjs`）。`feed-token list` はキーを出さない（EXIT=0）
  - 持ち主がやること: 本番で `docker compose exec app node dist/cli.js feed-token create --name いえボード` → 出たキーをいえボードの `config/secrets.yaml` に書く（README「いえボードとつなぐ」）。いえボードは `tag:ieboard` の端末で動かす
- **ICS を iPhone のカレンダーに取り込む**（SPEC §23 Phase 7）。実機が要るので持ち主の作業。
  - 根拠: 形は server export.test.ts（VTIMEZONE・終日の DTEND・RRULE の UTC の UNTIL・EXDATE・RECURRENCE-ID・75 オクテットの折り返し）と E2E phase7.spec.ts（iPhone の共有シートに VCALENDAR を渡す）で確かめた
  - 持ち主がやること: 設定 →「予定を書き出す」→「ICS（カレンダーに取り込む）」→ 共有シートでカレンダーに追加し、繰り返し・終日・この回だけ変更した回が正しく出るかを見る
- **一言入力の AI の評価（`pnpm ai:eval`）**（SPEC §16・§21、RUNBOOK Phase 5）。本物の ANTHROPIC_API_KEY が要るので持ち主の作業（こちらでは本物の鍵を使わない）。
  - 根拠: `pnpm ai:eval` は鍵がなければ何もせずに終わる（「ANTHROPIC_API_KEY がないので実行しません」）。AI の呼び出しの形・失敗の扱いは server parse.test.ts で確かめた
  - 持ち主がやること: `ANTHROPIC_API_KEY=sk-ant-... pnpm ai:eval`（PowerShell なら `$env:ANTHROPIC_API_KEY='...'; pnpm ai:eval`）で、§21 の表の 38 件と期待値の差を見る。本番の `app.env` に鍵を書けば一言入力が AI で解析される
- **通知の実機での確認**（iPhone でホーム画面に追加 → 通知オン → テスト通知 → 5 分後の予定の通知 → 1 日アプリを開かなくても翌朝のまとめ）。実機と本物の Push サービス（Apple）が要るので、持ち主の作業。
  - 根拠: 手元の確認は偽の送信（server notify.test.ts）と、ブラウザの SW に DevTools で push を届ける E2E（phase4-push.spec.ts）まで。E2E のサーバーには VAPID の鍵を置いていない（本物の Push サービスに送らないため）。Docker では開発用の鍵で push が有効になることを確かめた（ログに push disabled が出ない）
  - 持ち主がやること: 本番の `app.env` に VAPID の鍵と `VAPID_SUBJECT`（mailto: か https:）を書き、README「通知（Web Push）」の「実機での確認の手順」を行う
- （解決済み）Node.js 24 LTS: 持ち主が入れた（2026-09-28 に `node -v` → `v24.21.0`）。`pnpm install` をやり直し（EXIT=0、lockfile は変わらず）、better-sqlite3 が Node 24 で読み込めることを確かめた。Phase 4 の締め（phase-4）からの確認はすべて Node 24
- pnpm は PC 全体には入れず、corepack の shim をリポジトリ内の `.tools/bin`（.gitignore 済み）に置いて使っている（`corepack enable --install-directory .tools/bin pnpm`）。版は package.json の packageManager（pnpm@10.34.5）

## 既知の問題
- `pnpm audit` で drizzle-kit（マイグレーションを作る開発用の道具）の中の esbuild（<=0.24.2 の開発サーバーの問題。GHSA-67mh-4wv8-2f99）が moderate 1 件。開発用の道具で、バンドル・Docker のイメージに入らず、esbuild を開発サーバーとして動かさないので受け入れる（drizzle-kit の更新で解消する）
- （解決済み。§24 D40）E2E の「§19 これからの一覧…long task」が総点検の途中で 1 回 52ms で落ちた。Chrome のトレースで調べると、端で足すたびに 140 日分を組み立て直して描き直すタスク（39〜50ms）と、そのあとの描画のタスク（44〜52ms）が 50ms すれすれで、揺れではなく余裕がなかった（文脈と家族の一覧が描き直しのたびに新しいオブジェクトになり、関係のない描き直しでも一覧を組み立て直していたのも一因）。変わらない日を描き直さない・日ごとにレイアウトと描画を閉じ込める・位置の合わせ直しを次の描画の直前に移す、で直した。同じ測り方で最大 34.7ms、描画のタスクはなくなった。しきい値と測り方は変えていない
- 初回表示の JS は gzip で 199KB（§19 の上限 200KB に近い。総点検で core に展開の検査を足したため）。これ以上足すときは、開いたときに読む画面にさらに分ける
- テストの購読の送り先を、プッシュサービスの形（https://fcm.googleapis.com/fcm/send/…・https://web.push.apple.com/…）に変えた（総点検 B4 で送り先をプッシュサービスに限ったため。確かめる中身は同じ）
- テストを直したもの（総点検の修正のレビュー 6 回目）: server audit.test.ts の seedSeries に規則と開始日を渡せるようにし、ID は呼ぶたびに続きから振るようにした（H2 のテストで 1 つのテストの中から何度も呼ぶため。前からのテストの確かめる中身は同じ）
- テストを直したもの（総点検の修正のレビュー 5 回目）: server audit.test.ts の「500 件あるとき…」を「持ち主の繰り返しが 100 件あるとき…」に書き換えた（上限を家族全体の 500 件から持ち主ごとの 100 件に変えたため。家族全体で数えるのは G1 の締め出しの穴だった。§24 D41 (13)）。core recurrence-cost.test.ts の上限いっぱいのテストを 500 本から 800 本（1 人 100 件 × 8 人）にした
- テストを直したもの（総点検の修正のレビュー 2 回目）: server notify.test.ts の C8 のテストを「上限の中なら引き継ぎ、上限なら前の持ち主から外して 409」に書き換えた（1 回目の直し「引き継ぎは数えない」が、2 人がかりで上限を超えられる穴だったため。§24 D41 (8)）。core recurrence-cost.test.ts の比べる正解（素の rrule）で、同じ日時は 1 つにまとめるようにした（展開は BYSETPOS の重複を 1 回にするため。§24 D41 (4)）
- テストを直したもの（総点検の修正のレビュー）: server notify.test.ts「1 人の購読は 10 台まで…」の「ほかの家族の端末を引き継ぐときも数える（409）」を外し、「ほかの家族の端末を引き継ぐ…ときは台数に数えない…」を足した（前の期待は C8 の不具合そのものだった。§24 D41 (8)）
- テストを直したもの（総点検）: server middleware.test.ts の「GET には CSRF の検査を掛けない（クロスサイトの Origin・Sec-Fetch-Site でも 200）」「ホーム画面・通知から開くとき（Sec-Fetch-Site: none、Origin なし）の GET も通る」を、§24 D39 の新しい決まり（/api/* の GET は X-Ito-Client と same-origin が要る・ページの遷移には掛けない）を確かめるテストに書き換えた（前の決まりそのものが A3・A4 の穴だった）。export.test.ts の「X-Ito-Client がない」要求は、テストの send() が GET にも X-Ito-Client を付けるようにしたので、明示して外した（確かめる中身は同じ）。E2E phase2.spec.ts で許すコンソールエラーを、/api/export だけから /api と /%61pi への遷移の 4xx に広げた（A5 で遷移の形を足したため。URL で絞っている）
- テストを直したもの（Phase 7）: server static.test.ts の /api/export へのページ遷移を 404 から 403 に（経路がなかったときの状態コードを期待していた。確かめたいのは index.html にならないことで、それは変えていない）
- E2E のコンソールエラー 0 件の確認では、ネットワークを切るテスト（オフライン・API 遮断・競合・ログアウトのあとのオフライン）と /api/export への遷移のテストに限り、Chromium が自分で出す「Failed to load resource」のうち、意図して失敗させた /api/ への要求のもの（net::ERR_INTERNET_DISCONNECTED / net::ERR_FAILED / status of 409 / /api/*・/%61pi/* へのページ遷移の 4xx）だけを許している（URL で絞る。アプリシェル・アイコンなどの失敗やアプリのエラーは許さない。e2e/fixtures.ts の allowedConsoleErrors）
- E2E を `--repeat-each` で繰り返すと、同じサーバーに同じ件名の予定が残るため 2 回目から件名の重複で落ちる（1 回目はすべて通る。E2E のサーバーは実行のたびに空の DB で始まる。retries は 0）
- vite-plugin-pwa 1.3 が Vite 8 で「inlineDynamicImports option is deprecated」の警告を出す（ビルドは成功する。プラグイン側の問題）
- E2E の phase6.spec.ts は、ギャラリーと本番のスクリーンショットの比較を、見本の予定を変えるテスト（予定の追加・時刻の直し）より先に置いている（同じファイルの中で書いた順に走る。workers: 1）
