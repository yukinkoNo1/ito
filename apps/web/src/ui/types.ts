// apps/web/src/ui/types.ts — 「いと」画面の props の正（docs/SPEC.md §22）
// UI 担当 AI の成果物は Phase 6 でこの型に合わせる。変えるときは SPEC §22 も更新する。
import type { ReactNode } from 'react';

/* ───────── 基本 ───────── */

/** 'YYYY-MM-DD'（日本時間の日付） */
export type DateISO = string;
/** 'HH:mm'（24時間表記・日本時間） */
export type TimeHM = string;
/** 0=日 1=月 2=火 3=水 4=木 5=金 6=土 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 家族の色（日本の伝統色）。tokens.css の --m-<color>-thread / -text に対応（淡い面は color-mix で作る。§22） */
export type MemberColor =
  | 'yamabuki'
  | 'wakakusa'
  | 'wakatake'
  | 'asagi'
  | 'fuji'
  | 'momo'
  | 'ruri'
  | 'kaki';

export interface MemberVM {
  id: string;
  name: string; // 表示名 例: 'お父さん'
  mark: string; // 1文字の略称 例: '父'（糸のラベルなど狭い場所で使う）
  color: MemberColor;
  isMe: boolean;
}

/* ───────── 予定 ───────── */

/** 予定の「1回分」。繰り返し予定は回ごとに1つ */
export interface OccurrenceVM {
  key: string; // 一意（繰り返しは回ごとに異なる）
  eventId: string;
  title: string | null; // null = 他の家族の非公開予定 →「予定あり」と表示
  allDay: boolean;
  startDate: DateISO;
  endDate: DateISO; // 終日: 最終日（その日を含む）/ 時刻あり: 終わる日（日付をまたぐと翌日）
  startTime: TimeHM | null; // 終日は null
  endTime: TimeHM | null; // 終了時刻なし・終日は null
  memberIds: string[]; // 関係する家族（forEveryone のときは全員のID）
  forEveryone: boolean;
  location: string | null;
  note: string | null;
  recurrenceLabel: string | null; // 例: '毎週 月・木'（繰り返しなしは null）
  isPrivate: boolean; // 非公開（自分の非公開予定、または他の家族の非公開予定）
  busy: boolean; // 空き時間の計算で「予定あり」とみなすか
  sync: 'synced' | 'pending' | 'conflict'; // pending=未送信 / conflict=家族の変更と衝突
  fresh: boolean; // 前回この端末で開いたあとに、家族が追加・変更した（「新」の印）
}

export type SpanPosition = 'single' | 'start' | 'middle' | 'end';

export interface DayVM {
  date: DateISO;
  weekday: Weekday;
  holiday: string | null; // 祝日名
  isToday: boolean;
  isPast: boolean;
  allDay: { occ: OccurrenceVM; span: SpanPosition }[];
  timed: { occ: OccurrenceVM; past: boolean }[]; // 開始時刻順
  nowIndex: number | null; // 今日のみ。timed[nowIndex] の直前に現在時刻線（timed.length なら末尾）
  ongoingMemberIds: string[]; // 複数日の終日予定が続いている家族（この日の区間は糸を太くする）
}

export type FlowItem =
  | { kind: 'month'; key: string; year: number; month: number; label: string } // 月の区切り見出し
  | { kind: 'day'; key: string; day: DayVM }
  | { kind: 'gap'; key: string; from: DateISO; to: DateISO; days: number; label: string }; // 予定のない日をまとめた1行

export interface SyncVM {
  status: 'synced' | 'syncing' | 'offline' | 'error';
  lastSyncedLabel: string | null; // 例: '14:18'
  pendingCount: number; // 未送信の変更数
  errorLabel: string | null; // status が error のときの理由（C-02 に出す。§12 の 401・403・426。§24 D29）
  action: 'retry' | 'update'; // C-02 のボタン（426 は「更新」。§24 D29）
}

/* ───────── 月 ───────── */

