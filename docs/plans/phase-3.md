# Phase 3 — 繰り返し 計画

読む章: §11 全体、§3（回・recurrenceId）、§10（events・reminder_prefs）、§13（PATCH・DELETE の scope）、§13.1（表示用フィードの繰り返し）、§21（繰り返しのテスト）、§22（RecurrenceVM・RecurrenceEndVM・C-04）、§23 Phase 3、RUNBOOK 7. Phase 3

## 1. core
- `packages/core/src/recurrence.ts`（rrule を import するのはここだけ。外には Occurrence と自前の型だけを出す）
  - `validateRrule(rrule)`: §11 のサブセットの検証。FREQ は DAILY・WEEKLY・MONTHLY・YEARLY（HOURLY 以下は拒否）、INTERVAL 1〜99、COUNT 1〜1000、COUNT と UNTIL は併用しない、DTSTART・TZID・RDATE・EXDATE を文字列に入れない（DTSTART は予定の開始から導く）、BYHOUR・BYMINUTE・BYSECOND は拒否（1 日の中で回が増えるのは HOURLY と同じ扱い）。それ以外（BYMONTH・BYSETPOS・BYYEARDAY・BYWEEKNO・WKST）は保存・展開してよい（UI では「カスタム」）
  - 浮動時刻: JST の壁時計の値をそのまま UTC の Date として rrule に渡し、結果も壁時計として読む（端末・サーバーのタイムゾーンを使わない。コードのコメントで説明）
  - `ruleStarts(rrule, dtstartWall, fromWall, toWall, limit)`: [from, to) の回の開始（壁時計）。1 回の展開は最大 2,000 回で打ち切る
  - 時刻ありの UNTIL は `YYYYMMDDT235959`（浮動）で保存する（日付だけの UNTIL は 0:00 と解釈されて最終日の回が落ちる）。終日は `YYYYMMDD`
  - `describe(rrule)`: 「毎週 月・木」「隔週 土」「毎月 第2・第4 水」「毎月 月末」「毎月 15日」「毎年」「毎日（10回）」「毎週 土（12/31まで）」。サブセット外は「カスタムの繰り返し」
  - `toRecurrenceVM(rrule)`／`fromRecurrenceVM(vm, end, start)`: §22 の RecurrenceVM・RecurrenceEndVM（なし／◯回／◯日まで）⇔ RRULE（COUNT・UNTIL）
  - 29〜31 日の毎月は「月末にしますか？」の提案用に `suggestMonthEnd(startDate)`（UI は ComposerSheet の札）
- `occurrences.ts` の `expand(event, overrides, from, to)`: rrule があれば recurrence で回を作る。key は `親の ID@recurrenceId`（例外行でも同じ。§3・§24 D33）。exdates の回は出さない。例外行（parentId＋recurrenceId）はその回を置き換える（例外行の時刻で範囲にかかるかを見る）。回の長さは親の開始〜終了
- 例外・分割の計算（サーバーと PWA で共有）: `splitSeries(parent, recurrenceId)`（「これ以降」: 元の COUNT を外して UNTIL=前の回、新シリーズは残り回数。初回なら「すべて」と同じ）、`shiftSeries(parent, recurrenceId, newStart)`（「すべて」の日時変更は選んだ回の元の日時からの差分をマスターに当てる）、`lostOnSplit`／`lostOnShift`（消える例外・取り消しの件数。C-04 に出す）

## 2. server
- 作成で rrule を受け付ける（validateRrule）。例外行は作成では作らない（PATCH scope=this で作る。今のまま）
- PATCH `/api/events/:id` の scope（`:id` は親。If-Match は親の version。シリーズ単位の楽観ロックにし、例外の作成・変更でも親の version を上げる。§24 D33）
  - this: 例外行を作る（id は `exceptionId`。なければサーバーが振る）か、あれば更新する。owner・visibility は親から複製。変更は「その回の今の値」に当てる
  - following: 分割。新シリーズの id は `exceptionId`（クライアントが振る。オフラインで手元に出すため）。以降の例外行・取り消しは破棄。reminder_prefs を新シリーズに複製。応答に `{ event, created, discarded }`
  - all: マスターを更新。日時の変更は差分で当てる。開始日時が変わるなら例外と取り消しをリセット（件数を返す）
