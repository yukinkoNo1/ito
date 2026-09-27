import { useRef } from "react"
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Settings,
  X,
} from "lucide-react"
import type { CalendarEvent, Member } from "../mock"
import { holidays } from "../mock"
import { Button, Input } from "../primitives/Controls"
import ScheduleEventRow from "../primitives/ScheduleEventRow"

type MonthScreenProps = {
  events: CalendarEvent[]
  members: Member[]
  month: string
  selectedDate: string
  weekStartsMonday: boolean
  monthPickerOpen: boolean
  composerOpen: boolean
  composerDraft: string
  onSelectDate: (date: string) => void
  onShiftMonth: (direction: -1 | 1) => void
  onGoToday: () => void
  onToggleWeekStart: () => void
  onToggleMonthPicker: () => void
  onSelectMonth: (month: string) => void
  onOpenComposer: () => void
  onComposerDraftChange: (value: string) => void
  onSaveComposer: () => void
  onEditEvent: (event: CalendarEvent) => void
  onNavigate: (view: "upcoming" | "month" | "availability" | "settings") => void
}

const toDateKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`

const getDateMeta = (date: string) => {
  const value = new Date(`${date}T12:00:00`)
  return {
    month: value.getMonth() + 1,
    day: value.getDate(),
    weekday: ["日", "月", "火", "水", "木", "金", "土"][value.getDay()],
    dayIndex: value.getDay(),
  }
}

const getMonthDates = (month: string, mondayStart: boolean) => {
  const [year, monthNumber] = month.split("-").map(Number)
  const first = new Date(year, monthNumber - 1, 1, 12)
  const offset = mondayStart ? (first.getDay() + 6) % 7 : first.getDay()
  const start = new Date(year, monthNumber - 1, 1 - offset, 12)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return toDateKey(date)
  })
}

const getEventsForDate = (events: CalendarEvent[], date: string) =>
  events.filter((event) =>
    event.allDay
      ? date >= event.startDate && date <= event.endDate
      : event.startDate === date,
  )

const getEventColor = (event: CalendarEvent, members: Member[]) => {
  if (event.forEveryone) return "everyone"
  return (
    members.find((member) => member.id === event.memberIds[0])?.color ??
    "everyone"
  )
}

function MonthGrid({
  events,
  members,
  month,
  selectedDate,
  weekStartsMonday,
  onSelectDate,
  onSwipe,
}: Pick<MonthScreenProps, "events" | "members" | "month" | "selectedDate" | "weekStartsMonday" | "onSelectDate"> & {
  onSwipe: (direction: -1 | 1) => void
}) {
  const touchStart = useRef<number>()
  const dates = getMonthDates(month, weekStartsMonday)
  const weekdays = weekStartsMonday
    ? ["月", "火", "水", "木", "金", "土", "日"]
    : ["日", "月", "火", "水", "木", "金", "土"]

  return (
    <div
      className="month-grid-wrap"
      onTouchEnd={(event) => {
        if (touchStart.current === undefined) return
        const distance = event.changedTouches[0].clientX - touchStart.current
        if (Math.abs(distance) > 48) onSwipe(distance < 0 ? 1 : -1)
        touchStart.current = undefined
      }}
      onTouchStart={(event) => {
        touchStart.current = event.touches[0].clientX
      }}
    >
      <div className="month-weekday-row">
        {weekdays.map((weekday) => (
          <span
            className={
              weekday === "日"
                ? "month-weekday--sun"
                : weekday === "土"
                  ? "month-weekday--sat"
                  : ""
            }
            key={weekday}
          >
            {weekday}
          </span>
        ))}
      </div>
      <div className="month-weeks">
        {Array.from({ length: 6 }, (_, weekIndex) => {
          const weekDates = dates.slice(weekIndex * 7, weekIndex * 7 + 7)
          const spanningEvents = events
            .filter(
              (event) =>
                event.allDay &&
                event.startDate !== event.endDate &&
                event.startDate <= weekDates[6] &&
                event.endDate >= weekDates[0],
            )
            .slice(0, 2)
          return (
            <div className="month-week-row" key={weekDates[0]}>
              {weekDates.map((date) => {
                const meta = getDateMeta(date)
                const dayEvents = getEventsForDate(events, date)
                const visibleEvents = dayEvents.slice(0, 2)
                const isOutside = !date.startsWith(month)
                const isToday = date === "2026-09-27"
                const isSelected = date === selectedDate
                return (
                  <Button
                    aria-label={`${meta.month}月${meta.day}日を選ぶ`}
                    className={`month-cell ${
                      isOutside ? "month-cell--outside" : ""
                    }`}
                    key={date}
                    onClick={() => onSelectDate(date)}
                  >
                    <span
                      className={`month-cell-number ${
                        meta.dayIndex === 0 || holidays[date]
                          ? "month-cell-number--sun"
                          : meta.dayIndex === 6
                            ? "month-cell-number--sat"
                            : ""
                      } ${isToday ? "month-cell-number--today" : ""} ${
                        isSelected ? "month-cell-number--selected" : ""
                      }`}
                    >
                      {meta.day}
                    </span>
                    <span className="month-cell-events">
                      {visibleEvents.map((event) => (
                        <span
                          className={`month-event month-event--${getEventColor(event, members)}`}
                          key={event.key}
                        >
                          {event.title ?? "予定あり"}
                        </span>
                      ))}
                      {dayEvents.length > 2 && (
                        <span className="month-more">
                          +{dayEvents.length - 2}
                        </span>
                      )}
                    </span>
                  </Button>
                )
              })}
              <div className="month-span-layer" aria-hidden="true">
                {spanningEvents.map((event, index) => {
                  const start = Math.max(0, weekDates.indexOf(event.startDate))
                  const endIndex = weekDates.indexOf(event.endDate)
                  const end = endIndex < 0 ? 6 : endIndex
                  return (
                    <i
                      className={`month-span month-span--${start}-${end} month-span--level-${index} month-span--${getEventColor(event, members)}`}
                      key={event.key}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthPicker({
  month,
  onClose,
  onSelectMonth,
}: {
  month: string
  onClose: () => void
  onSelectMonth: (month: string) => void
}) {
  return (
    <div className="sheet-backdrop">
      <section className="bottom-sheet month-picker" aria-label="年月を選ぶ">
        <div className="sheet-title">
          <strong>2026年</strong>
          <Button aria-label="閉じる" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="month-picker-grid">
          {Array.from({ length: 12 }, (_, index) => {
            const value = `2026-${String(index + 1).padStart(2, "0")}`
            return (
              <Button
                aria-pressed={month === value}
                key={value}
                onClick={() => onSelectMonth(value)}
              >
                {index + 1}月
              </Button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function MonthComposer({
  draft,
  selectedDate,
  onChange,
  onClose,
  onSave,
}: {
  draft: string
  selectedDate: string
  onChange: (value: string) => void
  onClose: () => void
  onSave: () => void
}) {
  const meta = getDateMeta(selectedDate)
  return (
    <div className="sheet-backdrop">
      <section className="bottom-sheet composer" aria-label="予定を書く">
        <div className="sheet-title">
          <div>
            <small>
              {meta.month}月{meta.day}日
            </small>
            <strong>予定を書く</strong>
          </div>
          <Button aria-label="閉じる" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <Input
          autoFocus
          onChange={(event) => onChange(event.target.value)}
          placeholder="例: 14時 さき 美容院"
          value={draft}
        />
        <div className="suggestion-list month-suggestions">
          {["終日 家族でお出かけ", "14時 は 歯医者", "19時 全員で夕食"].map(
            (item) => (
              <Button key={item} onClick={() => onChange(item)}>
                {item}
              </Button>
            ),
          )}
        </div>
        <Button disabled={!draft} onClick={onSave} variant="accent">
          保存
        </Button>
      </section>
    </div>
  )
}

export default function MonthScreen(props: MonthScreenProps) {
  const [year, monthNumber] = props.month.split("-").map(Number)
  const selectedMeta = getDateMeta(props.selectedDate)
  const selectedEvents = getEventsForDate(props.events, props.selectedDate)
  const holiday = holidays[props.selectedDate]

  return (
    <main className="app-shell month-screen">
      <header className="month-header">
        <Button aria-label="前の月" onClick={() => props.onShiftMonth(-1)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          aria-expanded={props.monthPickerOpen}
          className="month-title"
          onClick={props.onToggleMonthPicker}
        >
          <span>{year}年</span>
          <strong>{monthNumber}月</strong>
        </Button>
        <Button aria-label="次の月" onClick={() => props.onShiftMonth(1)}>
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button className="month-today-button" onClick={props.onGoToday}>
          今日
        </Button>
        <div className="week-start-toggle" aria-label="週の始まり">
          <Button
            aria-pressed={!props.weekStartsMonday}
            onClick={
              props.weekStartsMonday ? props.onToggleWeekStart : undefined
            }
          >
            日始まり
          </Button>
          <Button
            aria-pressed={props.weekStartsMonday}
            onClick={
              !props.weekStartsMonday ? props.onToggleWeekStart : undefined
            }
          >
            月始まり
          </Button>
        </div>
      </header>

      <MonthGrid
        events={props.events}
        members={props.members}
        month={props.month}
        onSelectDate={props.onSelectDate}
        onSwipe={props.onShiftMonth}
        selectedDate={props.selectedDate}
        weekStartsMonday={props.weekStartsMonday}
      />

      <section className="selected-day-panel" aria-label="選んだ日の予定">
        <header>
          <div>
            <strong>
              {selectedMeta.month}月{selectedMeta.day}日
            </strong>
            <span>{selectedMeta.weekday}曜日</span>
            {holiday && <em>{holiday}</em>}
          </div>
          <Button onClick={props.onOpenComposer}>＋ この日に書く</Button>
        </header>
        <div className="selected-day-events">
          {selectedEvents.length ? (
            selectedEvents.map((event) => (
              <ScheduleEventRow
                event={event}
                key={event.key}
                members={props.members}
                onEdit={() => props.onEditEvent(event)}
              />
            ))
          ) : (
            <div className="month-empty-day">
              <span>予定はありません</span>
              <Button onClick={props.onOpenComposer}>＋ 書く</Button>
            </div>
          )}
        </div>
      </section>

      <div className="bottom-area">
        <Button className="quick-add-trigger" onClick={props.onOpenComposer}>
          <b>＋</b>
          <span>予定を書く</span>
          <small>
            {selectedMeta.month}月{selectedMeta.day}日に追加
          </small>
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
                aria-current={index === 1 ? "page" : undefined}
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

      {props.monthPickerOpen && (
        <MonthPicker
          month={props.month}
          onClose={props.onToggleMonthPicker}
          onSelectMonth={props.onSelectMonth}
        />
      )}
      {props.composerOpen && (
        <MonthComposer
          draft={props.composerDraft}
          onChange={props.onComposerDraftChange}
          onClose={props.onOpenComposer}
          onSave={props.onSaveComposer}
          selectedDate={props.selectedDate}
        />
      )}
    </main>
  )
}
