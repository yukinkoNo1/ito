# Phase 7 — 仕上げ 計画

読む章: §5 F-18〜F-20、§6 S-06・S-10、§13（/api/export）、§15 の掃除とバックアップ、§17（書き出しのダウンロード）、§18、§19、§21、§22 FreeTimeVM・SearchGroupVM、§23 Phase 7、RUNBOOK 3.・7. Phase 7

## 1. core
- `freebusy.ts`（`@ito/core/freebusy`）: プリセット（夜 17–24・休日 土日祝 8–24・終日 6–24）、今日は 30 分単位に切り上げた今より後、昨日までは候補にしない、busy=false は除く、他人の非公開は中身なしでふさぐ、終了なしは 60 分、日付をまたぐ予定は翌日も、全員の予定は選んだ家族みんなをふさぐ。候補は日付の順に最大 5 件（長さの条件以上）。テスト: core freebusy.test.ts

## 2. server
- `services/export.ts`・`routes/export.ts`: GET /api/export?format=json｜ics。他人の非公開（例外行も）を除く。ICS は VTIMEZONE(Asia/Tokyo)、終日の DTEND は翌日、例外は RECURRENCE-ID 付きの VEVENT、取り消しは EXDATE、時刻ありの UNTIL（浮動時刻）は UTC に、75 オクテットの折り返し・エスケープ。GET でも X-Ito-Client を求め、ページ遷移・別のサイトからは 403（§13「ページ遷移で開かない」）
- `services/maintenance.ts`: 掃除（ゴミ箱 30 日・changes 90 日・notification_log 60 日・idempotency 48 時間・ai_usage 90 日・activity 1 年、送ったまとめ待ち 7 日）とバックアップ（VACUUM INTO .tmp → 名前を変える、BACKUP_KEEP 世代）。スケジューラ（scheduler.ts）が 3:30・4:00 を過ぎたら 1 日 1 回（止まっていた日は動き出したとき）
- `/api/sync` を gzip で送る（hono/compress）
- テスト: export.test.ts・maintenance.test.ts・perf.test.ts（1 年分の同期の転送量、フィードの大きさ・時間・304）

## 3. web
- 空き時間（S-06）: `viewmodels/free.ts`（freeBusy → FreeTimeVM）と FreeContainer（今日から 7 日、「この時間で書く」で日時入りの書く画面）
- 検索（S-10）: `viewmodels/search.ts`（端末の DB で件名・場所・メモの部分一致、NFKC、AND、他人の非公開は探さない、前後 1 年、繰り返しはシリーズごとに 1 回、これからの回を近い順→過ぎた回を新しい順、最大 50 件）と SearchContainer（最近の検索語は端末に 5 つ、結果を開いたときに覚える）
- 書き出し: `pwa/export.ts`（`data/api.ts` の apiFile で fetch → Blob。iPhone は navigator.share({ files })、ほかは `<a download>`）、設定の「予定を書き出す」
- これからの一覧（§19）: 端で足したら反対側を削り、一度に描くのは 140 日（前後 8 週＋足した 4 週）まで（FlowContainer の MAX_FLOW_DAYS）。見ていた行は UpcomingScreen が行の key で同じ位置に戻す（Safari にはスクロールアンカーがない）
- テスト: web phase7.test.ts、E2E phase7.spec.ts（§6.2 の空き→書く→保存、検索、書き出し JSON・ICS、1 年分の予定のスクロールで 50ms を超える long task なし・範囲を足して削る）

## 4. 検査・文書
- `scripts/check-dist.mjs`: `pnpm build` の最後に、本番のビルドに秘密情報の形（sk-ant・連携キー・秘密鍵）と開発・E2E 用のもの（X-Dev-Login・ギャラリー・見本の日付）がないことを確かめる（§18 T7。Docker のビルドでも動く）
- `docs/security-map.md`: §18 の表を 1 行ずつコードとテストに対応させる
- `pnpm audit --prod`（0 件）と全体の `pnpm audit`（drizzle-kit の中の esbuild の moderate 1 件。開発用の道具で、バンドルに入らない）
- README: バックアップ・掃除・書き出しの運用

