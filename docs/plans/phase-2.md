# Phase 2 — PWA とローカルファースト 計画

読む章: §12, §17, §18（Service Worker と CSP）、§23 Phase 2

## 既にあるもの（Phase 1 でデータ層を Dexie で作った）
- Dexie のスキーマ（events・members・outbox・conflicts・meta）、DataStore（pull・push・送信待ちを畳む・競合）

## 足すもの
- data/store.ts: §12 の応答ごとの扱いを仕上げる（テストで固定）。`canEditOffline(op)`（「オフラインでは操作できない」の判定。Phase 3 の繰り返しの「これ以降」「すべて」で使う）
- 新着の印（F-21）: 端末ごとの「前回開いた時刻」を localStorage に置く（背面に回るとき・ページを離れるときに今の時刻を書く。同期の書き込みは pagehide で終わらないことがあるので localStorage）。開いたとき（前面に来たとき）に保存済みの値を今回の基準にする。はじめての端末は基準なし（印を付けない）
- 今日のまとめの「新しい予定 n件」→ 最初の「新」へ
- pwa/: SW の登録（virtual:pwa-register。インラインスクリプトなし）、更新の案内（待機中の SW → トースト「新しいバージョンがあります・更新」→ SKIP_WAITING）、インストール判定（display-mode: standalone・navigator.standalone）、`navigator.storage.persist()`（インストール後）、beforeinstallprompt
- sw.ts: `/api/*` はキャッシュしない（プリキャッシュとナビゲーションだけ）。push・notificationclick は Phase 4
- manifest（§17 のとおり）と仮アイコン（192・512・maskable 512・apple-touch-icon 180）。scripts/gen-temp-icons.mjs が node の zlib だけで PNG を作る（Phase 6 で icon.svg から作り直す）
- S-11 はじめて（色 → 使い方）、S-12 ホーム画面に追加ガイド、ホームの案内（F-23 のうちホーム画面への追加。閉じたら出さない）
- この端末からログアウト（Push の購読の解除は Phase 4 → IndexedDB・Cache Storage・localStorage を消す → S-11）
- C-02（接続できないときの 1 行・再試行）、C-05（競合の解決）は素朴な形で（Phase 6 で本番の UI に）

