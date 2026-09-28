# Phase 5 — 一言入力 計画

読む章: §16 全体、§21 のルール解析の表（38 件）と AI のテスト、§10 ai_usage、§18 T13（入力文の扱い）、§22 ComposerVM・AmbiguityVM、§23 Phase 5、RUNBOOK 7. Phase 5

## 1. core
- `packages/core/src/nlp/rules.ts`（`@ito/core/nlp/rules`）: `parseRules(text, ctx)` → `{ draft, ambiguities, found }`。NFKC → 繰り返し → 日付 → 時刻 → 家族 → キーワード（終日・内緒・@場所）→ 残りを件名。見つけた語は空白に置き換えてから次を探す。人・キーワード・時間帯は空白で区切られた語だけを見る（「夜釣り」「家族旅行」を取らない）。曖昧さは §16 の規則 7〜10
- テストが先: `packages/core/test/fixtures/nlp-cases.ts`（§21 の表の 38 件。今 = 2026-09-27(日) 14:18、週の始まり = 日曜、書いた人 = はると）→ `nlp-rules.test.ts`（table-driven）

## 2. server
- migration 0004: ai_usage（§10。入力文は保存しない）
- `services/ai-client.ts`: `AiClient` インターフェース（テストは固定の応答）。本物は公式 SDK（`@anthropic-ai/sdk`）の `messages.create`（model は ANTHROPIC_MODEL、max_tokens 800、temperature 0、`output_config.format = { type: 'json_schema', schema }`、timeout は AI_TIMEOUT_MS、再試行なし）。結果は ok／refusal／max_tokens／timeout／error
- `services/parse.ts`: ルール解析 → 鍵がない・回数制限を超えたらルール解析のまま → プロンプト（§16 のテンプレート。日付表 42 日・週の範囲・家族のキー m1〜mN と呼び名・書いた人・今日を基準にルール解析で作った 3 例）→ 動的スキーマ（member_keys の enum は有効メンバー数から）→ zod で検証して下書きへ（キーは大文字小文字を無視、日付の範囲、時刻、終日の最終日、曖昧さの選択肢、曜日の食い違いの質問、busy の既定）→ だめならルール解析（reason）。ai_usage に種類・所要時間・トークン数だけ。ログは種類と所要時間だけ
- `routes/parse.ts`: `POST /api/parse { text: 1〜200 }`（入力文をエラー応答に出さない）
- `scripts/ai-eval.ts`（`pnpm ai:eval`）: ANTHROPIC_API_KEY があるときだけ、§21 の表を実 API に投げて差を表で出す。`pnpm check`・CI では動かさない。実行は「要確認」

## 3. web
- `viewmodels/nlp.ts`: ルール解析の文脈（自分は呼び名も、ほかの家族は名前・略称）、解析の結果 → 書く画面の下書きの変更（書いていない日付・時刻・人は先に選んでいた日などを残す）、曖昧さ → AmbiguityVM、/api/parse の応答の検証、重なりの警告（端末の DB。予定ありの予定だけ最大 3 件。他人の非公開は「予定あり」）
- `features/composer/ComposerContainer.tsx`: 書いているあいだは端末のルール解析で札に反映、確認へ（Enter。変換確定の Enter は UI で除く）で /api/parse（オフライン・10 秒で待つのをやめる・形が違えばルール解析のまま＝「かんたん解析」）。札で選んだ項目は一言を書き直しても上書きしない。直すときは一言は件名だけ。自分への通知は D36 の決まり（followReminders）で追従する

## 4. テスト
- core: §21 の 38 件（nlp-rules.test.ts）
- server: parse.test.ts（AI の結果を下書きに・送るのは入力文・日付表・呼び名だけで enum は m1〜mN・鍵なしはルール解析・回数制限・入力文がログ・DB・エラー応答に残らない・非公開・全員・繰り返し・曖昧さ・曜日の食い違い・1〜200 文字・SDK の呼び出しの形と refusal／max_tokens／タイムアウト／HTTP エラー／通信エラー／形の不正）
- web: phase5.test.ts（文脈・札への反映・開いた日を残す・曖昧さ・応答の検証・重なりの警告と他人の非公開）
- E2E: phase5.spec.ts（一言で書いて保存 → これから・月、変換確定の Enter では確認へ進まない）