- DELETE `?scope=&recurrenceId=`: this → 親の exdates に足す（その回の例外行はゴミ箱へ）／following → 分割と同じく UNTIL を付け、以降の例外・取り消しを破棄（初回ならシリーズごとゴミ箱）／all → 親と例外行をゴミ箱へ。復元は親と例外行を戻す
- reminder_prefs テーブル（migration 0002）と PUT `/api/events/:id/reminders`（本人の offsets。最大 3、-10080〜1440）。sync の myReminderPrefs を埋める。通知の送信は Phase 4
- 履歴: 「この回だけ変更」「この回だけ削除」「これ以降を変更」を人が読める差分に
- 表示用フィード: expand を通す（例外・取り消しを反映）。例のファイルとの比較に朝練を含める。「この回だけ変更」「この回だけ削除」で ETag が変わる

## 3. web
- DataStore: updateOccurrence(scope)・deleteOccurrence(scope)。オフラインでは「これ以降」「すべて」を受け付けない（C-04 で無効。§11・§22）。「この回だけ」は手元で例外行を作って送信待ちに積む
- 書く画面の「くわしく」の繰り返し（RecurrenceVM・RecurrenceEndVM）を rrule にして保存。29〜31 日の毎月は月末の提案
- 詳細（S-04）: 繰り返しの予定の編集・削除・項目の直し → C-04（RecurrenceScopeDialog）で範囲を選ぶ。消える例外・取り消しがあれば件数を出す（§22 の型に `lost` を足す。§24 D33）
- viewmodels: recurrenceLabel に describe をつなぐ

## 4. テスト
- core: 第2・第4水曜、月末、2/29 の毎年、31 日指定で 31 日のない月をとばす、COUNT／UNTIL（時刻ありの UNTIL で最終日の回が残る）、例外・取り消し、「これ以降」の分割（COUNT の残り回数、初回は「すべて」）、「すべて」の日時の差分、入力制限（HOURLY 以下・INTERVAL・COUNT の上限・BYHOUR の拒否・2,000 回で打ち切り）、describe、RecurrenceVM ⇔ RRULE、JST の境界
- 3 通りの展開の一致: 同じテストデータで core を直接・サーバーの API（sync の行を core で展開）・PWA の viewmodel（buildFlowItems）の結果が同じ
- server: scope ごとの PATCH・DELETE・If-Match・Idempotency、reminder_prefs の複製、非公開の例外行の投影、フィードの例のファイル（朝練を含む）と例外で ETag が変わる
- web: store の scope（オフラインの制限、手元の例外行）、C-04 の件数
- E2E: 繰り返しの予定を書いて、この回だけ変更・これ以降・すべて・この回だけ削除

## 5. 決めたこと（§24 に書く）
- D33: 繰り返しの細則（回の key は例外行でも `親の ID@recurrenceId`、If-Match は親の version、following の新シリーズの id は exceptionId、BYHOUR などは拒否、C-04 に消える件数）
- D34: Phase 3 のレビューで決めた細則（差分だけを送る、seriesLoss、破棄した例外行は消す、毎月の規則の移動、RRULE の並びと sameRule、この回だけ変更の元に戻す（revert）、回の送信待ちの 409・404、「この予定だけ」の制限、保存したあとの回へ移る、月末の問い、rrule の ESM）

