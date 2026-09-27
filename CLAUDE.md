# いと（家族カレンダー PWA）

家族専用のカレンダー PWA。仕様は `docs/SPEC.md` が唯一の正。

## 最初に読むもの
- 作業の手順: `docs/RUNBOOK.md`。各ステップの始まり、会話が要約されたあと、迷ったときに読み直す
- 進み具合: `docs/PROGRESS.md`（なければ RUNBOOK の形で作る）。大事な決定と進み具合は会話ではなくファイルに残す
- 決定の記録: SPEC §24

## 進め方
- 持ち主は長い時間その場にいない。RUNBOOK のとおり、質問して待たずに最後まで進める
- ただし、持ち主が会話で指示したとき（「このステップだけ」「承認を待って」など）はそちらを優先する

## 持ち主が許可していること（このリポジトリの作業のため）
- pnpm（install とスクリプト）、Vitest、Playwright（ブラウザのインストールを含む）、Biome、tsc の実行
- Docker は compose プロジェクト `ito`（deploy/compose.yaml）の build・up・exec・logs・down だけ
- 開発用の鍵（VAPID など）と開発用の設定を作り、.gitignore 済みのファイル（deploy/app.env など）に保存すること。値は画面・会話・ログに出さない
- ローカルでのコミットとタグ

## してはいけないこと
- git push（--force を含む）、リモートの追加や変更、git reset --hard、git clean、git checkout -- .、このセッションで作っていないコミットの amend
- リポジトリの外を書き換えること（パッケージやブラウザのキャッシュを除く）。PC 全体に効く操作: docker の prune、ito 以外のコンテナやボリュームの操作、taskkill /IM のような名前での一括終了、git config --global、Set-ExecutionPolicy、winget やインストーラ、管理者権限が要ること
- 本物の秘密情報を使う・コミットする・画面や会話やログに出す（連携キー ito_feed_… を含む）
- テストを消す・飛ばす・弱めて通す。型エラーを any や @ts-ignore で隠す
- SPEC §18 のセキュリティ要件を破ること（127.0.0.1 以外で待ち受けない、CSRF の検査、非公開の投影、/api/feed/* は連携キーだけで認証、ログに予定名・入力文・メールアドレス・連携キーを出さない、dangerouslySetInnerHTML 禁止）
- deploy/compose.yaml の安全の設定（ts のカーネルモード、network_mode、cap_drop、read_only、uid）を、手元で通すために弱めること
- ブロックされた操作を別の形で繰り返すこと。PROGRESS.md の「要確認」に書いて、別の作業に移る

## 環境
- Windows のローカルフォルダで、Claude アプリの Code タブから動いている（WSL は使わない）。本番は Ubuntu 上の Docker
- 改行は LF。ファイルは編集ツールで書き、PowerShell のリダイレクト（>、Out-File、Set-Content）では書かない（文字コードが変わって日本語が壊れる）
- 終わらないコマンドと、対話が要るコマンドを使わない（watch モード、HTML レポートを開く、pnpm approve-builds など）。ターンの終わりに、自分で起動したプロセスを残さない

<!-- ここから下は Phase 0 で Claude Code が追記する（主要コマンド・ディレクトリの役割・規約・テスト方針）。上の節は消さない -->