## 5. 依存
- `@anthropic-ai/sdk` 0.128.0（server の devDependencies。esbuild で 1 ファイルにまとめる）: SPEC §8 の技術スタックのとおり、Anthropic の呼び出しは公式 SDK で行う（型・エラーの種類・タイムアウトを SDK に任せる）

## 6. 決めたこと（§24 D37）
- 応答に `found`（一言に日付・時刻・人を書いたか）と `reason`（ルール解析になった理由）を足す。書いていないものは書く画面で先に選んでいたものを残し、書いていない日付の質問は出さない
- 回数制限を超えたら 429 ではなくルール解析（rate_limited）。数えるのは ai_usage の行
- AI の出力の検証の細部（上の 2.）。recurrence の質問は下書きの形に直せないので出さない。件名・場所は 100 文字まで。非公開なら担当は書いた人だけ
- 時間帯（朝 7–9・午前 9–11・昼 12–13・午後 13–15・夕方 17–18・夜 19–21）だけなら終日にして時刻の候補を聞く
- E2E の Phase 3 の件名「月曜の練習」を「ピアノの練習」に（一言のルール解析で「月曜」が日付になるため）

## 7. レビューの指摘（対応済み。§24 D37 (10)）
phase-4..HEAD の差分を 3 つの観点（core のルール解析・server の /api/parse・web の書く画面）で読み、指摘ごとに別のエージェントが反証を試みた（30 エージェント）。確かめられた 21 件をすべて直した。
- （high）一言の解析が、書いていない公開・非公開と繰り返しを毎回決め直す（非公開の最近の予定・複製した非公開の予定が確認へ進むと公開になる）→ found.private・found.recurrence を足し、書いていなければ残す。一言で入れた項目は語を消したら戻す（applyTextPatch）。web phase5.test.ts「一言と札の組み合わせ」、E2E phase5.spec.ts「非公開の「最近の予定」を選んで確認へ進んでも…」
- （medium）ルール解析: toString などで落ちる・「9:00〜11時」の分を拾う・終わりの時刻の午後の決まり・夜／深夜の小さい時刻・時間帯の語のあとの空白・繰り返しのよくある書き方 → core nlp-rules.test.ts「ルール解析のレビューの指摘（Phase 5）」
- （medium）/api/parse の回数制限を同時の要求で超える → 枠を呼ぶ前に取る（server parse.test.ts「同時に送っても…」）
- （medium）AI の日付・人をルール解析の found で捨てる → aiFound（server「ルール解析が読めなかった日付・人も…」）
- （medium）日付の札のあとに日付を書くと複数日になる・終日の札のあとに時刻を書くと busy が残る → protectTouched（組ごと守る）
- （medium）重なりの警告が終わりのない既存の予定を見落とす → 60 分とみなす
- （low）件名に助詞・「(土)」・「〜」が残る、添えた曜日の食い違いを聞かない、毎年で過ぎた日、「22時〜24時」、ありえない毎月の日・重なる第n、呼び名の順のテストが失敗しえない（ほかの家族「はる」がいるときの「はるとで」で順番が効くテストにした）、複数日の曜日の食い違いの誤った質問、日付をまたぐ下書きの重なりの範囲、「月末にする」の答えが一言の書き直しで消える、解析中に一言が変わると「解析しています」のまま、オフラインでほかの家族の呼び名を見分けない（members に aliases）
- 却下（反証された 6 件）: 複数日の書き方の一部（§16 の範囲で表の形は読める）、名前に「明日」を含む家族、AI の日付の範囲の 1〜2 日の差、形の不正の reason、テストの名前（非公開の重なり・E2E の札）
- テストを直したもの: web phase5.test.ts「一言に書いていない日付・時刻・人は…」の期待値（書いていない公開・繰り返しを返さなくなった。直した不具合そのものを期待値にしていたため）、core「書いてあったもの…」の found の形（private・recurrence を足した）

