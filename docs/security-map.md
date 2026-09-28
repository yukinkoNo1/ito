# セキュリティの対応表（SPEC §18）

SPEC §18 の脅威（T1〜T16）・レスポンスヘッダ・ログの決まりを、1 行ずつ「どのコード（設定）で守り、どのテストで確かめているか」に対応させた表。
テストの名前は `describe` と `it` の文言（ファイル: 名前）。手で確かめるもの（本番の Tailscale の設定など）は「要確認」に回している（docs/PROGRESS.md の「要確認」。手順は README「設置したあとの確かめ方」）。

## 脅威と対策

| # | 脅威 | 守っているところ（コード・設定） | 確かめているテスト | 残るもの |
|---|---|---|---|---|
| T1 | インターネットからのアクセス | `deploy/ts-serve/serve.json`（`AllowFunnel: false`、443 だけ）、アプリは 127.0.0.1 だけで待ち受け（`apps/server/src/env.ts` の HOST 検査）。ACL は README「Tailscale 側の準備」 | server env.test.ts「本番設定で HOST=0.0.0.0 なら起動しない」「HOST は ::1 でもよい」、`docker compose config -q` | ACL（`tag:ito:443` に届くのは `group:family` と `tag:ieboard`）は管理画面の設定なので手で確かめる（要確認） |
| T2 | ID ヘッダの偽装 | Serve が同名ヘッダを消す／`deploy/compose.yaml` の `network_mode: service:ts`・`TS_USERSPACE: "false"`（カーネルモード）・`HOST: 127.0.0.1`／`middleware/identity.ts`（本番では X-Dev-Login を無視）／起動時検査（env.ts: 本番で dev モード・0.0.0.0 を拒否） | server middleware.test.ts「本番では X-Dev-Login を無視する」「開発モードでは Tailscale-User-Login を使わない」、env.test.ts「本番（NODE_ENV=production）で dev モードなら起動しない」「dev モードは NODE_ENV=development のときだけ」、Docker の `docker inspect`（Phase 0） | tailnet の別端末から :8787 に届かないことの確認は設置後に手で（要確認・README） |
| T3 | CSRF | `middleware/csrf.ts`（X-Ito-Client・Content-Type・Origin・Sec-Fetch-Site）、`middleware/host.ts`（Host。/healthz ちょうどだけ例外）、CORS を許可しない、`routes/export.ts`（GET でも X-Ito-Client を求め、ページ遷移・別サイトは 403） | middleware.test.ts「CSRF（SPEC §14）」（8 件）「Host 検査・/healthz」（4 件）、export.test.ts「アプリからの fetch だけ…」、総点検でルート一覧から機械的に確かめる（docs/security-review.md） | — |
| T4 | XSS | React のエスケープだけ（`dangerouslySetInnerHTML` 禁止）、`ui/labels.ts` の splitLinks（http(s) だけリンク、`rel="noopener noreferrer"`）、地図リンクは `app/maps.ts` で encodeURIComponent、CSP | server architecture.test.ts「dangerouslySetInnerHTML を使わない」、web phase7.test.ts「メモのリンク（§18 T4）」（http(s) だけ・javascript:／data: はリンクにしない）、web phase6.test.ts（地図リンク）、E2E phase7.spec.ts「メモのリンクは http(s) だけ。rel="noopener noreferrer"…」、E2E fixtures.ts（全テストで CSP 違反 0 件。zod の eval の試しも出さない＝core の zod-config） | — |
| T5 | 非公開予定の漏えい | `@ito/core` の projectEvent・canSeeContent を全出口で通す: 同期（services/sync.ts）・履歴（activity.ts）・ゴミ箱・409 の本文・通知の文（notifier.ts・family-notices.ts）・まとめ・書き出し（export.ts）・表示用フィード（閲覧者なし）・一言入力の重なり（web viewmodels/nlp.ts）・検索（web viewmodels/search.ts）・空き時間（core freebusy.ts は中身を出さない） | events.test.ts「他人の非公開（§10・§14。T5）」（9 件）、notify.test.ts「非公開: 持ち主には件名で送り…」「朝のまとめ…」「2 分以内に非公開にしたら…」「送る前に、今の予定で件名の見え方を決め直す」、export.test.ts「JSON: 他人の非公開は含めない」「他人の非公開の繰り返しは、例外行ごと含めない」、feed.test.ts（持ち主の ID でも title: null）、web phase5.test.ts「重なりの警告」、web phase7.test.ts「他人の非公開は探さない」、core freebusy.test.ts「…他人の非公開は中身を出さずに…」、E2E phase7.spec.ts（検索・書き出し・これからの一覧） | — |
| T6 | 一言入力へのプロンプトインジェクション | AI は提案だけでツールなし（services/ai-client.ts）、Structured Outputs＋zod（services/parse.ts の aiOutputSchema・fromAiOutput）、member_keys は enum（m1〜mN）、人が確かめて保存 | parse.test.ts「AI に送るのは入力文・日付表・家族の呼び名だけ…」「AI の結果を下書きにする…」、core nlp-rules.test.ts #38（指示の文も予定の文として扱う） | 実 API での評価（pnpm ai:eval）は本物の鍵が要る（要確認） |
| T7 | API キー・VAPID 秘密鍵の流出 | 環境変数だけ（`deploy/app.env`、.gitignore・.dockerignore 済み）、`scripts/check-dist.mjs`（`pnpm build` の最後。Docker のビルドでも動く）、logger.ts の maskSecrets（`sk-ant-`・`ito_feed_`）、env.ts はエラーに値を出さない | `pnpm build`（check-dist: sk-ant・連携キー・秘密鍵・X-Dev-Login・ギャラリーがないこと）、logger.test.ts「maskSecrets は Anthropic のキーもマスクする」、env.test.ts「エラーメッセージに値（秘密情報）を出さない」「VAPID の鍵の長さが違えば起動しない（値はメッセージに出さない）」 | app.env の権限 600 は設置のときに（README） |
| T8 | 通知経由の情報露出 | web-push（RFC 8291 の aes128gcm、services/push-sender.ts）、ロック画面の設定（notifier.ts の hideDetails）、ペイロードは最小（2KB。core notify.ts の fitPayload）、SW は同一オリジンのパスだけ開く（core safeNotificationPath） | notify.test.ts「ロック画面に予定名を出さない設定なら…」、web phase4.test.ts「SW の push の中身」「通知を押したときの移動先は同じオリジンの URL」、E2E phase4-push.spec.ts | 実機（iPhone）での確認は要確認 |
| T9 | 端末の紛失 | 設定の「通知を受け取る端末」・家族の管理の「この人の端末の通知を止める」（routes/push.ts、DELETE /api/members/:id/push-subscriptions）、無効化で全購読を削除 | notify.test.ts「削除は本人と管理者だけ…無効化でも消える」、E2E phase4.spec.ts「設定: 通知を受け取る端末の一覧から止められる…」「家族の管理: この人の端末の通知を止める」 | Tailscale の管理画面で端末を消すのは持ち主 |
| T10 | 乱用・DoS | 本文 32KB（app.ts の bodyLimit）、文字数（core schemas.ts）、/api/parse の回数制限（ai_usage。呼ぶ前に枠を取る）、作成 60 件/分、テスト通知 5 回/分、フィードはキーごと 120 回/分、RRULE の制限と展開の打ち切り（core recurrence.ts） | middleware.test.ts「本文が 32KB を超えたら 413」、events.test.ts「1 メンバーの作成は 60 件/分まで」、parse.test.ts「回数制限…」「同時に送っても回数制限を超えて AI を呼ばない」、feed.test.ts「キーごとに 120 回/分」、core recurrence.test.ts「1 回の展開は 2,000 回で打ち切る」「回が出ない規則（毎年 2/31）でも、すぐ終わる」 | — |
| T11 | データの消失 | ゴミ箱 30 日（削除は論理削除）、履歴、毎日 3:30 のバックアップ 14 世代（services/maintenance.ts の runBackup。VACUUM INTO → 名前を変える）、掃除は 4:00 | maintenance.test.ts「VACUUM INTO で作り、書きかけ（.tmp）を残さない…」「14 世代を残し…」「スケジューラ: 3:30 を過ぎて…」、events.test.ts「削除 → ゴミ箱 → 元に戻す…」 | restic などで家の外へ送るのは設置のとき（README の運用） |
| T12 | 証明書透明性ログでのホスト名公開 | ホスト名は `ito`（compose の hostname・TS_HOSTNAME）。README「Tailscale の準備」の 6.（ホスト名・tailnet 名に家族の名前を使わない） | —（設定） | tailnet 名は持ち主が決める（要確認） |
| T13 | 依存パッケージ | lockfile 固定（pnpm@10.34.5、`--frozen-lockfile`）、ビルドスクリプトの許可リスト（pnpm-workspace.yaml の onlyBuiltDependencies）、依存を足すときは plans に理由 | `pnpm audit --prod`（Phase 7: 0 件）。全体の `pnpm audit` は drizzle-kit（マイグレーションを作る開発用の道具）の中の esbuild（開発サーバーの問題。バンドルに入らず、サーバーとして動かさない）の moderate 1 件だけ | drizzle-kit の更新で解消するまで受け入れる（既知の問題） |
| T14 | コンテナの権限 | compose.yaml の app: `user: "10001:10001"`・`read_only: true`・`cap_drop: [ALL]`・`no-new-privileges`・tmpfs、ts だけが NET_ADMIN と /dev/net/tun | Phase 0 の `docker compose exec app id`・`docker inspect`（ReadonlyRootfs・CapDrop）、最終確認の `docker compose up -d --wait` | — |
| T15 | 連携キーの漏えい・いえボード経由の露出 | 今日から 3 日の件名・時刻・人だけ（services/feed.ts。場所・メモなし、非公開は中身なし）、キーは SHA-256 だけ保存（feed-tokens.ts）、CLI で止める、last_used_at・last_user_device_at、`FEED_ALLOW_USER_DEVICES=false`、/api/feed/* は連携キーだけで認証（ID ヘッダを使わない）、ログは `ito_feed_` をマスク | feed.test.ts（§21 の一覧すべて。「連携キーの平文はログ・DB・エラー応答に出ない」「連携キーでほかの API は使えない」「false（既定）なら ID ヘッダ付きは 403」ほか）、cli.test.ts、export.test.ts「本番の設定: ID ヘッダがなければ、連携キーを付けても 401 no_identity」、`scripts/feed-check.mjs`（キーを表示せず状態コードだけ） | いえボードの公開（Funnel）は §24 D14 で受け入れた |
| T16 | 人の端末で動くいえボードの乗っ取り | いえボードは `tag:ieboard` の端末で動かす（タグ付きの要求には ID ヘッダが付かない）、`FEED_ALLOW_USER_DEVICES` の既定は false、true のあいだは WARN とログ・`feed-token list` に出る | env.test.ts「本番の正しい設定なら通り、FEED_ALLOW_USER_DEVICES の既定は false」、feed.test.ts「true なら 200。…WARN を 1 時間に 1 回」 | ACL（タグ付き端末から人の端末へ通信を始められない）は手で確かめる（要確認） |

## レスポンスヘッダ（全応答）

| ヘッダ | 守っているところ | 確かめているテスト |
|---|---|---|
| CSP・HSTS・nosniff・Referrer-Policy・Permissions-Policy・COOP・CORP | `apps/server/src/middleware/security-headers.ts`（静的配信も含めて全応答） | middleware.test.ts「セキュリティヘッダは全応答（200・401・404・421・エラー）に付く」、E2E fixtures.ts（CSP 違反 0 件）、E2E phase6（フォントの data: を止められたので assetsInlineLimit: 0） |
| `Cache-Control: no-store`（API） | 同上 | middleware.test.ts「API の応答は Cache-Control: no-store（エラーも）」 |
| Service Worker は /api/* をキャッシュしない・/api/* と /healthz へのページ遷移を index.html にしない | `apps/web/src/sw.ts`（NavigationRoute の denylist、/api/ はルートを登録しない）、`apps/server/src/lib/static.ts` | E2E phase2.spec.ts「/api/* は Cache Storage に入らない」「/api/export・/healthz へのページ遷移は、SW の管理下でも index.html にならない」、server static.test.ts |
| 同期の応答・静的の JS/CSS/HTML の gzip | app.ts の compress（/api/sync と静的配信。/api/* のほかは圧縮しない。同期の本文に送り手の秘密を返さないので BREACH の対象にならない。§24 D38） | perf.test.ts「1 年分の全件同期は、送る量が 1MB 未満（gzip）」、static.test.ts「JS・HTML は Accept-Encoding があれば gzip で送る…」、`scripts/check-dist.mjs`（初回表示の JS は gzip で 200KB 以内。§19） |

## ログ（§18）

| 決まり | 守っているところ | 確かめているテスト |
|---|---|---|
| 予定名・メモ・場所・入力文・ログイン・ヘッダ全体・連携キーを出さない | `apps/server/src/logger.ts`（pino の redact と maskSecrets）、各サービスは ID・件数・種類・状態コードだけを渡す | logger.test.ts（3 件）、notify.test.ts「ログに予定名・endpoint を出さない」、parse.test.ts「入力文はログ・DB・エラー応答に残らない」、feed.test.ts「連携キーの平文はログ・DB・エラー応答に出ない」、maintenance.test.ts「スケジューラ: 3:30 を過ぎて…」（backup の行は file・removed だけ、cleanup の行は件数だけ、パスを出さない） |
| 今の時刻は Clock から（偽の時計でテストする） | `@ito/core` の clock.ts | architecture.test.ts「今の時刻は Clock から取る」「引数なしの new Date() を使わない」 |
