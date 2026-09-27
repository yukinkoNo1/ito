# RUNBOOK — 「いと」を最後まで自走で作る

Claude Code 向けの作業手順。仕様の正は `docs/SPEC.md`（v1.1）。守ることの要点は `CLAUDE.md`、進み具合は `docs/PROGRESS.md`（なければ作る）。このファイルと CLAUDE.md の既存の節は、持ち主が管理するので書き換えない。

## 0. いつ読むか
- 作業を始めるとき、各ステップの始まり、会話が要約されたあと、迷ったときに、このファイルと `docs/PROGRESS.md` を読み直す
- SPEC 全体は最初に 1 回通読し、あとは各ステップで該当する章を読む
- 大事な決定と進み具合は、会話ではなくファイル（`docs/PROGRESS.md`・`docs/plans/`・SPEC §24）に残す。会話は要約されて消える

## 1. 基本の動き方
- 持ち主はその場にいない前提で、質問して待たずに最後まで進める。ステップの区切りでも止まらない
- ただし、持ち主が会話で指示したとき（「このステップだけ」「承認を待って」など）はそちらを優先する
- SPEC の曖昧な点は「3. 決めてよいこと」と SPEC の意図（§1 の目的、§6.1 の使いやすさ、§18 のセキュリティ）に沿って決め、安全側（漏らさない・消さない）に倒す。決めたことは SPEC §24 に行を足し（D15 から）、PROGRESS.md の「決めたこと」にも書く。SPEC を変えたら、冒頭の版の注記に「v1.2（自走中の変更）: §…」の 1 行を足して、その行を更新していく
- 実装は自分で行う。サブエージェントは調査とレビューに使い、結論だけを受け取る（同じファイルを同時に書き換えさせない）

## 2. 止まってよいとき（これ以外では止まらない）
1. 全ステップと最終確認が終わり、最終報告を出したとき
2. 持ち主にしかできないことが必要で、ほかに進められる作業が残っていないとき
   - 管理者権限が要るインストール（Node 24・pnpm・git・Docker Desktop が無い）、Docker Desktop が起動していない
   - 本物の秘密情報（ANTHROPIC_API_KEY・TS_AUTHKEY など）
   - 実機での確認（iPhone の通知、ICS の取り込み）、本番サーバーへの設置、Tailscale の管理画面
   - → PROGRESS.md の「要確認」に、理由・根拠になるコマンドの出力・持ち主がやることを書く。ダミーや偽物で進められるものは進める（Push の送信はダミー、AI は固定の応答、鍵は開発用に生成）。本物が要る確認は最終報告に回す
   - ビルド・テスト・Docker のエラーなど**技術的な失敗は、これに当たらない**。直してから進む
3. 同じ問題に 3 通りの方法で挑んでも解決しないとき → 「要確認」に書き、それに依存しない作業を続ける。依存するものしか残っていなければ止まる

## 3. 決めてよいこと（SPEC の抜けと、その決め方。§24 に記録する）
- **ステップの順番**: Phase 0 → 1 → 2 → 6（UI 統合）→ 3 → 4 → 5 → 7 → 総点検 → 最終確認。SPEC §23 は Phase 6 を Phase 2 のあとに行うことを推奨している（3〜5 の画面を最初から本番の UI で作り、E2E を作り直さずに済む）。このため、後のフェーズの機能がないと確かめられない受け入れ項目は「後で確認」にして、最終確認で確かめる（§23 の「フェーズをまたいで先に進まない」の例外として記録する）
- **feed_tokens**: 「人の端末から最後に使われた時刻」の列を足す（§13.1 の `feed-token list` に「人の端末から使われた」と出すのに要る。last_used_at と同じく 5 分に 1 回まで書く）。§10 にも追記する
- **開発モードの「人の端末」**: X-Dev-Login が付いた要求を人の端末からの要求とみなす（DEV_LOGIN の既定の本人は数えない）
- **例外行の回の key**: 「この回だけ変更」の回の key は、変更前と同じ「親の ID@recurrenceId」。§3 にも明記する
- **管理者の自動登録**: 名前がほかの有効なメンバーとぶつかったら、20 文字に収まるように末尾に 2, 3… を付ける。色は §22 の順で、まだ使われていない最初の色にする
- **書く画面（S-05・F-22）**: 次を §16 に足してから実装する。件名が空なら保存できない（ボタンは「件名を入れてください」）/ シートを開いた時点で最近の予定を出す / 入力バーから開いたら表示中の日（最初は今日）、日の見出しの「＋」や月の日から開いたらその日を選んだ状態で開く（§6.2 の「入力バー → 候補 → 保存」の 3 タップのため）。§22 の quickDates の注釈にある「来週の土」は §16（日付を書き、曖昧な言い方をしない）と食い違うので、§16 に合わせて注釈を直す
- **空き時間の今日の扱い**: 今日の候補は、今の時刻を 30 分単位に切り上げた時刻より後だけにする
- **ギャラリー**: 本番のビルドには入れず、E2E 用のビルドにだけ入れる（§21 の E2E は本番ビルドで行い、§23 Phase 6 はギャラリーと本番の画面のスクリーンショットを比べるため）
- **手で確かめる受け入れ項目の代わり**: 「DevTools でインストール可能と表示される」（Phase 2）は、Playwright から CDP の `Page.getInstallabilityErrors` が空であることで確かめる。「60fps」（§19・Phase 7）は、1 年分の予定でスクロールしたときに 50ms を超える long task が出ないことで確かめる

