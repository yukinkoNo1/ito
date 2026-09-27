# Phase 4 — 通知 計画

読む章: §15 全体、§17（SW・ログアウト）、§18 T5・T8・T9・T14、§10（reminder_prefs・push_subscriptions・notification_log・pending_notices）、§13（push の API・メンバーの無効化）、§21（通知のテスト）、§22（NotificationSettingsVM・DeviceVM・HomeNoticeVM・EventDetailVM.myReminders）、§23 Phase 4、RUNBOOK 7. Phase 4

## 1. core
- `packages/core/src/notify.ts`
  - `reminderAt(occurrence, offsetMin)`: 時刻ありは開始＋offset、終日は開始日の 0:00（JST）＋offset（-240 = 前日 20:00、420 = 当日 7:00）
  - `effectiveOffsets(event, memberId, prefs, settings)`: reminder_prefs の行があればそれ（`[]` は通知なし）、なければ担当者（全員の予定を含む）に本人の既定値（時刻あり timedDefaults・終日 allDayDefaults）、担当外は通知なし。例外行は親（シリーズ）の行を使う
  - `offsetLabel(offset, allDay)`: 「開始時」「30分前」「1時間前」「前日 20:00」「当日 7:00」（通知文と詳細の札で共有）
  - `inQuietHours(hm, quiet)`: 22:00〜7:00 のように日をまたぐ範囲も扱う
  - 通知のキー `rem:{occurrenceKey}:{開始のepochミリ秒}:{memberId}:{offset}`、`digest:morning:{memberId}:{date}`、`digest:evening:{memberId}:{date}`
- スキーマ: `pushSubscriptionInputSchema`（endpoint は https だけ・2KB まで、keys.p256dh・auth は base64url、label 20 文字まで）、`PushPayload`（`{ v: 1, kind, title, body, url, tag, badge? }`）

## 2. server
- migration 0003: push_subscriptions、notification_log、pending_notices（§10 のとおり）
- `services/push.ts`: 購読の upsert（endpoint で。別のメンバーの同じ endpoint なら持ち主を付け替える＝端末を別の人が使い始めた）、一覧（endpoint は返さない。`?current=<id>` で isThisDevice）、削除（本人。管理者は他人の分も）、その人の全削除（管理者）、無効化で全削除（members の PATCH で）、deviceCount
- `PushSender` インターフェース（`send(sub, payload, { TTL, urgency })` → `ok`／`gone`（404・410）／`retry`（429・5xx・通信エラー）／`fail`）。本物は web-push（VAPID）。テストは記録するだけのダミー。VAPID の鍵がなければ push は無効（public-key は 404 `push_disabled`、スケジューラは送らない）
- `services/notify.ts`（送るもの）: 送信 → 結果ごとに購読を更新（ok: last_ok_at・fail_count=0／gone: 購読を削除／retry: fail_count+1。fail_count が 5 を超えた購読には送らずログ）。1 人の複数の端末のうち 1 台でも届くか、すべて gone なら notification_log を書く。retry だけなら書かない（次の実行で再送）
- `services/scheduler.ts`: 1 分ごと（setInterval。Stoppable。偽の時計でテストするため `tick()` を公開）
  1. 通知: 開始が `[今−1450分, 今＋8日]` の回を展開 → メンバーごとの offsets → 通知時刻が `(今−10分, 今]` で notification_log にないものを送る。TTL = 開始までの秒数（最低 60 秒）・urgency high
  2. 朝のまとめ・前夜の予告: 本人の時刻が `(今−10分, 今]` に入ったら、今日・明日の家族の予定（件数と先頭 3 件）。予定がない日は送らない。TTL 6 時間・normal
  3. 家族の変更: pending_notices を、受け取る人ごとに最後の変更から 2 分たったら 1 通にまとめる。静かな時間は送らずに待ち、明けたら送る。送る前に設定を読み直す（off なら捨てる）
- 家族の変更の積み方: 履歴（activity）を書くところで、書いた人以外の有効なメンバーのうち設定が `all`、または `mine` で自分が担当（全員の予定を含む）の人に積む。他人の非公開は「予定あり」
- 通知文: 受け取る人ごとに projectEvent を通す（他人の非公開は「予定あり」）。ロック画面に予定名を出さない設定なら `title: 'いと'`・`body: '予定の通知があります'`。2KB を超えないように件名を切る。url は `/e/{親の ID}?r={recurrenceId}`（まとめは `/`、変更は 1 件なら予定・複数なら `/activity`）。badge は未読の履歴の数
- API: `GET /api/push/public-key`、`GET/POST /api/push/subscriptions`、`DELETE /api/push/subscriptions/:id`、`DELETE /api/members/:id/push-subscriptions`、`POST /api/push/test`（自分の全端末に test。TTL 10 分・high）
- main.ts でスケジューラを起動し、shutdown で止める（§15 の終了処理。Phase 0 の jobs の口を使う）
- ログは件数・種類・状態コードだけ（予定名・endpoint を出さない）