export interface MonthCellVM {
  date: DateISO;
  day: number; // 1〜31
  weekday: Weekday;
  inMonth: boolean;
  holiday: string | null;
  isToday: boolean;
  memberIds: string[]; // その日に予定がある家族（重複なし・members の並び順）
  hasEveryone: boolean; // 家族全員の予定がある
  count: number; // 予定の件数
  items: { title: string | null; memberIds: string[]; forEveryone: boolean }[]; // セルに出す短い予定名（最大2件、終日→時刻順）
  more: number; // items に入りきらなかった件数（「+2」）
}

/** 複数日にわたる終日予定を、週の行ごとに分割した線 */
export interface MonthSpanVM {
  key: string;
  week: number; // 行 0〜5
  fromCol: number; // 列 0〜6
  toCol: number; // 列 0〜6（含む）
  memberIds: string[];
  forEveryone: boolean;
  title: string | null;
}

export interface MonthVM {
  year: number;
  month: number; // 1〜12
  label: string; // '2026年10月'
  wafu: string; // 和風月名 '神無月'
  weekStart: 0 | 1; // 0=日曜始まり 1=月曜始まり
  weekdayLabels: string[]; // ['日','月','火','水','木','金','土']（weekStart に合わせた順）
  weeks: MonthCellVM[][]; // 5〜6行 × 7列
  spans: MonthSpanVM[];
}

/* ───────── 予定の詳細・入力 ───────── */

export interface EventDetailVM {
  occ: OccurrenceVM;
  dateLabel: string; // '10月3日 土曜日'（複数日は '10月10日(土) – 12日(月)'）
  timeLabel: string | null; // '07:00 — 15:00' / '07:30' / null（終日）
  createdByName: string;
  updatedLabel: string; // '更新 お母さん · 9/25 21:04'
  myReminders: number[]; // 自分への通知。開始基準の分（負=前）。終日は開始日0:00基準（-240=前日20:00）
  reminderOptions: number[]; // 選べる通知の候補
  canEdit: boolean; // 他の家族の非公開予定は false
}

export type RecurrenceVM =
  | { kind: 'none' }
  | { kind: 'daily'; interval: number }
  | { kind: 'weekly'; interval: number; weekdays: Weekday[] } // interval 2 = 隔週
  | { kind: 'monthlyByDate'; day: number } // day -1 = 月末
  | { kind: 'monthlyByWeekday'; nth: number[]; weekday: Weekday } // nth 1〜5, -1=最終（第2・第4水曜 → [2,4], 3）
  | { kind: 'yearly' }
  | { kind: 'custom'; label: string }; // UIでは編集不可、表示のみ

/** 繰り返しの終わり */
export type RecurrenceEndVM =
  | { kind: 'never' }
  | { kind: 'count'; count: number } // ◯回で終わる（1〜1000）
  | { kind: 'until'; date: DateISO }; // ◯月◯日まで（その日を含む）

export interface EventDraftVM {
  title: string;
  allDay: boolean;
  startDate: DateISO;
  endDate: DateISO;
  startTime: TimeHM | null;
  endTime: TimeHM | null;
  memberIds: string[];
  forEveryone: boolean;
  location: string;
  note: string;
  recurrence: RecurrenceVM;
  recurrenceEnd: RecurrenceEndVM; // recurrence が none のときは無視
  myReminders: number[];
  isPrivate: boolean;
  busy: boolean;
}

export interface AmbiguityVM {
  field: 'date' | 'time' | 'members' | 'title' | 'recurrence';
  question: string; // 例: '「来週の土曜」はどちら？'
  options: { label: string; patch: Partial<EventDraftVM> }[];
  chosen: number | null; // 選ばれた options の添字
}

export interface ComposerVM {
  mode: 'quick' | 'detail'; // quick=一言入力 / detail=詳しく入力
  editing: boolean; // 既存予定の編集なら true
  text: string;
  parse: 'idle' | 'parsing' | 'done' | 'failed';
  source: 'ai' | 'rules' | null; // ai=AIで解析 / rules=かんたん解析（オフライン等）
  draft: EventDraftVM | null;
  ambiguities: AmbiguityVM[];
  overlaps: string[]; // 例: '10/10(土) は「家族旅行（金沢）」と重なっています'
  examples: string[]; // 入力例
  quickDates: { label: string; date: DateISO }[]; // 日付の候補の札 '今日' '明日' '10/3(土)' '10/4(日)' '10/10(土)'（日付で書く。§16）
  quickTimes: TimeHM[]; // 開始時刻の候補の札 ['09:00','12:00','15:00','18:00','19:00']（「終日」「時刻を選ぶ」はUI側で固定）
  suggestions: { title: string; hint: string | null; patch: Partial<EventDraftVM> }[]; // 最近の予定から（例: 歯医者 · は · 19:30）
  saveLabel: string; // 保存ボタンの文言 '10/3(土) 10:00 に保存'
  saving: boolean;
  error: string | null;
}