## 4. 守ること（常に）

### 環境（Windows のローカル。本番は Ubuntu 上の Docker）
- 改行は LF に固定する（.gitattributes に `* text=auto eol=lf`。Biome も LF）
- ファイルは編集ツールで書く。PowerShell のリダイレクト（>、Out-File、Set-Content）では書かない（文字コードが変わって日本語が壊れる）
- package.json のスクリプトは Windows でも Linux でも動く書き方にする（rm -rf や「変数=値 コマンド」を使わず、Node のスクリプトや cross-env で）
- .dockerignore で node_modules・dist・`deploy/*.env` などを除く（Windows 用にビルドされた better-sqlite3 や秘密情報をイメージに入れない）
- 管理者権限が要ることや PC 全体に効く操作はしない（CLAUDE.md の「してはいけないこと」）。Playwright のブラウザは入れてよい
- Windows では Node に SIGTERM が届かない。終了処理は処理を直接呼ぶテストで確かめ、本物の SIGTERM は Docker の中で確かめる
- SQLite の DB や WAL のファイルは、消したり名前を変えたりする前に閉じる（Windows では開いたままだと EBUSY・EPERM になる）。一時ファイルの掃除は少し待ってやり直す

### 止まらないための決まり
- 終わらないコマンドを使わない: Vitest は `vitest run`、Playwright の HTML レポートは開かない（`open: 'never'`）、watch モードは使わない
- 対話が要るコマンドを使わない: pnpm approve-builds（依存のビルドスクリプト＝better-sqlite3 などは、固定した pnpm の版の書式で設定ファイルに許可を書く。§8）、drizzle-kit の対話（マイグレーションは列やテーブルを足すだけにし、名前を変えない）、エディタが開く git の操作（コミットは -m で）
- 裏で動かしたもの（開発サーバー、E2E 用のサーバー、docker compose up）は、確認が終わったら止める。止めるのは自分で起動したプロセスだけ。ターンの終わりに残さない
- E2E は開発サーバーと別のポートで動かし、`reuseExistingServer: false`（古いサーバーを使い回して、違うビルドを試さない）
- テストと E2E は、PC の環境変数に ANTHROPIC_API_KEY があっても実 API を呼ばない（スクリプトで空にし、差し替えたクライアントを使う）
- 自動モードで操作が止められたら、同じことを別の形で繰り返さない。PROGRESS.md の「要確認」に書いて、別の作業に移る