## テスト
- web 単体（fake-indexeddb）: 送信待ちを畳む（作成＋更新・更新どうし・削除で前を捨てる・未送信の作成の削除は何も送らない）、成功後に後続の If-Match を書き換える、409 は競合にして後続を止めない、404/410 は消す、422/403 は snapshot で戻す、401/403 not_member は止める、426 は outbox を残す、429 は Retry-After、5xx・通信エラーは指数バックオフ（最大 1 時間）、全件同期は送信待ちのない予定だけ置き換える、元に戻す
- E2E（E2E モード。chromium＋iPhone 15）: オフライン閲覧・オフライン作成 → 復帰で送信（context.setOffline）／API だけ遮断（page.route で /api/** を abort）で C-02 と送信待ち → 解除で送信／「新」が付き次に開くと消える／オフラインで 2 回編集しても 409 にならない／競合の 3 通りの解決／`/api/*` が Cache Storage に入らない／「更新」で新しい SW に切り替わる／インストールできる（CDP の Page.getInstallabilityErrors が空。§24 D25）／全テストで CSP 違反・コンソールエラー 0 件

## 決めたこと（§24 に書く）
- D25: 手で確かめる受け入れ項目の代わり（RUNBOOK 3.）: 「DevTools でインストール可能と表示される」は CDP の Page.getInstallabilityErrors が空であることで確かめる
- D26: 前回開いた時刻・はじめての進み具合・案内を閉じたかは localStorage（端末ごと。§15 の「端末ごとに保存」）。はじめての端末は新着の印を付けない

## Phase 1 のレビューから引き継いで直したこと（PWA のデータ層。WD-01〜14）
- WD-01 送信を試みた項目に畳まない／WD-02 送信待ちが待ちでも取得する（C-02 は通信エラーのときだけ）／WD-03 別の人としてつながったら手元を消して全件から取り直す（送信待ちを送る前に /api/me で確かめる）／WD-04 競合中の予定も取得で家族の側の最新・削除を取り込む／WD-05 送れたら競合の記録を消す／WD-06 送信中の印は応答の処理が終わるまで／WD-07 時刻ありの下書きの終わりの日は開始日か翌日だけ・開始日を動かしたら長さを保つ／WD-08 busy を触っていなければ既定値に合わせる／WD-09 月は 5〜6 行／WD-10 続いている予定の糸は busy に関係なく／WD-13 retryNow を次の回に持ち越す／WD-14 中身の変わらない編集は送らない・保存のあとの「元に戻す」
- 却下: WD-11（同じ回の pull で直る）、WD-12（上書きは C-05 で見せた自分の版をそのまま採る）、WD-15（保存の「元に戻す」は WD-14 といっしょに入れた）
- push の結果の名前を 'offline' から 'network'（通信エラー）と 'waiting'（バックオフ・429・5xx）に分けたので、store.test.ts の期待値の名前を合わせた（振る舞いは同じ）

## Phase 2 のレビューで直したこと
- P2-PWA-01／P2E-06: この端末からログアウトで SW の登録も外す（キャッシュを消したまま古い SW が残ると、次の版が来るまでオフラインで開けない）。logout.test.ts と E2E（ログアウト → SW に入り直す → オフラインで読み込み直す）。直す前の版で E2E が落ちることを確かめた
- P2-PWA-02／P2E-01: `/api/export`・`/healthz` へのページ遷移を SW の管理下で page.goto して確かめる（前は page.request で SW を通っていなかった）
- P2-PWA-03／P2E-03: `onboarded` を option にして、はじめて・ログアウトのテストも既定の page（監視・iPhone 15 の設定が効く）で動かす
- P2-PWA-04／P2E-07: ホーム画面から開いたとき（standalone）は起動のたびに永続化を求める（iOS は appinstalled が出ない）。pwa/install.ts の persistIfInstalled と単体テスト
- P2-PWA-05: X-Dev-Login を付ける分岐を呼び出し側で `import.meta.env.DEV || __ITO_E2E__` に入れ、本番のビルドから文字列ごと消す（dist を検索して 0 件）
- SYNC-01（＋SYNC-03）: 競合中の予定は C-05 で解決するまで編集・削除を受け付けない（store と詳細の画面）。Phase 1 の WD-05 のテストは「解決して送れたら競合の記録が残らない」に書き直した（競合中の編集を前提にしていたため）
- SYNC-02: サーバーに受け取られずに送信待ちを消したとき（422・403 で戻した、打ち消した編集、送る前に取り消した削除）は cursor を 0 にして次の取得を全件にする
- SYNC-04: 削除の取り消しは保存されている snapshot・baseVersion（送信のあいだに書き換わった版）を使う。競合の解決はトランザクションの中で記録を読む
- SYNC-05: 再試行（retryNow）でも 429 の Retry-After の待ちは解かない
- SYNC-06／P2E-10: 426 client_outdated では新しい SW を確かめ（registration.update）、C-02 に「再試行」の代わりに「更新」を出す
- SYNC-07: 送信待ちの createdAt を前の送信待ちより後ろにする（時計が戻っても順番どおり）。待ちが上限（1 時間）を超えていたら時計が戻ったとみなして送る
- SYNC-08／P2E-04: つながった同期（retryNow なし）で通信エラーの送信待ちをすぐ送る単体テスト。E2E は API を遮断したまま読み込み直しても見えること、解除後に再試行を押さずに 60 秒ごとの同期で送られること
- P2E-02: 許すコンソールエラーを、意図して失敗させた /api/ への要求の URL で絞る（fixtures がメッセージに URL を添える）
- P2E-05: 競合の E2E で、解決までは編集・削除が出ないこと、解決後の手元の一覧（どちらの件名が残るか・印が消えるか）を確かめる
- P2E-08: 背面に回して前面に戻したとき（visibilitychange）の新着の印の E2E
- P2E-09: はじめての色選び（ほかの家族の色は選べない・選んだ色がサーバーに保存される）と、インストール済み（navigator.standalone）ではホーム画面への追加の案内を出さない E2E
- P2E-11: PROGRESS の今・次、受け入れ基準の行（API 遮断・/api/ の遷移・コンソールエラー・pnpm check・docker compose build）、既知の問題を直した

## 却下したもの
- P2-PWA-06（401・403 not_member のときに手元の予定を消す）: §12 の表は「同期を止めて C-02 に理由を出す」。管理者が間違えて無効にしたときなどに、送っていない変更まで消してしまう。別の人としてつながったとき（/api/me が別の家族で 200）は WD-03 で手元を消している。家族でない人は Tailscale の ACL で届かない（§18）