/* ───────── 空き時間 ───────── */

export interface BusyBlockVM {
  memberId: string;
  startMin: number; // その日の0:00からの分
  endMin: number;
  label: string | null; // null = 非公開
}

export interface FreeDayVM {
  date: DateISO;
  weekday: Weekday;
  holiday: string | null;
  busy: BusyBlockVM[];
  commonFree: { startMin: number; endMin: number }[]; // 選択中の家族全員が空いている区間
}

/** 空き時間を探す時間帯。カレンダーにない仕事などは分からないため、夜・休日に絞れるようにする */
export type FreePreset = 'evenings' | 'holidays' | 'all'; // 夜(17-24時) / 休日(土日祝 8-24時) / 終日(6-24時)

/** 全員があいている候補（空き時間の画面で最初に見せる一覧） */
export interface FreeCandidateVM {
  date: DateISO;
  label: string; // '10/3(土) 16:00–24:00'
  startMin: number;
  endMin: number;
}

export interface FreeTimeVM {
  rangeLabel: string; // '9/27(日) – 10/3(土)'
  preset: FreePreset;
  dayStartMin: number; // 表示範囲の始まり（360 = 6:00）
  dayEndMin: number; // 表示範囲の終わり（1440 = 24:00）
  minDuration: 60 | 120 | 240;
  memberIds: string[]; // 対象の家族
  candidates: FreeCandidateVM[]; // 最大5件（日付順）
  days: FreeDayVM[]; // 「くわしく見る」で開く時間軸
}

/* ───────── 履歴・ゴミ箱・検索 ───────── */

export interface ActivityVM {
  id: string;
  actorId: string;
  action: 'create' | 'update' | 'delete' | 'restore';
  eventId: string;
  title: string;
  detail: string | null; // '開始 8:00 → 7:00'
  dayLabel: string; // グループ見出し '今日' '昨日' '9/25(金)'
  atLabel: string; // '3分前' '21:40'
  unread: boolean;
}

export interface TrashItemVM {
  eventId: string;
  title: string;
  whenLabel: string; // '9/25(金) 18:00'
  deletedByName: string;
  deletedLabel: string; // '9/26 に削除'
  daysLeft: number; // 完全に消えるまでの日数
}

export interface SearchGroupVM {
  dateLabel: string; // '10月3日(土)'
  items: OccurrenceVM[];
}

/* ───────── 設定 ───────── */

export type NotificationPermissionVM =
  | 'default'
  | 'granted'
  | 'denied'
  | 'unsupported'
  | 'needs-install';

export interface NotificationSettingsVM {
  permission: NotificationPermissionVM; // needs-install = iPhoneでホーム画面に未追加
  timedDefaults: number[]; // 時刻ありの予定の既定通知 例: [-30]
  allDayDefaults: number[]; // 終日の予定の既定通知 例: [-240]（前日20:00）
  morningDigest: { enabled: boolean; time: TimeHM }; // 朝のまとめ
  eveningPreview: { enabled: boolean; time: TimeHM }; // 前夜の予告
  familyChanges: 'mine' | 'all' | 'off'; // 家族の変更通知（自分に関係する予定のみ / すべて / オフ）
  quietHours: { enabled: boolean; from: TimeHM; to: TimeHM };
  showDetailsOnLockScreen: boolean; // ロック画面に予定名を出すか
}

export interface AdminMemberVM extends MemberVM {
  login: string; // Tailscaleのログイン（例: 'mama@example.com'）
  role: 'admin' | 'member';
  disabled: boolean;
  deviceCount: number; // 通知を受け取っている端末の数
}

