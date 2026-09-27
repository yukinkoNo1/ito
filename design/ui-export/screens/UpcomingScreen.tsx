import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Search,
  Settings,
  Undo2,
  X,
} from "lucide-react"
import type { CalendarEvent, Member } from "../mock"
import { holidays } from "../mock"
import { Button, Input } from "../primitives/Controls"
import ScheduleEventRow from "../primitives/ScheduleEventRow"
import ThreadRail from "../primitives/ThreadRail"

type FilterId = "all" | "self" | string

type UpcomingScreenProps = {
  events: CalendarEvent[]
  members: Member[]
  selectedFilter: FilterId
  disconnected?: boolean
  empty?: boolean
  firstVisit?: boolean
  datePickerOpen?: boolean
  composerOpen?: boolean
  composerDraft?: string
  editingEvent?: CalendarEvent
  showUndo?: boolean
  undoMessage?: string
  awayFromToday?: boolean
  onSelectFilter: (filter: FilterId) => void
  onSelectDate: (date: string) => void
  onToggleDatePicker: () => void
  onShiftWeek: (direction: -1 | 1) => void
  onOpenComposer: (date?: string) => void
  onComposerDraftChange: (value: string) => void
  onSaveComposer: () => void
  onEditEvent: (event?: CalendarEvent) => void
  onDeleteEvent: (event: CalendarEvent) => void
  onSaveEvent: (event: CalendarEvent) => void
  onDismissFirstVisit: () => void
  onUndo: () => void
  onReturnToday: () => void
  onSearch: () => void
  onOpenHistory: () => void
  onOpenInstallGuide: () => void
  onNavigate: (view: "upcoming" | "month" | "availability" | "settings") => void
}

const WEEK_DATES = [
  "2026-09-27",
  "2026-09-28",
  "2026-09-29",
  "2026-09-30",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
]

const dateMeta = (date: string) => {
  const value = new Date(`${date}T12:00:00`)
  return {
    month: value.getMonth() + 1,
    day: value.getDate(),
    weekday: ["日", "月", "火", "水", "木", "金", "土"][value.getDay()],
    weekend: value.getDay() === 0 ? "sun" : value.getDay() === 6 ? "sat" : "",
  }
}

function DayHeader({
  date,
  members,
  continuingId,
  onAdd,
}: {
  date: string
  members: Member[]
  continuingId?: string
  onAdd: () => void
}) {
  const meta = dateMeta(date)
  const isToday = date === "2026-09-27"
  return (
    <div
      className={`timeline-row day-header ${
        isToday ? "day-header--today" : ""
      }`}
    >
      <ThreadRail continuingId={continuingId} members={members} />
      <div className="day-heading">
        <span className={`day-number day-number--${meta.weekend}`}>
          {meta.day}
        </span>
        <span className="weekday">{meta.weekday}曜日</span>
        {holidays[date] && <span className="holiday">{holidays[date]}</span>}
        {isToday && <span className="today-label">今日</span>}
        <Button
          aria-label={`${meta.month}月${meta.day}日に予定を書く`}
          onClick={onAdd}
        >
          ＋
        </Button>
      </div>
    </div>
  )
}