## 6. レビューで直したこと（P3-*）
- P3-core-01: rrule（UMD）を名前空間から取り出す。Node の ESM（tsx）で @ito/core・サーバーのアプリ・CLI を読み込むテスト（server test/esm-load.test.ts）
- P3-core-02・P3-server-01・P3-web-03・P3-spec-tests-01: 「これ以降」「すべて」も回の今の中身との差分だけを送る（web viewmodels/series.ts の occurrenceChanges、store）。サーバーも日時がその回の今の中身と同じなら外す（core dropUnchangedTimes・allScopeChanges）。テスト: core series.test.ts、server「例外で動かした回から「すべて」「これ以降」で件名だけ直しても…」、web phase3.test.ts「送る変更は回の今の中身との差分だけ」
- P3-core-06・P3-server-03・P3-web-02・P3-spec-tests-02・P3-web-12: 消える件数を core の seriesLoss で出し、サーバーのリセットと C-04 で共有。終わりだけの変更は回でなくなるものだけ消す。最初の回の「これ以降」は「すべて」と同じ件数、削除ならシリーズごとゴミ箱（元に戻せる）
- P3-core-03: shiftRule を「動かした先の日・第 n」にし、毎月は開始を元の月の回に置き直す。月をまたぐ・決められない・回にならない移動は 422
- P3-core-04: 毎日で曜日を絞り、間隔が 7 の倍数の規則を拒否
- P3-core-05: RRULE の値の並びをそろえる。規則の比較は sameRule（書き方の違いを同じとみなす）。WKST 付きは「カスタム」。toPreset → fromPreset で規則が変わらないテスト
- P3-server-02: 「これ以降を削除」でもシリーズの回か確かめる（404 occurrence_not_found）
- P3-server-04: 破棄した例外行はゴミ箱に入れずに消す（取り消しで戻らない）
- P3-server-08: 「これ以降を変更」の履歴の新しいシリーズの行に、何を変えたかの差分
- P3-test-06: scope ごとの古い If-Match の 409、同じ Idempotency-Key の再送、PUT reminders の 422・403・404
- P3-web-01・P3-web-08: 繰り返しの回の送信待ちの 409・404 occurrence_not_found は、送信待ちと手元の例外行を捨てて全件を取り直し、知らせる（C-05 に出さない）
- P3-web-04・P3-web-11: 「この予定だけ」では公開・非公開と繰り返しを変えられない（C-04 で理由を出して無効。store でも断る）
- P3-web-05: 新しく作った「この回だけ変更」の元に戻すは例外行を消す（送る前なら送信待ちごと、送ったあとは revert）
- P3-web-07: 「すべて」の変更は、日時・繰り返しを変えないときだけ元に戻せる
- P3-web-09: 保存で回が変わったら詳細をその回に移す（nav.replaceEvent）
- P3-web-10: 29〜31 日の毎月は、その日のまま入れて「月末にしますか？」と聞く
- P3-spec-tests-06: PROGRESS の Phase 3 の確認の行に、件数と EXIT を書く
- P3-spec-tests-08: 「これ以降」の新しいシリーズの ID を PWA が振る（exceptionId）

## 却下したもの
- P3-spec-tests-03・P3-web-06（store でオフラインの「これ以降」「すべて」を断る）: §12 はしくみを「C-04 で無効化し理由を表示」と定めていて、C-04 は同期の通信エラーと navigator.onLine で無効にしている（E2E で確認。D33）
- P3-spec-tests-04・P3-web-14・P3-core-09（3 通りの比較のデータに例外・取り消しを入れる）: §23 が求めるのは同じデータで 3 通りが一致すること。例外・取り消しの展開は core・server・E2E で別に確かめている
- P3-spec-tests-05（scope ごとの If-Match・Idempotency のテスト）: 実装は scope に関係なく効く。テストは P3-test-06 で足した
- P3-spec-tests-07・P3-core-07（splitSeries・shiftSeries の core の単体テスト）: 部品とサーバーの API テストで確かめていた。shiftSeries・allScopeChanges・seriesLoss・splitSeries の単体テストは P3-core-* の直しで足した（core test/series.test.ts）
- P3-spec-tests-09・P3-core-08（タイムゾーンを変えたテスト）: 実装は Date.UTC と getUTC* だけで浮動時刻を扱い、ほかの TZ でも同じ結果になることをレビューで確かめている。§21 の JST の境界のテストはある
- P3-spec-tests-10（PUT reminders の入力の検査のテスト）: 実装は正しい。テストは P3-test-06 で足した
- P3-server-05（分割で非公開の新シリーズにほかの家族の reminder_prefs が複製される）: §11 のとおり。通知（Phase 4）は他人の非公開には送らない（core effectiveOffsets）
- P3-test-07（例外行の出口ごとの漏えいのテスト）: 投影は行ごとの visibility・ownerId による共通の処理で、例外行は親から複製している。出口ごとのテストは Phase 1 にある
- P3-web-13（following の exceptionId）: P3-spec-tests-08 として直した
- P3-core-10（BYxx のない FREQ=MONTHLY が「カスタム」）: §11 は画面で作れない形を「カスタム」とすることを認めている