/** 通知を受け取る自分の端末（Push購読）。紛失時にここから止める */
export interface DeviceVM {
  id: string;
  label: string; // 'iPhone' 'Android'
  lastUsedLabel: string; // '今日' '9/20'
  isThisDevice: boolean;
}

export interface SettingsVM {
  me: MemberVM;
  aliases: string[]; // 一言入力で自分を指す呼び名
  takenColors: { color: MemberColor; mark: string }[]; // 他の家族が使用中の色
  textSize: 'standard' | 'large'; // 文字の大きさ（大きめ = 全体を約1.15倍）
  theme: 'system' | 'light' | 'dark';
  weekStart: 0 | 1;
  notifications: NotificationSettingsVM;
  devices: DeviceVM[];
  isAdmin: boolean;
  members: AdminMemberVM[]; // 管理者のときだけ中身がある
  install: { platform: 'ios' | 'android' | 'other'; installed: boolean };
  appVersion: string;
}

export interface ToastVM {
  id: string;
  kind: 'info' | 'error' | 'undo';
  message: string; // '予定を削除しました'
  actionLabel: string | null; // '元に戻す'
}

/* ───────── 画面の props ───────── */

export type TabId = 'flow' | 'month' | 'free' | 'settings';

/** 全画面共通の枠。下部に「一言入力バー」と、アイコン＋文字のナビを持つ。未送信・オフラインは入力バーのすぐ上に1行 */
export interface AppShellProps {
  current: TabId;
  /** 画面ごとの CSS の修飾（'month-screen' など。§24 D29） */
  screen?: string;
  sync: SyncVM;
  toast: ToastVM | null;
  composerHint: string; // 入力バーの例文 '土曜10時 父 ゴルフ'
  onNavigate: (tab: TabId) => void;
  onOpenComposer: () => void;
  onRetrySync: () => void; // つながらないときの帯の「再試行」
  onToastAction: () => void;
  onToastDismiss: () => void;
  children: ReactNode;
  /** 画面の上に重ねるシート（S-04 詳細・S-05 書く画面）。開いているあいだ、下の画面と下の帯は操作できない（§24 D29） */
  overlay?: ReactNode;
}

/** ホームの上部に一度だけ出す控えめな案内（はじめての設定の続き。閉じられる） */
export type HomeNoticeVM = {
  kind: 'install' | 'notifications';
  message: string;
  actionLabel: string;
} | null;

/** S-01 これから */
export interface FlowScreenProps {
  items: FlowItem[];
  members: MemberVM[];
  anchorKey: string; // 初回表示で先頭に合わせる item の key（今日）
  headerDateLabel: string; // '2026年 9月27日 日曜日'（今日。年・日付・曜日を空白で区切る。§24 D32）
  summary: string[]; // 今日のまとめ（最大4つ）'今日 3件' '18:00 全員で夕食' '父は出張中（〜30日）'
  freshCount: number; // 家族が追加・変更した「新」の件数（0 なら出さない）
  week: MonthCellVM[]; // 上部に固定する週の帯（7日）
  selectedDate: DateISO; // 週の帯で強調する日（いま見ている日）
  sync: SyncVM; // 見出しの下に小さく表示する同期状態
  filterMemberIds: string[] | null; // null = 全員 / [自分のID] = 自分だけ / [誰かのID] = その人だけ
  unreadActivity: number;
  showBackToToday: boolean; // 今日から離れたら「今日に戻る」を出す
  notice: HomeNoticeVM;
  emptyExamples: string[]; // 予定ゼロのときに見せる入力例
  onPickExample: (text: string) => void; // 入力例をタップ → 一言入力へ
  onSetFilter: (memberIds: string[] | null) => void;
  onJumpToFresh: () => void; // 「新しい予定 2件」→ 最初の1件へ
  onJumpToDate: (date: DateISO) => void; // 週の帯・日付ジャンプから
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onOpenOccurrence: (key: string) => void;
  onComposeOnDate: (date: DateISO) => void;
  onReachStart: (byScroll?: boolean) => void; // 過去方向の追加読み込み（byScroll: 端までスクロールした。反対側の端を削ってよい。§24 D38）
  onReachEnd: (byScroll?: boolean) => void; // 未来方向の追加読み込み（同上）
  onJumpToday: () => void;
  onNoticeAction: () => void;
  onNoticeDismiss: () => void;
  onOpenActivity: () => void;
  onOpenSearch: () => void;
}