### 仕様とセキュリティ
- SPEC にないものは作らない（3. と §24 に記録したものを除く）。依存を足すときは理由を plans に 1 行書く。バージョンは lockfile で固定する
- **SPEC §18 のセキュリティ要件**。特に: 本番で 127.0.0.1 以外で待ち受けない / 状態を変える API の CSRF 検査 / 非公開予定の投影（表示用フィードは閲覧者なし＝持ち主の非公開も中身を出さない）/ /api/feed/* は ID ヘッダを使わず連携キーだけで認証し、連携キーはほかの API で受け付けない / ログに予定名・入力文・メールアドレス・連携キーを出さない / dangerouslySetInnerHTML 禁止
- deploy/compose.yaml の安全の設定（ts のカーネルモード、network_mode、cap_drop、read_only、uid）は、手元で通すために弱めない。手元の Docker Desktop で動かないところがあれば、.gitignore 済みの compose.override.yaml で回避し、「要確認」に書く
- 今の時刻は注入できる時計（Clock）から取る。Date.now() や引数なしの new Date() を直接呼ばない（フィードや通知のテストで偽の時計を使うため）
- **テストを弱めて通さない**: テストを消す・飛ばす（skip）・期待値を実装に合わせて書き換えることで通さない。テストが SPEC に照らして間違っているときだけ直し、理由を PROGRESS.md に書く。型エラーを any や @ts-ignore で隠さない
- **秘密情報**: コミットしない。画面・会話・ログに出さない。開発用の鍵（VAPID など）は生成して .gitignore 済みのファイルに書き、値は表示しない。連携キーを使う確認は、キーを表示しないスクリプトで行う（状態コードだけを出す）。本物の鍵は使わない。例は *.example に置く
- **git**: 論理的なまとまりごとにコミットする（Conventional Commits）。push・リモートの追加・reset --hard・clean・checkout -- ・push --force はしない
- `design/ui-export/` は UI 担当 AI の書き出し。Phase 6 まで触らない（Biome・型検査・テストの対象から外しておく）
- `docs/contracts/display-feed.v1.example.json` は いえボード と共有する契約なので、中身を変えない

## 5. 各ステップの進め方
1. **読む**: このファイルの該当する節、SPEC の該当する章、PROGRESS.md
2. **計画**: `docs/plans/<ステップ>.md` に、変更するファイル、追加するテスト、SPEC との食い違いと決めたことを書く。承認は待たない
3. **実装**して、まとまりごとにコミットする
4. **確かめる**: `pnpm check`（Biome＋型検査＋テスト）が通る。SPEC §23 の受け入れ基準を 1 項目ずつ確かめ、PROGRESS.md に「確認方法（テスト名・コマンド）と結果」を書く。後のステップでないと確かめられない項目は「後で確認」にする。deploy フォルダで `docker compose build` も通す（Linux でしか出ない問題＝ファイル名の大文字小文字などを拾うため）
5. **レビュー**: サブエージェント（書き換えなし）に、このステップの差分（前のタグとの git diff）を SPEC の該当章・§18・このファイルと突き合わせて指摘させる。指摘を直し、直さないものは理由を PROGRESS.md に書く
6. **締める**: PROGRESS.md を更新してコミットし、タグを付ける（`phase-0` など。総点検は `audit`）。そのまま次のステップへ進む

## 6. PROGRESS.md の形
```
# 進み具合
今: <ステップ> / 次にやること: <3 行以内>

## ステップ
| ステップ | 状態（未着手・作業中・完了） | タグ | メモ |

## 受け入れ基準
| ステップ | 項目 | 確認方法 | 結果（後で確認を含む） |

## 決めたこと（SPEC §24 に書いたもの）
## 後で足すテスト
## 要確認（持ち主がやること・確かめてほしいこと。根拠の出力も）
## 既知の問題
```

## 7. ステップ別の注意

### Phase 0 — 土台
読む章: §8, §9, §14, §18, §20, 付録A
- 最初に環境を確かめる: `node -v`（24 系）・`pnpm -v`・`docker version`・`git status`。足りないものは 2. のとおりに
- TypeScript 最新版（7 系）と Vite 8＋vite-plugin-pwa の組み合わせを小さく確かめ、問題があれば版を固定して §24 に記録する（§8）
- pnpm workspace（apps/web, apps/server, packages/core）。pnpm の版はルートの packageManager で固定。TS strict、Biome、Vitest、Playwright の雛形。ルートのスクリプト: pnpm dev / pnpm check / pnpm test:e2e / pnpm build / pnpm db:generate / pnpm db:migrate / pnpm seed
- apps/server: env.ts（付録A の変数を zod で検証し、§14 の起動時検査を満たさなければ起動しない。FEED_ALLOW_USER_DEVICES の既定は false）、Hono の骨組み、ミドルウェア（identity / csrf / host / セキュリティヘッダ / 本文 32KB 上限 / problem+json）、/healthz（Host 検査の対象外）、開発モード（DEV_LOGIN と、開発時だけ有効な X-Dev-Login）。起動時に z.config({ jitless: true })
- identity は /api/feed/* に掛からない組み立てにする（feed-auth は Phase 1）。plans に「経路（/healthz・/api/feed/*・ほかの /api/*・静的配信）ごとに、どのミドルウェアがどの順で掛かるか」の表を書く
- Drizzle の設定、members テーブルと最初のマイグレーション（本番は起動時に migrate() で適用。名前と色は有効なメンバーの間で重複不可＝§10）、開発用シード（家族 4 人: お父さん・お母さん・はると・さき。ログインは *@example.com）
- Dockerfile と deploy/（compose.yaml・ts-serve/serve.json・.env.example・app.env.example）を §20 のとおりに。ts はカーネルモード＋TS_AUTH_ONCE。サーバーは core ごと 1 ファイルにバンドル（better-sqlite3 だけ外部）し、CLI（src/cli.ts → dist/cli.js）も同じ方法で別の 1 ファイルにする（中身は Phase 1。今は --help だけ）
- compose は `env_file: app.env` があるので、手元で試すための `deploy/app.env` と `deploy/.env`（どちらも .gitignore 済み）を作る。app.env は開発用の値（NODE_ENV=production で動くので AUTH_MODE=tailscale、APP_ORIGIN は https:// のダミー、鍵は開発用に生成、ANTHROPIC_API_KEY は空）。.env の TS_AUTHKEY は空（ts は鍵なしで起動を試すだけ）
- `docker compose config -q` → build → `docker compose up -d --wait`（読み取り専用・uid 10001・healthy・空の volume でマイグレーション）→ `docker compose exec app node dist/cli.js --help` まで確かめて、down で止める
- CLAUDE.md の最後の注釈の下に追記する（上の節は消さず、全体で 100 行以内）: 主要コマンド / ディレクトリの役割 / 規約（TS strict、境界は zod で検証、日付は @ito/core/jst だけで扱い Temporal は使わない、今の時刻は Clock から）/ テスト方針
- README: 開発の始め方、本番の立て方（§20）、家族の端末セットアップ（付録B）
- `design/ui-export/` を Biome・tsconfig・Vitest の対象から外す

### Phase 1 — 予定の中核と表示用フィード
読む章: §10, §11（繰り返し以外）, §12 の /api/sync, §13, §13.1, §14 の認可と連携キー, §18 の T5・T15・T16, §20 の運用, §21 の API と表示用フィード
- projectEvent はサーバーから出るすべての経路で必ず通す。今ある経路（sync / activity / trash / 表示用フィード）ごとに「他人の非公開が漏れない」テストを書く（フィードは閲覧者なしで投影するので、持ち主の ID ヘッダが付いた要求でも title: null）。まだない経路（export / push の文面 / 朝のまとめ / search）は PROGRESS.md の「後で足すテスト」に載せる
- 作成は Idempotency-Key 必須、更新・削除は If-Match 必須。検査は「認可 → If-Match」の順。409 のときは projectEvent を通した最新の EventDTO を返す
- 例外行の owner_id・visibility は常に親から複製し、親が変わったら同じトランザクションで更新する（§10）
- activity の diff は人が読める文字列（例「開始 8:00 → 7:00」）をサーバー側で作る
- メンバーの名前の重複禁止（NFC・前後の空白除去のあとで比べる。§10）は、追加・変更・再有効化のすべてで効かせる（自動登録は 3. のとおり）
- 画面は SPEC §6 のルートで最小限の素朴な HTML。この段階ではオンライン専用でよい（Phase 6 で本番の UI に差し替える）

表示用フィード（§13.1）
- /api/feed/* には identity と CSRF を掛けない。plans の経路の表を更新し、次をテストで固定する: GET・HEAD 以外は CSRF の 403 ではなく 405 / キーが通るまでは 304 も本文も返さない / 回数制限はキーが通った要求だけをキーごとに数える（§14 の「全体と同じく」を、認証の前に数えるという意味にしない）
- 本文は項目と回の並びを固定して組み立て、同じデータ・同じ日付なら同じバイト列にする（生成時刻を入れない）。ETag はその本文から作る
- 連携キーは SHA-256 だけを保存し、照合はハッシュで引く。ログは pino の redact に加えて、ito_feed_ で始まる文字列をどこに出てもマスクする
- feed_tokens の列と、開発モードの「人の端末」の判定は 3. のとおり
- CLI（src/cli.ts → dist/cli.js）: feed-token create --name / list / revoke <id>。create はキーを 1 回だけ表示し、メンバーの一覧（名前・略称）も出す。有効なキーは 5 つまで。開発用の pnpm スクリプトを用意し、README の運用に使い方を足す
- 受け入れの「CLI で発行したキーで curl すると 200、止めると 401」は、キーを表示しない確認スクリプト（create → 要求 → revoke → 要求 を行い、状態コードだけを出す）で確かめる。Docker の中の CLI（docker compose exec app node dist/cli.js）でも、同じやり方で確かめる
- docs/contracts/display-feed.v1.example.json を §13.1 の例のとおりに作る。偽の時計を 2026-09-29 7:30 にして同じメンバー・予定を入れ、パースした値で比べるテストを書く。この段階では朝練（繰り返し）を除いて比べる

### Phase 2 — PWA とローカルファースト
読む章: §12, §17, §18（Service Worker と CSP）
- 画面は常に Dexie から描画する（useLiveQuery）。API の応答を直接待って描画しない
- outbox は §12 のとおり: 同じ予定の送信待ちを畳む / 成功したら後続の If-Match を新しい version に / 応答ごとの扱いの表（409 は後続を止めない、426 は outbox を残す）/ snapshot で元に戻す
- 「オフラインでは操作できない」を判定する関数を用意しておく（Phase 3 の繰り返し編集で使う）
- Service Worker は injectManifest。ナビゲーションの除外リスト（/api/・/healthz）、SKIP_WAITING の受信、cleanupOutdatedCaches。/api/* はキャッシュしない。インラインスクリプトを生成しない
- アイコンは仮のものでよい（Phase 6 で icon.svg から作り直す）
- 新着の印（§12 の F-21: 端末ごとの「前回開いた時刻」と updatedAt / updatedBy で判定）と、ホームの案内（F-23 のうちホーム画面への追加。閉じたら出さない）
- E2E は §21 の「E2E モード」（本番ビルドを Hono が配信、chromium＋iPhone 15 のビューポート）。context.setOffline と page.route での API 遮断の両方を書き、securitypolicyviolation とコンソールエラーが 0 件であることも確かめる。インストールできるかは 3. のとおり CDP で確かめる

### Phase 6 — UI 統合（Phase 2 の次に行う）
読む章: §6, §17, §18 の CSP, §22, §23 Phase 6
- `design/ui-export/` の中身（tokens.css / styles.css / primitives / screens / sheets / gallery / mock.ts / icon.svg / README.md）を `git mv` で `apps/web/src/ui/` に移し、Biome・型検査の対象に戻す。props の形は §22 の型とずれている前提
1. 対応表: ui/screens・ui/sheets の各画面と、SPEC §6 の画面 ID・§22 の props 型の対応表を plans に作る。足りない画面・状態・props を一覧にする
2. props を合わせる: 見た目（マークアップと CSS）は変えずに、各画面の props を §22 の型に書き換え、§22 の型を apps/web/src/ui/types.ts に置く。難しい箇所は薄いアダプタを挟んでよい。ui/ の中にデータ取得や状態管理があれば props に出す
3. 接続: features/* のコンテナと viewmodels/*（core のデータ → §22 の型。テスト必須）。ギャラリーの mock も §22 の型に合わせる
4. 取り除く・置き換える: 外部 CDN、インラインの <script> や <style> の注入、dangerouslySetInnerHTML（§18 の CSP）。書き出しの元の src/index.css は Google Fonts（Geist Mono 400/500 と Instrument Serif）を CDN から読み、tailwindcss → ui/tokens.css → ui/styles.css の順に import していた。フォントは @fontsource で自己ホストにし、同じ順で読み込む。ui/ はアイコンに lucide-react を使っている（依存に追加）。ui/ は Biome で整形してよい（見た目は変えない）
5. 色: ui/tokens.css の値を §22 の色と照らし、違っていれば §22 に戻す。Tailwind の @theme を tokens.css に接続し、テーマ（端末に合わせる / ライト / ダーク）を html の data-theme で切り替える（端末に合わせるときは prefers-color-scheme を見て付ける）
6. ギャラリーは /__gallery のルートにし、開発と E2E 用のビルドにだけ入れる（本番のビルドからは外す。3. のとおり）
7. icon.svg から PWA のアイコン（192、512、maskable 512、apple-touch-icon 180）を作るスクリプトを追加し、仮アイコンと差し替える
8. 素朴な HTML の画面を本番の UI に置き換え、Phase 2 の E2E を本番の UI に合わせて直す
9. まだない機能の画面（C-04 の範囲選択は Phase 3、通知の設定は Phase 4、一言入力と F-22 の候補は Phase 5、空き時間 S-06・検索 S-10 は Phase 7）は、props を §22 の型に合わせて置いておき、中身はそのフェーズでつなぐ
10. 確認: §23 Phase 6 の受け入れ基準（§6.2 の使いやすさの基準をタップ数で、「大きめ」の文字、ギャラリーと本番の画面のスクリーンショットの比較、axe、CSP 違反ゼロ、色の一致）と、入力欄の文字 16px 以上・タップ領域 44px 以上。スクリーンショットは同じデータと固定した時計（page.clock）で撮る。まだつながっていない操作の手数は「後で確認」にする

書き出しで見つかっている問題（あわせて直す）
- 型エラー 2 か所: gallery/Gallery.tsx 24 行目と screens/TrashScreen.tsx 37 行目。型の { a: X b: Y } に区切りがない
- 家族の色: tokens.css には 8 色あるが、styles.css の member-tag と mock.ts の MemberColor は 4 色（asagi・momo・yamabuki・wakatake）だけ。§22 の 8 色すべてに対応させる
- 予定の詳細: 他人の非公開（「予定あり」）でも「編集・複製・削除」が出る → 出さない（§14 の認可）
- 画面の中に固定の値がある（例: 見出しの「2026年」「9月27日」、週の帯の「9月27日 — 10月3日」、今日のまとめの文、「父　出張中（〜30日）」、日付選択の「2026年9月」、ゴミ箱の「さき が 9/24 に削除」「あと27日」、書く画面の日付の判定の直書き）→ 洗い出して、すべて props から
- 日付選択: 前後の月へ移れない → 月送りを付ける
- 「自分」で絞っても、ほかの人の続いている予定（父の出張）の行が残る → 出さない
- 書く画面: 3. の決まり（件名必須・開いた時点で最近の予定・表示中の日を選んだ状態で開く）に合う props と表示にする
- タップ領域 44px 未満: 週の帯の日付（52×42）、検索欄（高さ 40）、月の画面の週の始まりの切り替え（53×26）。週の始まりは設定にあるので、月の画面からは外す
- 非公開の「予定あり」の斜線が文字（"//////"）で描かれている → CSS の模様（repeating-linear-gradient）に
- 「大きめ」の文字がギャラリーだけの zoom で作られている → html の属性（例: data-text-size）でルートの文字サイズを変える形に

### Phase 3 — 繰り返し
読む章: §11 全体、§13.1（表示用フィードの繰り返し）
- 画面は Phase 6 で入れた本番の UI に足す（素朴な HTML を作らない）
- rrule は @ito/core/recurrence の中だけで使い、外には Occurrence 型だけを出す。浮動時刻の扱いはコードのコメントで説明する
- 同じテストデータで「core を直接」「サーバーの API 経由」「PWA の viewmodel 経由」の 3 通りの展開結果が一致することを確認する
- 入力制限（HOURLY 以下の拒否、INTERVAL・COUNT の上限、展開の打ち切り）のテストを書く
- COUNT と UNTIL は併用しない。時刻ありの UNTIL は浮動時刻の YYYYMMDDT235959 で保存する（rrule は日付だけの UNTIL を 0:00 と解釈する）
- 「これ以降」: 元の COUNT を外して UNTIL、新シリーズは残り回数、reminder_prefs を複製、初回なら「すべて」と同じ。「すべて」の日時変更は選んだ回との差分をマスターに適用
- 「これ以降」「すべて」で例外や取り消しが消える場合は件数を返し、C-04 で確認させる
- UI 契約の RecurrenceEndVM（なし／◯回／◯日まで）を COUNT / UNTIL に変換する関数とテスト
- 表示用フィードも expand() を通す。例のファイルとの比較に朝練（繰り返し）を含め、「この回だけ変更」「この回だけ削除」がフィードに出ること、そのとき ETag が変わることをテストする。例外行の回の key は 3. のとおり

### Phase 4 — 通知
読む章: §15, §17, §18 の T8
- 画面は本番の UI に足す
- 時計は Phase 0 からの Clock を使い、スケジューラは偽の時計でテストする。§15 のとおり、展開範囲は開始が [今−1450分, 今＋8日] の回（開始時や当日朝の通知を拾うため）、送るのは通知時刻が (今−10分, 今] のもの、log は送信成功後に書く、キーに開始時刻を含める。テストは §21 の「通知」の一覧すべて
- web-push の送信部分はインターフェースで差し替え可能にし、テストでは記録するだけのダミーを使う。TTL と urgency を必ず指定する
- Service Worker の push では showNotification より前に await を置かない。起動・前面復帰のたびに getSubscription() を確かめて upsert／再購読する（iOS は購読が黙って失効する）
- 端末ごとの購読一覧と削除（本人・管理者）、メンバー無効化で全購読を削除
- 非公開予定は持ち主以外への通知・まとめで「予定あり」になることをテストする
- notificationclick で開く url は同一オリジンのパスに限る
- iPhone はホーム画面に追加していないと購読できない。設定と、ホームの案内（F-23 のうち通知。§15）での分岐を実装する
- README に実機での確認手順を書く（iPhone でホーム画面に追加 → 通知オン → テスト通知 → 5 分後の予定の通知 → 1 日アプリを開かなくても翌朝のまとめが届く）。実機での確認は「要確認」に回す

### Phase 5 — 一言入力
読む章: §16 全体、§21 のルール解析の表
- 画面は本番の UI に足す。書く画面の決まりは 3. のとおり §16 に足してから実装する
- まず §21 の表の 38 件を table-driven テストにしてから、ルール解析を実装する（テストが先）
- Anthropic クライアントは差し替え可能にし、テストでは固定の応答を返す。refusal / max_tokens / タイムアウト / 形式の不正 → ルール解析に切り替わることをテストする
- スキーマの member_keys の enum はリクエストごとに有効メンバー数から作る（実名を入れない）。enum の値は大文字小文字を無視して比較する
- 入力文がログ・DB・エラー応答に残らないことをテストで確かめる
- 日本語入力の変換確定の Enter で送信しない（!e.nativeEvent.isComposing && e.keyCode !== 229 のときだけ確認へ）
- かんたん入力の候補（§16 の F-22）: 日付の札には日付を書き「来週の土」のような曖昧な言い方をしない / 最近の予定は端末内の DB から作る / 保存ボタンの文言に日時を入れ、日付と件名が決まるまで押せない
- pnpm ai:eval: §21 の表の入力を実 API に投げ、期待値との差を表で出すスクリプト。ANTHROPIC_API_KEY があるときだけ動き、pnpm check や CI では実行しない。作るだけで、実行は「要確認」に回す（本物の鍵を使わないため）

### Phase 7 — 仕上げ
読む章: §15 の掃除とバックアップ、§18, §19, §21, §23 Phase 7
- 画面（S-06 空き時間・S-10 検索）は Phase 6 で置いた本番の UI につなぐ
- 空き時間は @ito/core/freebusy に実装する: 夜（17–24時）・休日（土日祝の 8–24時）・終日（6–24時）のプリセット、今日の扱いは 3. のとおり、busy=false の予定は除く、他人の非公開は「予定あり」として含める、終了時刻なしは 60 分、日付をまたぐ予定は翌日側にも反映
- 書き出し: JSON と ICS。ICS は VTIMEZONE(Asia/Tokyo)、終日は DTEND を翌日（排他的）に変換、例外は RECURRENCE-ID 付きの VEVENT。他人の非公開は含めない。iPhone のカレンダーへの取り込みは「要確認」に回す
- バックアップと掃除のジョブ（§15）: 14 世代のローテーションをテストで確かめる
- PROGRESS.md の「後で足すテスト」（非公開の漏えいテストなど）をすべて追加する
- 性能確認: 1 年分の予定で 60fps（3. のとおり long task で）・同期サイズ（§19）、表示用フィード（3 日分で 20KB 未満・応答 100ms 未満、変化がなければ 304）
- §18 の表（T15・T16 を含む）を 1 行ずつ「どのコードとどのテストで担保しているか」の対応表にして docs/security-map.md に書く

### 総点検 — 攻撃者の視点（タグは audit）
docs/SPEC.md の §14 と §18 の脅威モデルに照らして、攻撃者の視点でこのリポジトリを監査する。コードを直すのは、失敗する再現テストを書いてから。
- 観点
  - 本人確認: ID ヘッダを偽装できる経路はないか（127.0.0.1 以外で待ち受けていないか、ts がカーネルモードか＝tailnet から :8787 に届かないか、X-Dev-Login が本番で効かないか、compose の network_mode、/healthz の Host 例外が他のパスに広がっていないか）
  - CSRF: 状態を変える全ルートに X-Ito-Client・Content-Type・Origin・Sec-Fetch-Site・Host の検査が掛かっているか。ルート一覧から機械的に確かめる
  - 非公開予定の漏えい: sync / activity / trash / search / export（JSON・ICS）/ push の文面 / 朝のまとめ / 一言入力の重なり警告 / 表示用フィード / エラー応答
  - 表示用フィードと連携キー: 連携キーが /api/feed/* 以外で効かないか。フィードで ID ヘッダが使われていないか（持ち主の ID が付いても title: null）。キーが通る前に 304・ETag・本文が出ないか、回数制限を消費しないか。FEED_ALLOW_USER_DEVICES=false で ID ヘッダ付きの要求が必ず 403 になるか。止めたキーが次の要求から 401 になるか。キーの平文がログ・DB・エラー応答・CLI の一覧に出ないか
  - XSS: メモのリンク化、地図リンク、通知の url（オープンリダイレクトにならないか）
  - Service Worker: API の応答をキャッシュしていないか。notificationclick の url を同一オリジンに限っているか
  - 入力: 文字数・本文サイズ・rrule（巨大な COUNT や高頻度で展開が膨らまないか）・回数制限
  - 秘密情報: ビルド成果物・Docker イメージ・ログ・エラー応答に API キー・連携キー・入力文が出ないか
  - コンテナ: 非 root・読み取り専用・cap_drop・app.env の扱い
  - Tailscale のポリシー: 手で確かめる手順を README に書く（tag:ito に届くのは group:family と tag:ieboard の 443 だけか、tag:ieboard から人の端末へ通信を始められないか）。確認そのものは「要確認」に回す
  - 依存: pnpm audit --prod
- 進め方: サブエージェント（書き換えなし）に攻撃経路を洗い出させる → 疑わしい点ごとに失敗する再現テストを書く → 直してテストが通ることを確かめる → docs/security-review.md に表（ID / 深刻度 / 経路 / 再現テスト名 / 修正コミット / 残るリスク）で書く。推測だけの指摘は「未検証」と明記する

### 最終確認
各コマンドのあとに、終了コードを `EXIT=<数字>` の 1 行で会話に出す。長い出力は .gitignore 済みのファイル（例: `.logs/final-check.txt`）に残し、会話には要点と終了コードを出す。
1. `pnpm install --frozen-lockfile` → `pnpm check` → `pnpm build` → `pnpm test:e2e`
2. deploy フォルダで `docker compose build` → `docker compose up -d --wait`（app が healthy になるまで待つ）→ `docker compose exec app node dist/cli.js feed-token list` → `docker compose down`
3. 全ステップの受け入れ基準を見直す（「後で確認」にしたもの、特に Phase 6 の §6.2 の手数を含む）
4. `git status` がクリーン、`git tag` に phase-0〜phase-7 と audit がある
5. 最終報告を PROGRESS.md に書いてコミットし、同じ内容を会話に出す
   - 作ったもの（1 段落）
   - 1〜4 の結果（EXIT の一覧）
   - 受け入れ基準の表（ステップ・項目・確認方法・結果）
   - SPEC §24 に足した決定
   - 要確認（持ち主がやること）: 実機での通知の確認（README の手順）、ICS を iPhone に取り込む、本番の設置（§20）と Tailscale のポリシー、いえボードとつなぐ（連携キーの発行）、ANTHROPIC_API_KEY を入れて pnpm ai:eval、そのほか止まった理由（根拠の出力つき）
   - 既知の問題と、次にやるとよいこと
   - 動かし方（開発・本番）