## 5. 決めたこと（§24 D38）
- 空き時間は今日から 7 日を最初に見せる（週の初めからではなく）。「この時間で書く」は日付と開始の時刻を入れる（終わりは入れない）。休日のプリセットでは土日祝の日だけを並べる
- 検索の範囲と並び（上の 3.）、最近の検索語は結果を開いたときに覚える
- 書き出しは GET でも X-Ito-Client を求め、ページ遷移（Sec-Fetch-Mode: navigate）・同一オリジン以外は 403。JSON の形（`{ format: 'ito-export', version: 1, exportedAt, members, events }`）。ICS の細部（上の 2.）
- 送り終えた家族の変更のまとめ待ちは 7 日で消す（§15 の掃除の一覧にないが、たまり続けるため）
- バックアップ・掃除は時刻を過ぎてその日にまだなら行う（止まっていた日の分は動き出したとき）
- §19 の「1 年分の全件同期で 1MB 未満」は転送量で測り、/api/sync を gzip で送る（1 年分・約 2,200 行で素の JSON は約 1.4MB）
- これからの一覧は一度に 140 日まで描く

## 6. 依存
- 足していない（hono/compress は hono に含まれる）

## 7. レビューの指摘（対応済み。§24 D38 (8)〜(11)）
phase-5..HEAD の差分を 3 つの観点（server・core と web・セキュリティと文書）で読み、指摘ごとに別のエージェントが反証を試みた（21 エージェント）。確かめられた 16 件（重なりを除くと 13 件）をすべて直した。
- （medium）これからの一覧を削ると今日の日が消えて「今日に戻る」が出ない・「新しい予定」の数が変わる → 今日が範囲の外なら出す（押したら描き直したあとで合わせる）、新着は最初の範囲で数える。E2E phase7.spec.ts「§19 …」（削ったあとに「今日に戻る」→ 今日が見える）
- （medium）一覧が画面に収まっているとき、タップのたびに足して削る → byScroll（§22 の型に足した）。web phase7.test.ts「これからの一覧の範囲」
- （medium）§19 の初回の JS 200KB を超えていた（218KB）・静的の資産を圧縮していない → 開いたときに読む画面を分けて 197KB、静的も gzip、check-dist で測る。server static.test.ts「JS・HTML は Accept-Encoding があれば gzip で送る…」
- （medium）security-map の T4 が、ないテストを指していた → splitLinks の単体テストと、メモのリンクの E2E を足した
- （low）検索: 昨日の終日・昨日 24:00 に終わった予定をこれからに入れる、人の絞り込みがシリーズの 1 回を選んだあと → 直してテスト。他人の非公開のテストが失敗しえない（中身が null）→ 中身を持たせて探す、「全員の予定は含む」のテストに全員の予定がない → 足した
- （low）バックアップが失敗したら書きかけを残す → 消す（maintenance.test.ts「VACUUM INTO が途中で失敗したら…」）。ログのテストが中身を見ていない → backup・cleanup の行の項目を確かめる
- （low）E2E の「位置が飛ばない」がいつでも通る → Chromium のスクロールアンカーを止め、削った回に見ていた行が 2px 以内に残ることを確かめる
- （low）README に CT ログの注意がない・要確認に手で確かめることが載っていない → README「Tailscale の準備」6. と「設置したあとの確かめ方」、PROGRESS の要確認に足した
- 却下（反証された 2 件）: バックアップの失敗の扱い（同じ指摘の別の読み。直した）、ビルドの検査で VAPID の秘密鍵の値を探していない（§24 D38 (7) の範囲。鍵は環境変数だけで、ビルドに入る経路がない）
- 途中で見つかったこと: コードを分けたら zod の eval の試しが CSP 違反になった（入口の zod-setup より先に、分けたかたまりでスキーマが作られた）→ core の zod-config で設定する。E2E で worker が作り直されると Idempotency-Key の番号が 0 に戻って前の予定が返る → 実行ごとに違う値を添える