/** S-02 月（上半分）＋ S-03 選んだ日の予定（下半分） */
export interface MonthScreenProps {
  month: MonthVM;
  members: MemberVM[];
  selectedDate: DateISO;
  selectedDay: DayVM; // 下半分に出す、選んだ日の予定（「これから」と同じ行）
  onSelectDate: (date: DateISO) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onPickMonth: (year: number, month: number) => void; // 見出しの年月をタップして選ぶ
  onToday: () => void;
  onOpenOccurrence: (key: string) => void;
  onComposeOnDate: (date: DateISO) => void;
}

/** S-04 予定の詳細（下から出るシート） */
export interface EventDetailScreenProps {
  detail: EventDetailVM;
  members: MemberVM[];
  onClose: () => void;
  onEdit: () => void;
  onEditField: (field: 'title' | 'date' | 'time' | 'members' | 'location' | 'note') => void; // その項目だけ直す
  onDuplicate: () => void;
  onDelete: () => void; // 確認せずに削除し、アプリ側が「元に戻す」を出す（繰り返しは範囲を選ぶ）
  onChangeReminders: (offsets: number[]) => void;
  onOpenMap: (query: string) => void;
  onResolveConflict: () => void; // occ.sync === 'conflict' のとき
  /** 詳細の中に重ねる小さなシート（FieldEditSheet・C-04・C-05。§24 D29） */
  children?: ReactNode;
}

/** S-04 の「その項目だけ直す」小さなシート（詳細の中に重ねる。§6.2「詳細の時刻をタップ → 選ぶ → 保存」。§24 D29） */
export interface FieldEditSheetProps {
  open: boolean;
  field: 'date' | 'members'; // date = 日付と時刻
  draft: EventDraftVM;
  quickDates: { label: string; date: DateISO }[];
  quickTimes: TimeHM[];
  members: MemberVM[];
  saveLabel: string; // '10/3(土) 10:00 に変更'
  canSave: boolean;
  onChangeDraft: (patch: Partial<EventDraftVM>) => void;
  onSave: () => void;
  onClose: () => void;
}

/** 繰り返し予定の編集・削除範囲 */
export interface RecurrenceScopeDialogProps {
  open: boolean;
  action: 'edit' | 'delete';
  offline: boolean; // true なら「これ以降」「すべて」を無効にして理由を表示
  lost: { following: number; all: number }; // その範囲を選ぶと消える、個別の変更・取り消しの件数（§11。§24 D33）
  thisBlocked?: string | null; // 「この予定だけ」を選べない理由（公開・非公開・繰り返しの変更はシリーズ全体で。§24 D34）
  onChoose: (scope: 'this' | 'following' | 'all') => void;
  onCancel: () => void;
}

/** S-05 予定を書く（一言＋候補の札。「くわしく」で同じシート内に残りの項目） */
export interface ComposerSheetProps {
  open: boolean;
  vm: ComposerVM;
  members: MemberVM[];
  online: boolean;
  onClose: () => void;
  onTextChange: (text: string) => void;
  onSubmitText: () => void; // 一言をAIで解析して確認へ
  onChangeDraft: (patch: Partial<EventDraftVM>) => void; // 日付・時刻・人の札もこれで反映
  onPickSuggestion: (index: number) => void; // 「最近の予定」の候補
  onChooseAmbiguity: (ambiguityIndex: number, optionIndex: number) => void;
  onSetMode: (mode: 'quick' | 'detail') => void; // detail =「くわしく」を開いた状態
  onSave: () => void;
  /** 書く画面の中に重ねるダイアログ（繰り返しの範囲 C-04。§24 D33） */
  children?: ReactNode;
}

/** 競合の解決 */
export interface ConflictSheetProps {
  open: boolean;
  mine: OccurrenceVM;
  theirs: OccurrenceVM;
  theirsByName: string; // 'お母さん'
  deleted: 'mine' | 'theirs' | null; // どちらかが削除した競合（自分が削除した／家族が削除していた。§24 D32）
  members: MemberVM[];
  onKeepTheirs: () => void;
  onKeepMine: () => void;
  onKeepBoth: () => void;
  onClose: () => void;
}

