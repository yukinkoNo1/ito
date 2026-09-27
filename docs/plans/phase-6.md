# Phase 6 — UI 統合 計画

読む章: §6, §17, §18 の CSP, §22, §23 Phase 6、RUNBOOK 7. Phase 6（書き出しで見つかっている問題）

`design/ui-export/` を `apps/web/src/ui/` に `git mv` した（tokens.css / styles.css / primitives / screens / sheets / gallery / mock.ts / icon.svg / README.md）。調査はサブエージェントに任せ、結論だけを受け取った（ワークフロー ui-export-survey）。

## 1. 対応表
| ui/ の部品 | 画面 ID | §22 の props | 主な違い（書き出し → §22） |
|---|---|---|---|
| primitives/AppBottomArea + 各画面の `.bottom-area` | C-01 AppShell・C-02・C-03 | AppShellProps | 各画面が下の帯を自前で持っていた → AppShell にまとめる（`main.app-shell` と `.bottom-area` は AppShell が描く）。トーストは `.undo-bar`、C-02 は `.connection-state`（「再試行」付き） |
| primitives/ScheduleEventRow | S-01・S-03・S-10 の行 | OccurrenceVM・MemberVM | CalendarEvent → OccurrenceVM。`event.key === "yoga"` の直書きの過去 → `past`。`isNew` → `fresh`。`changeLabel` はなし |
| primitives/ThreadRail | 糸 | MemberVM | Member → MemberVM。4 人分の位置しかない → 5〜8 人は style の位置（§24 D29） |
| screens/UpcomingScreen | S-01 これから | FlowScreenProps | 自前の日付計算・固定の日付（2026年・9月27日・週の帯・まとめ・父の出張）→ props。書く画面・編集シートは S-05・S-04 に分けて取り除く。日付選択に月送り |
| screens/MonthScreen | S-02・S-03 | MonthScreenProps | MonthVM を描く。週の始まりの切り替えは外す（設定にある）。複数日の線の位置は style で。年月の選択は onPickMonth |
| sheets/EventDetailSheet | S-04 | EventDetailScreenProps | 中の状態（通知・小さな編集・競合・削除の範囲）を props に。場所・メモの直書き → occ。メモの URL は http(s) だけリンク。他人の非公開は操作の帯ごと出さない |
| sheets/EventDetailSheet の SmallEditSheet | S-04 の「その項目だけ直す」 | FieldEditSheetProps（足す。§24 D29） | 日付・時刻・人の札。詳細のシートの中に重ねる |
| sheets/EventDetailSheet の ConflictSheet | C-05 | ConflictSheetProps | 固定の文 → mine と theirs の違いから作る |
| sheets/EventDetailSheet の RecurrenceDeleteSheet | C-04 | RecurrenceScopeDialogProps | 削除だけ → 編集・削除。offline で「これ以降」「すべて」を無効に |
| sheets/EventComposerSheet | S-05 | ComposerSheetProps | 中の状態と見せかけの解析をすべて props に。札・候補・保存ボタンの文言は ComposerVM から |
| screens/AvailabilityScreen | S-06 | FreeTimeScreenProps | 固定の候補・固定の % の帯 → FreeTimeVM（Phase 7 でつなぐ。今は型を合わせて置く） |
| screens/SettingsScreen | S-07 | SettingsScreenProps | 固定の値 → SettingsVM。パネルの選択肢は props から |
| （なし） | S-07b 家族の管理 | MembersAdminScreenProps | 書き出しにない → 設定と同じ部品（.settings-section・.setting-row）で作る |
| screens/HistoryScreen | S-08 | ActivityScreenProps | 固定の行 → ActivityVM。`member-text--*` の CSS がない → 足す |
| screens/TrashScreen | S-09 | TrashScreenProps | 固定の行・中の状態 → TrashItemVM |
| screens/SearchScreen | S-10 | SearchScreenProps | 中の検索 → props（Phase 7 でつなぐ） |
| screens/OnboardingScreen | S-11 | OnboardingScreenProps | 固定の名前 → me。選んだ色は onPickColor |
| screens/InstallGuideScreen | S-12 | InstallGuideScreenProps | canPrompt・onPromptInstall |
| gallery/Gallery・mock.ts | /__gallery | §22 の型の mock | mock を §22 の型に。E2E 用のビルドにだけ入れる |

## 2. 足りない画面・状態・props
- S-07b 家族の管理（書き出しにない）
- C-02 の「再試行」、見出しの下の同期状態、月の区切り・予定なしの行（gap）・現在時刻線・週の帯の選んだ日、トーストの info・error → 既存のクラスを流用して足す
- 詳細の中に重ねる小さなシート（FieldEditSheet）の型、AppShell の画面ごとの修飾クラス → §22 に足す（§24 D29）