## 3. web
- `pwa/push.ts`: `enablePush(publicKey)`（ボタンを押したあと最初に await するのは `Notification.requestPermission()`）→ `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → POST。返った購読の ID を端末に保存（isThisDevice のため）。`checkPushSubscription()`（起動・前面復帰で getSubscription → あれば upsert、なくて許可済みなら再購読）。`unsubscribePush()`（ログアウトで。サーバーの購読を消してから unsubscribe）
- 公開鍵は画面を開いたときに取っておく（ボタンを押してから取りに行かない）
- sw.ts: `push` は `event.waitUntil(showNotification(...).then(開いている画面に同期を促す))`。showNotification より前に await を置かない。tag でまとめる。badge があれば setAppBadge。`notificationclick` は同一オリジンのパスだけ（それ以外は `/`）。開いている画面があれば前面にして移動、なければ開く。ペイロードの読み取りと url の検査は `pwa/push-payload.ts` の純粋な関数にしてテストする
- 設定（S-07）: 通知をオンにする・許可の状態・テスト通知・端末の一覧と削除（自分の端末を消したらこの端末の購読も外す）・通知の設定（既定の通知・まとめ・予告・家族の変更・静かな時間・ロック画面）
- 家族の管理（S-07b）: その人の全端末への通知を止める
- ホームの案内（F-23 のうち通知）: ホーム画面から開いていて許可が `default` なら「通知をオンにする」。閉じたら出さない
- 詳細（S-04）: 自分への通知（myReminders・reminderOptions）→ PUT `/api/events/:id/reminders`（シリーズは親）。手元の myReminderPrefs も直す
- 同期の未読の数でアプリのバッジを合わせる（setAppBadge／clearAppBadge。対応していなければ何もしない）
- ログアウト: unsubscribePush をつなぐ

## 4. テスト
- core: reminderAt（開始時・当日 7:00・前日 20:00・JST の境界）、effectiveOffsets（行あり・`[]`・担当者の既定・担当外・例外行）、静かな時間、offsetLabel
- server（偽の時計・ダミーの送信）: §21 の通知の一覧すべて（開始時・終日の当日 7:00・前日 20:00／同じ回は二度送らない／動かしたら新しい時刻で送る／5xx のあと 10 分以内に再送・過ぎたら諦める／朝のまとめと前夜の予告が両方届く／静かな時間と 2 分まとめ）、404/410 で購読を消して log、fail_count、再起動しても 10 分より古いものは送らない、TTL と urgency、非公開の通知文（持ち主以外は「予定あり」・持ち主は件名）、ロック画面の設定、予定がない日はまとめを送らない、自分の変更では送らない、家族の変更の mine／all／off、繰り返しの回と例外行と取り消し、無効化したメンバーに送らない
- server API: 購読の upsert・一覧（endpoint を返さない・isThisDevice）・削除（本人・管理者・他人は 403）・全削除（管理者）・無効化で全削除・deviceCount・public-key（鍵なしは 404）・test
- web: push-payload（url の検査・ロック画面の文）、enablePush（最初の await が requestPermission）・checkPushSubscription（なければ再購読）を偽の pushManager で
- E2E: 設定の通知の欄（許可の状態と端末の一覧）、SW に push を届けて通知が出る（CDP の ServiceWorker.deliverPushMessage、`registration.getNotifications()`）、詳細の自分への通知
- 実機（iPhone でホーム画面に追加 → 通知オン → テスト通知 → 5 分後の予定の通知 → 1 日開かなくても翌朝のまとめ）は README に手順を書き、「要確認」に回す

## 5. 決めたこと（§24 に書く）
- D35: 通知の細則（この端末の印は購読 ID、送信の記録と再送の規則、まとめ・予告の時刻と予定がない日、家族の変更のまとめ待ち（同じ予定は 1 件に）、通知の文・url・tag・badge、テスト通知、鍵がないときは無効（公開鍵 null・テスト通知 unavailable）、自分への通知の候補と端末での保存、SW の SYNC・NAVIGATE、E2E の push は new headless の Chromium）

## 6. レビューの指摘（未対応。次にここから直す）
- P4-api-security-01・P4-web-01・P4-spec-tests-01（high）: ログアウト・「この端末」の削除のあとも checkPushSubscription が購読し直す → 端末に「自分で止めた」印を持ち、印があれば再購読・upsert しない（enablePush だけが消す）。単体テストを足す
- P4-api-security-02・P4-scheduler-01・P4-spec-tests-02（medium）: 2 分以内に非公開にした・担当を外したとき、mine の人のまとめ待ちに件名が残る → 受け手を絞る前に同じ予定の未送信の行を見て、見えない人は「予定あり」に直すか消す。テストを足す
- P4-web-02（medium）: SW がない環境（pnpm dev）で navigator.serviceWorker.ready が解決せず、ログアウトが止まる → getRegistration() を使う
- P4-web-03（medium）: 通知に renotify: true を付ける
- P4-web-04（medium）: 書く画面で通知を触ったあと終日⇔時刻ありを切り替えると、前の種類のオフセットが残る → 切り替えで既定値に戻す
- P4-scheduler-04（low）: まとめ待ちを 1 件にするのは同じ人のときだけ
- P4-scheduler-05（low）: flush は送る前に読んだ createdAt 以前の行だけ
- P4-scheduler-06（low）: offsetLabel(1440, true) を「翌日 0:00」に
- P4-web-05（low）: 書く画面の通知の候補も core の reminderOptions(allDay, current) から
- P4-web-06（low）: 公開鍵が取れていないときは取り直し、鍵なし（unavailable）と通信の失敗を分ける
- P4-web-08（low）: 書く画面の自分への通知の E2E（触らなければ行なし・触れば行あり・「これ以降」は新しいシリーズ）
- P4-spec-tests-03（low）: classifyStatus の表・fail(400) で log・retry 6 回で止まってログ・端末のない人は書かない・鍵なしのスケジューラのテスト
- P4-spec-tests-05（low）: 送信待ちの自分への通知があるまま pull しても上書きしない場面のテスト
- P4-spec-tests-06（low）: README の手順 4 の括弧書きを「35 分後に始まる担当の予定で、既定の 30 分前の通知が 5 分後に届く」に
- 却下: P4-spec-tests-04・api-security-03〜06・scheduler-02・03・07・08・09・10・web-07（理由はレビューの記録どおり: 仕様の範囲外・Phase 7 の掃除・性能・堅牢化の提案）