/** S-06 空き時間 */
export interface FreeTimeScreenProps {
  vm: FreeTimeVM;
  members: MemberVM[];
  onToggleMember: (memberId: string) => void;
  onChangePreset: (preset: FreePreset) => void;
  onChangeMinDuration: (min: 60 | 120 | 240) => void;
  onPrevRange: () => void;
  onNextRange: () => void;
  onPickSlot: (date: DateISO, startMin: number, endMin: number) => void; // → 予定を書くを開く
}

/** S-07 設定 */
export interface SettingsScreenProps {
  vm: SettingsVM;
  onChangeProfile: (patch: {
    name?: string;
    mark?: string;
    color?: MemberColor;
    aliases?: string[];
  }) => void;
  onChangeNotifications: (patch: Partial<NotificationSettingsVM>) => void;
  onEnableNotifications: () => void;
  onTestNotification: () => void;
  onChangeTheme: (theme: SettingsVM['theme']) => void;
  onChangeTextSize: (size: SettingsVM['textSize']) => void;
  onChangeWeekStart: (weekStart: 0 | 1) => void;
  onOpenMembers: () => void; // 管理者のみ
  onOpenActivity: () => void;
  onOpenTrash: () => void;
  onExport: (format: 'json' | 'ics') => void;
  onOpenInstallGuide: () => void;
  onRemoveDevice: (deviceId: string) => void; // その端末への通知を止める
  onLogoutDevice: () => void; // この端末のデータを消す
}

/** S-07b 家族の管理（管理者） */
export interface MembersAdminScreenProps {
  members: AdminMemberVM[];
  onBack: () => void;
  onAdd: (input: {
    login: string;
    name: string;
    mark: string;
    color: MemberColor;
    role: 'admin' | 'member';
  }) => void;
  onUpdate: (
    memberId: string,
    patch: Partial<Pick<AdminMemberVM, 'name' | 'mark' | 'color' | 'role' | 'disabled'>>,
  ) => void;
  onRevokeDevices: (memberId: string) => void; // その人の全端末への通知を止める（端末紛失時）
}

/** S-08 履歴 */
export interface ActivityScreenProps {
  items: ActivityVM[];
  status: 'loading' | 'offline' | 'ready'; // オンラインで読む画面の状態（§24 D32）
  hasMore: boolean; // 「もっと見る」で続きを読めるか
  members: MemberVM[];
  onBack: () => void;
  onOpenEvent: (eventId: string) => void;
  onLoadMore: () => void;
}

/** S-09 ゴミ箱 */
export interface TrashScreenProps {
  items: TrashItemVM[];
  status: 'loading' | 'offline' | 'ready'; // オンラインで読む画面の状態（§24 D32）
  onBack: () => void;
  onRestore: (eventId: string) => void;
}

/** S-10 検索 */
export interface SearchScreenProps {
  query: string;
  groups: SearchGroupVM[];
  members: MemberVM[];
  filterMemberIds: string[] | null;
  recentQueries: string[]; // 最近の検索語
  onQueryChange: (query: string) => void;
  onSetFilter: (memberIds: string[] | null) => void;
  onBack: () => void;
  onOpenOccurrence: (key: string) => void;
}

/** S-11 はじめて（2画面だけ。ホーム画面への追加と通知は、あとで HomeNoticeVM で案内する） */
export type OnboardingStep = 'color' | 'howto';
export interface OnboardingScreenProps {
  step: OnboardingStep;
  me: MemberVM;
  takenColors: { color: MemberColor; mark: string }[]; // 他の家族が使用中の色
  onPickColor: (color: MemberColor) => void;
  onNext: () => void; // howto では「はじめる」
}

/** S-12 ホーム画面への追加ガイド */
export interface InstallGuideScreenProps {
  platform: 'ios' | 'android' | 'other';
  installed: boolean;
  canPrompt: boolean; // Android でインストールダイアログを出せる
  onPromptInstall: () => void;
  onBack: () => void;
}

/** 接続できないときの帯（AppShell 上部） */
export interface OfflineBannerProps {
  sync: SyncVM;
  onRetry: () => void;
}