## 3. 直すこと（RUNBOOK の既知の問題と調査の結論）
- 型エラー 2 か所（Gallery.tsx 24 行・TrashScreen.tsx 37 行の区切りのない型）→ 書き直しで消える
- 家族の色 8 色: `.member-tag--*`・`.dot--*`・`.thread--/.node--{color}`・`.month-event--*`・`.month-span--*`・`.timeline-legend--*`・`.availability-lane--*`・`.search-person--*`・`member-text--*`（なし）を 8 色に
- 他人の非公開の詳細では「編集・複製・削除」の帯を出さない（§14）
- 固定の値をすべて props から（見出しの年・日付、週の帯、まとめ、出張の行、日付選択の年月、ゴミ箱の文、書く画面の日付）
- 日付選択に月送り、「自分」で絞ったときにほかの人の続いている予定の行を出さない（viewmodel で済み）
- 書く画面: 件名必須（「件名を入れてください」）、開いた時点で最近の予定、表示中の日を選んだ状態（§16 に足す。RUNBOOK 3.）
- タップ領域 44px: 週の帯の日付（2.625rem → 2.75rem）、検索欄（高さ 40）、月の画面の週の始まりの切り替え（画面から外す）
- 非公開の斜線を文字（"//////"）から repeating-linear-gradient に
- 「大きめ」: ギャラリーだけの zoom → html[data-text-size="large"] で :root の font-size を 115%
- コントラスト（axe）: `.event-row--past`・`.month-cell--outside` の opacity、`.thread-color > span`・`.onboarding-color > span` の糸の色の文字 → 見た目をほぼ変えずに --ink-3 系・--m-*-text に（§24 D30）
- ダーク: html の data-theme（system は prefers-color-scheme を見て付ける）
- フォント: @fontsource/instrument-serif・@fontsource/geist-mono を自己ホスト（tailwind → tokens.css → styles.css の順に読む）
- body・html・#root の余白と高さ（index.css）
- アイコン: scripts/gen-icons.mjs（@resvg/resvg-js）で icon.svg から作る（C2PA の metadata は取り除いて描く）

## 4. 依存を足す理由
- lucide-react: ui/ のアイコン
- @fontsource/instrument-serif・@fontsource/geist-mono: フォントの自己ホスト（§17）
- @resvg/resvg-js（dev）: icon.svg → PNG（ビルド済みのバイナリ。スクリプトなし）
- @axe-core/playwright（dev）: axe の違反ゼロの確認

## 5. 決めたこと（§24 に書く）
- D29: §22 の型を足す — AppShellProps.screen（画面ごとの修飾クラス）・AppShellProps.overlay（詳細・書く画面。下は inert、トーストはシートの上）、EventDetailScreenProps.children（詳細の中に重ねる小さなシート・C-04・C-05）、FieldEditSheetProps、SyncVM.errorLabel・action。「今日に戻る」は FlowScreen から AppShell の下の帯へ portal で描く。糸の位置は 4 人までは書き出しのクラス、5〜8 人は均等割りの style
- D30: コントラストと 44px のための見た目の小さな変更（opacity → 色、糸の色の文字 → text の色、週の帯の高さ）
- D31: ギャラリーは E2E 用のビルドにだけ入れる（RUNBOOK 3.）。スクリーンショットの比較は同じデータ・固定の時計で、ギャラリーの状態と本番の画面の `.app-shell` を比べる

## 6. つなぎ方（実装）
- `app/nav.tsx`: 詳細（`/e/:id?r=`）は開く前の画面（location.state.background）の上に重ねる。`<Routes location={base}>` で背景の画面を描き、詳細・書く画面は ShellLayout が AppShell の `overlay` に入れる。書く画面は今の URL の `?compose=1&date=&edit=&duplicate=&text=&time=&more=`（開け閉めは replace で履歴に積まない）
- `app/view-date.tsx`: これから・月で見ている日。入力バーから開くとその日を選んだ状態（§16）
- `app/appearance.ts`: テーマ（me.settings.theme。端末に写して、描画の前に当てる）と文字の大きさ（端末ごと）
- `features/*/*Container.tsx`: store・viewmodels → ui の画面。素朴な HTML の画面（Phase 1・2）と `app/Shell.tsx`・`features/common/DayList.tsx` は消した
- 一言の解析（F-22 の曖昧さ・重なり・source）は Phase 5、空き時間の候補・検索は Phase 7、通知の設定・端末は Phase 4、繰り返しの範囲（C-04）は Phase 3 でつなぐ。それまでの画面は §22 の型のまま置く（一言はそのまま件名にする）
- これからの追加読み込みは、利用者がスクロールしたときだけ（最初に今日へ合わせたスクロールでは読まない）。前に足したら見ていた位置を保つ（Safari にはスクロールアンカーがない）
- ギャラリー: `/__gallery?s=<状態>&theme=&bare=1`。見本は `ui/mock-data.ts`（素のデータ。E2E と共有）→ `ui/mock.ts`（本番と同じ viewmodels で §22 の型に）
- CSP: 小さなフォントが data: URI に埋め込まれて font-src 'self' に止められたので、`build.assetsInlineLimit: 0`

## 7. テスト
- web 単体 `test/phase6.test.ts`: tokens.css と §22 の色、types.ts と §22 の型、開始の時刻を動かしたら長さを保つ、日付の札、ComposerVM（最近の予定・件名必須・編集の文言）、SyncVM（426 の「更新」・403 のログイン）、移動した日の見出し、見本の投影、テーマ、地図のリンク
- E2E `e2e/phase6.spec.ts`: ギャラリーと本番の `.app-shell` のスクリーンショット（これから・月）、§6.2 の手数、「大きめ」で横にはみ出さない、axe（WCAG 2.0/2.1 A・AA と 2.2 AA、ライト・ダーク）、入力欄 16px・タップ領域 44px、はじめて（S-11）、ギャラリーの全部の状態。Phase 1・2 の E2E は本番の UI の名前に合わせて直した