function WeekStrip({
  events,
  members,
  datePickerOpen,
  onSelectDate,
  onShiftWeek,
  onToggleDatePicker,
}: Pick<UpcomingScreenProps, "events" | "members" | "datePickerOpen" | "onSelectDate" | "onShiftWeek" | "onToggleDatePicker">) {
  return (
    <section className="week-panel" aria-label="週を選ぶ">
      <div className="week-tools">
        <Button aria-label="前の週" onClick={() => onShiftWeek(-1)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span>9月27日 — 10月3日</span>
        <Button aria-label="次の週" onClick={() => onShiftWeek(1)}>
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button aria-expanded={datePickerOpen} onClick={onToggleDatePicker}>
          <CalendarDays aria-hidden="true" />
          日付
        </Button>
      </div>
      <div className="week-days">
        {WEEK_DATES.map((date) => {
          const meta = dateMeta(date)
          const memberIds = [
            ...new Set(
              events
                .filter((event) => event.startDate === date)
                .flatMap((event) => event.memberIds),
            ),
          ]
          return (
            <Button
              aria-label={`${meta.month}月${meta.day}日 ${meta.weekday}曜日へ移動`}
              className={date === "2026-09-27" ? "week-day--today" : ""}
              key={date}
              onClick={() => onSelectDate(date)}
            >
              <small>{meta.weekday}</small>
              <strong>{meta.day}</strong>
              <span className="week-dots" aria-hidden="true">
                {members.map((member) =>
                  memberIds.includes(member.id) ? (
                    <i className={`dot--${member.color}`} key={member.id} />
                  ) : null,
                )}
              </span>
            </Button>
          )
        })}
      </div>
    </section>
  )
}

function DatePicker({
  onClose,
  onSelectDate,
}: {
  onClose: () => void
  onSelectDate: (date: string) => void
}) {
  return (
    <div className="sheet-backdrop">
      <section className="bottom-sheet date-picker" aria-label="日付を選択">
        <div className="sheet-title">
          <strong>2026年9月</strong>
          <Button aria-label="閉じる" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="month-weekdays">
          {["日", "月", "火", "水", "木", "金", "土"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="month-grid">
          {[
            null,
            null,
            ...Array.from({ length: 30 }, (_, index) => index + 1),
          ].map((day, index) =>
            day === null ? (
              <span key={`empty-${index}`} />
            ) : (
              <Button
                className={day === 27 ? "month-day--today" : ""}
                key={day}
                onClick={() =>
                  onSelectDate(`2026-09-${String(day).padStart(2, "0")}`)
                }
              >
                {day}
              </Button>
            ),
          )}
        </div>
      </section>
    </div>
  )
}

function Composer({
  draft,
  onChange,
  onClose,
  onSave,
}: {
  draft: string
  onChange: (value: string) => void
  onClose: () => void
  onSave: () => void
}) {
  return (
    <div className="sheet-backdrop">
      <section className="bottom-sheet composer" aria-label="予定を書く">
        <div className="sheet-title">
          <strong>予定を書く</strong>
          <Button aria-label="閉じる" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <Input
          autoFocus
          onChange={(event) => onChange(event.target.value)}
          placeholder="例: 土曜10時 父 ゴルフ"
          value={draft}
        />
        <p>候補</p>
        <div className="suggestion-list">
          {[
            "土曜10時 父 ゴルフ",
            "明日18時 全員で夕食",
            "毎週日曜 母 ヨガ",
          ].map((item) => (
            <Button key={item} onClick={() => onChange(item)}>
              {item}
            </Button>
          ))}
        </div>
        <Button disabled={!draft} onClick={onSave} variant="accent">
          保存
        </Button>
      </section>
    </div>
  )
}

function EventEditor({
  event,
  onClose,
  onDelete,
  onSave,
}: {
  event: CalendarEvent
  onClose: () => void
  onDelete: () => void
  onSave: () => void
}) {
  return (
    <div className="sheet-backdrop">
      <section className="bottom-sheet event-editor" aria-label="予定を編集">
        <div className="sheet-title">
          <div>
            <small>予定を編集</small>
            <strong>{event.title ?? "予定あり"}</strong>
          </div>
          <Button aria-label="閉じる" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="editor-fields">
          <span>
            日付{" "}
            <b>
              {dateMeta(event.startDate).month}月{dateMeta(event.startDate).day}
              日
            </b>
          </span>
          <span>
            時刻{" "}
            <b>
              {event.allDay
                ? "終日"
                : `${event.startTime} — ${event.endTime ?? ""}`}
            </b>
          </span>
        </div>
        {event.recurrenceLabel && (
          <div className="recurrence-scope">
            <p>変更する範囲</p>
            <Button>この予定だけ</Button>
            <Button>これ以降の予定</Button>
          </div>
        )}
        <div className="editor-actions">
          <Button onClick={onDelete}>削除</Button>
          <Button onClick={onSave} variant="accent">
            保存
          </Button>
        </div>
      </section>
    </div>
  )
}

export default function UpcomingScreen(props: UpcomingScreenProps) {
  const {
    events,
    members,
    selectedFilter,
    disconnected,
    empty,
    firstVisit,
    datePickerOpen,
    composerOpen,
    composerDraft = "",
    editingEvent,
    showUndo,
    undoMessage = "保存しました",
    awayFromToday,
  } = props
  const selfId = members.find((member) => member.isSelf)?.id
  const selectedId = selectedFilter === "self" ? selfId : selectedFilter
  const visibleEvents =
    selectedFilter === "all"
      ? events
      : events.filter((event) => event.memberIds.includes(String(selectedId)))
  const dates = [
    ...new Set([
      ...WEEK_DATES,
      ...visibleEvents
        .filter((event) => event.startDate >= "2026-09-27")
        .map((event) => event.startDate),
    ]),
  ].sort()
  const filters = [
    { id: "all", label: "全員" },
    { id: "self", label: "自分" },
    ...members.map((member) => ({ id: member.id, label: member.shortName })),
  ]

  return (
    <main className="app-shell">
      {firstVisit && (
        <div className="install-prompt">
          <span>ホーム画面に追加すると通知を使えます</span>
          <Button onClick={props.onOpenInstallGuide}>追加する</Button>
          <Button aria-label="案内を閉じる" onClick={props.onDismissFirstVisit}>
            <X aria-hidden="true" />
          </Button>
        </div>
      )}
      <header className="topbar">
        <div>
          <p className="eyebrow">2026年</p>
          <p className="current-date">
            9月27日 <span>日曜日</span>
          </p>
        </div>
        <div className="topbar-actions">
          <Button onClick={props.onOpenHistory}>
            履歴 <b>2</b>
          </Button>
          <Button onClick={props.onSearch}>
            <Search aria-hidden="true" />
            検索
          </Button>
        </div>
      </header>

      <div className="today-summary">
        <span>今日 3件 · 18:00 全員で夕食 · 父は出張中（〜30日）</span>
        <Button
          onClick={() =>
            document
              .getElementById("new-movie")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          新しい予定 2件
        </Button>
      </div>

      <WeekStrip
        datePickerOpen={datePickerOpen}
        events={events}
        members={members}
        onSelectDate={props.onSelectDate}
        onShiftWeek={props.onShiftWeek}
        onToggleDatePicker={props.onToggleDatePicker}
      />

      <div className="member-filters" aria-label="表示する人">
        {filters.map((filter) => (
          <Button
            aria-pressed={selectedFilter === filter.id}
            key={filter.id}
            onClick={() => props.onSelectFilter(filter.id)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      <section className="schedule" aria-label="これからの予定">
        {empty ? (
          <div className="empty-state">
            <p className="empty-kicker">これから</p>
            <p className="empty-title">
              まだ予定は
              <br />
              ありません
            </p>
            <p className="empty-help">
              下の「予定を書く」から、話すように入力できます。
            </p>
            <div className="empty-examples">
              <span>明日18時 みんなで夕食</span>
              <span>土曜10時 父 ゴルフ</span>
              <span>毎週日曜 母 ヨガ</span>
            </div>
          </div>
        ) : (
          dates.map((date) => {
            const continuingId =
              date >= "2026-09-28" && date <= "2026-09-30"
                ? "father"
                : undefined
            return (
              <div className="date-section" id={`date-${date}`} key={date}>
                <DayHeader
                  continuingId={continuingId}
                  date={date}
                  members={members}
                  onAdd={() => props.onOpenComposer(date)}
                />
                {visibleEvents
                  .filter((event) => event.startDate === date)
                  .sort(
                    (a, b) =>
                      Number(b.allDay) - Number(a.allDay) ||
                      (a.startTime ?? "").localeCompare(b.startTime ?? ""),
                  )
                  .map((event) => (
                    <ScheduleEventRow
                      continuingId={continuingId}
                      event={event}
                      key={event.key}
                      members={members}
                      onEdit={() => props.onEditEvent(event)}
                    />
                  ))}
                {!visibleEvents.some((event) => event.startDate === date) && (
                  <div className="timeline-row no-events-row">
                    <ThreadRail continuingId={continuingId} members={members} />
                    <span>
                      {continuingId ? "父　出張中（〜30日）" : "予定なし"}
                    </span>
                  </div>
                )}
              </div>
            )
          })
        )}
      </section>

      <div className="bottom-area">
        {showUndo && (
          <div className="undo-bar" role="status">
            <span>{undoMessage}</span>
            <Button onClick={props.onUndo}>
              <Undo2 aria-hidden="true" />
              元に戻す
            </Button>
          </div>
        )}
        {(disconnected || events.some((event) => event.sync === "pending")) && (
          <div className="connection-state">
            {disconnected
              ? "オフライン · 最終同期 14:02 · 未送信 2件"
              : "未送信 1件 · 接続時に送信します"}
          </div>
        )}
        {awayFromToday && (
          <Button className="return-today" onClick={props.onReturnToday}>
            今日に戻る
          </Button>
        )}
        <Button
          className="quick-add-trigger"
          onClick={() => props.onOpenComposer()}
        >
          <b>＋</b>
          <span>予定を書く</span>
          <small>例: 土曜10時 父 ゴルフ</small>
        </Button>
        <nav className="bottom-nav" aria-label="メイン">
          {[
            { label: "これから", icon: Clock3, view: "upcoming" as const },
            { label: "月", icon: CalendarDays, view: "month" as const },
            {
              label: "空き",
              icon: CalendarRange,
              view: "availability" as const,
            },
            { label: "設定", icon: Settings, view: "settings" as const },
          ].map((item, index) => {
            const Icon = item.icon
            return (
              <Button
                aria-current={index === 0 ? "page" : undefined}
                key={item.label}
                onClick={() => props.onNavigate(item.view)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Button>
            )
          })}
        </nav>
      </div>

      {datePickerOpen && (
        <DatePicker
          onClose={props.onToggleDatePicker}
          onSelectDate={props.onSelectDate}
        />
      )}
      {composerOpen && (
        <Composer
          draft={composerDraft}
          onChange={props.onComposerDraftChange}
          onClose={() => props.onOpenComposer()}
          onSave={props.onSaveComposer}
        />
      )}
      {editingEvent && (
        <EventEditor
          event={editingEvent}
          onClose={() => props.onEditEvent()}
          onDelete={() => props.onDeleteEvent(editingEvent)}
          onSave={() => props.onSaveEvent(editingEvent)}
        />
      )}
    </main>
  )
}
