# Phase 1 — 予定の中核と表示用フィード 計画

読む章: §10, §11（繰り返し以外）, §12 の /api/sync, §13, §13.1, §14 の認可と連携キー, §18 の T5・T15・T16, §20 の運用, §21 の API と表示用フィード

## core
- `schemas.ts`: EventDTO・EventInput（作成）・EventPatch（更新の changes）・MemberDTO・MeDTO・MemberSettings（既定値つき）・ActivityDTO・SyncResponse・DisplayFeedV1 の zod スキーマ。未知のキーは拒否（strict）
- `events.ts`: EventRecord（サーバー内部の形）、`validateEventShape`（終日と時刻ありの組み合わせ、終わり > 始まり、時刻ありは開始日の翌日 24:00 まで、非公開なら全員なし・担当は持ち主だけ）、busy の既定値
- `project.ts`: `projectEvent(record, viewerId | null) → EventDTO`（他人の非公開と閲覧者なしは §10 の形だけ）
- `occurrences.ts`: `expand(event, overrides, from, to)`（Phase 1 は繰り返しなし。Phase 3 で rrule を足す）、範囲にかかる回の判定、回の並び
- `holidays.ts`: `@holiday-jp/holiday_jp/lib/holidays`（日付文字列をキーにした表。端末のタイムゾーンに依存しない）から `holidayName(date)`・`holidaysBetween(from, to)`

## server
- マイグレーション 0001: events・event_members・activity・changes・idempotency_keys・app_settings・feed_tokens（`last_user_device_at` を足す。RUNBOOK 3.）
- services/events.ts: 作成（Idempotency-Key 必須、id はクライアントが振ってよい）・更新（If-Match 必須）・削除（ゴミ箱へ）・復元。**認可 → If-Match** の順。409 は projectEvent を通した最新の EventDTO を返す。例外行の owner_id・visibility は親から複製（Phase 1 は例外行を作らないが、親の visibility・owner を変えたら同じトランザクションで例外行も更新する関数を置く）
  - Idempotency-Key は作成では必須、更新・削除・復元でも付いていれば効かせる（通信が切れて応答だけ失われたときの再送が自分の変更と 409 にならないように）
  - ゴミ箱の予定への更新は 410 `gone`、ない予定は 404
- services/activity.ts: 人が読める差分（「開始 8:00 → 7:00」など）をサーバーで作る。非公開の履歴は持ち主だけに見せる
- services/sync.ts: changes のカーソル。cursor=0・古すぎる・未来のカーソルは全件
- services/members.ts: 追加・変更・再有効化で名前（NFC・前後の空白除去のあと）と色の重複を拒否、上限、最後の管理者は外せない
- services/feed.ts・middleware/feed-auth.ts・routes/feed.ts: §13.1 のとおり。検査の順は Host → 連携キー → 人の端末 → パラメータ → 回数制限 → If-None-Match
- routes: /api/me（GET・PATCH）、/api/sync、/api/events（POST・PATCH・DELETE・restore）、/api/trash、/api/activity（GET・read）、/api/members（GET・POST・PATCH）
- cli.ts: feed-token create --name / list / revoke <id>（DATABASE_PATH だけを使う。有効なキーは 5 つまで）

## web（オンライン専用でよいが、Phase 2 で作り直さないようにデータ層は Dexie で作る）
- data/: Dexie のスキーマ、API クライアント（X-Ito-Client: 1。開発・E2E のビルドだけ X-Dev-Login を付けられる）、同期（pull）と送信（Phase 1 はそのまま送る。Phase 2 で outbox を完成させる）
- viewmodels/: core のデータ → §22 の型（flow の DayVM、月の MonthVM、詳細の EventDetailVM）。テスト必須
- 画面（素朴な HTML）: S-01・S-02/S-03・S-04・S-05（詳しく入力）・S-07・S-07b・S-08・S-09。Phase 6 で本番の UI に差し替える

## 経路ごとのミドルウェア（Phase 0 の表の更新）
| 経路 | Host | no-store | プロトコル版 | CSRF | identity | feedAuth | 回数制限 |
|---|---|---|---|---|---|---|---|
| `/healthz` | × | ○ | × | × | × | × | × |
| `/api/feed/*` | ○ | ○ | × | ×（GET・HEAD 以外は 405） | **×**（ID ヘッダは見ない。人の端末の判定にだけ使う） | ○ | キーが通った要求だけ、キーごとに 120 回/分 |
| ほかの `/api/*` | ○ | ○ | ○ | ○（状態を変える要求） | ○ | **×**（Authorization を見ない） | 予定の作成 60 件/分（メンバーごと） |

## テスト
- API: CRUD、409（本文は投影した最新版）、Idempotency（同じキーで同じ応答・二重に作らない）、他人の非公開の更新・削除は 409 ではなく 403、ゴミ箱と復元、履歴の差分、メンバーの名前・色の重複、最後の管理者、回数制限
- 非公開の漏えい（今ある経路すべて）: sync・activity・trash・表示用フィード（持ち主の ID ヘッダ付きでも title: null）・409 の本文・エラー応答
- 表示用フィード: §21 の一覧すべて（例のファイルとの比較は朝練を除く）
- CLI: create → 一覧 → revoke。キーの平文が DB・一覧・ログに出ない
- まだない経路（export / push の文面 / 朝のまとめ / 一言入力の重なり警告）の漏えいテストは PROGRESS の「後で足すテスト」へ

## 決めたこと（§24 に書く）
- D19: feed_tokens に `last_user_device_at`（人の端末から最後に使われた時刻。5 分に 1 回まで書く）（RUNBOOK 3.）
- D20: 開発モードの「人の端末」は X-Dev-Login 付きの要求（RUNBOOK 3.）
- D21: 更新・削除・復元でも Idempotency-Key があれば効かせる／ゴミ箱の予定への更新・削除は 410／担当なし（全員でもない）の予定は作れない／他人の非公開はゴミ箱に出さない
- D22: 連携キーの確認はキーを表示しないスクリプト（scripts/feed-check.mjs）で状態コードだけを出す
