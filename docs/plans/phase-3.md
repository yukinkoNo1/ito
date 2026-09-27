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
