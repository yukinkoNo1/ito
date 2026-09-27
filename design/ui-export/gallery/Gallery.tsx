import { useEffect, useState } from "react"
import { events, members, type CalendarEvent } from "../mock"
import { Button } from "../primitives/Controls"
import AvailabilityScreen, {
  type AvailabilityVariant,
} from "../screens/AvailabilityScreen"
import HistoryScreen from "../screens/HistoryScreen"
import InstallGuideScreen from "../screens/InstallGuideScreen"
import MonthScreen from "../screens/MonthScreen"
import OnboardingScreen from "../screens/OnboardingScreen"
import SearchScreen, { type SearchVariant } from "../screens/SearchScreen"
import SettingsScreen, { type SettingsVariant } from "../screens/SettingsScreen"
import TrashScreen from "../screens/TrashScreen"
import UpcomingScreen from "../screens/UpcomingScreen"
import EventComposerSheet, {
  type ComposerVariant,
} from "../sheets/EventComposerSheet"
import EventDetailSheet, {
  type DetailVariant,
} from "../sheets/EventDetailSheet"

type Scenario = "normal" | "self" | "empty" | "offline" | "large" | "first" | "month-oct3" | "month-oct10" | "month-monday" | "month-september" | "write-empty" | "write-chips" | "write-parsed" | "write-ambiguous" | "write-offline" | "write-error" | "detail-normal" | "detail-recurring" | "detail-multiday" | "detail-private" | "detail-conflict" | "availability-found" | "availability-empty" | "availability-details" | "settings-normal" | "settings-notifications-off" | "settings-large" | "history-normal" | "history-read" | "trash-normal" | "trash-empty" | "search-recent" | "search-results" | "search-empty" | "onboarding-color" | "onboarding-share" | "install-iphone" | "install-android"

const scenarioLabels: { key: Scenario label: string }[] = [
  { key: "normal", label: "通常" },
  { key: "self", label: "自分だけ" },
  { key: "empty", label: "予定ゼロ" },
  { key: "offline", label: "つながらない" },
  { key: "large", label: "文字大きめ" },
  { key: "first", label: "はじめての案内あり" },
  { key: "month-oct3", label: "10月・3日" },
  { key: "month-oct10", label: "10月・10日" },
  { key: "month-monday", label: "月曜始まり" },
  { key: "month-september", label: "9月" },
  { key: "write-empty", label: "書く・空" },
  { key: "write-chips", label: "書く・札" },
  { key: "write-parsed", label: "書く・解析" },
  { key: "write-ambiguous", label: "書く・あいまい" },
  { key: "write-offline", label: "書く・オフライン" },
  { key: "write-error", label: "書く・エラー" },
  { key: "detail-normal", label: "詳細・通常" },
  { key: "detail-recurring", label: "詳細・繰り返し" },
  { key: "detail-multiday", label: "詳細・複数日" },
  { key: "detail-private", label: "詳細・非公開" },
  { key: "detail-conflict", label: "詳細・ぶつかり" },
  { key: "availability-found", label: "空き・候補あり" },
  { key: "availability-empty", label: "空き・候補なし" },
  { key: "availability-details", label: "空き・くわしく" },
  { key: "settings-normal", label: "設定・通常" },
  { key: "settings-notifications-off", label: "設定・通知オフ" },
  { key: "settings-large", label: "設定・文字大きめ" },
  { key: "history-normal", label: "履歴・未読" },
  { key: "history-read", label: "履歴・既読" },
  { key: "trash-normal", label: "ゴミ箱" },
  { key: "trash-empty", label: "ゴミ箱・空" },
  { key: "search-recent", label: "検索・最近" },
  { key: "search-results", label: "検索・結果" },
  { key: "search-empty", label: "検索・結果なし" },
  { key: "onboarding-color", label: "はじめて・色" },
  { key: "onboarding-share", label: "はじめて・共有" },
  { key: "install-iphone", label: "追加ガイド・iPhone" },
  { key: "install-android", label: "追加ガイド・Android" },
]

export default function Gallery() {
  const [scenario, setScenario] = useState<Scenario>("normal")
  const [theme, setTheme] = useState<"light" | "dark">("light")
  const [selectedFilter, setSelectedFilter] = useState("all")
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerDraft, setComposerDraft] = useState("")
  const [editingEvent, setEditingEvent] = useState<CalendarEvent>()
  const [showUndo, setShowUndo] = useState(false)
  const [undoMessage, setUndoMessage] = useState("保存しました")
  const [firstVisitDismissed, setFirstVisitDismissed] = useState(false)
  const [awayFromToday, setAwayFromToday] = useState(false)
  const [month, setMonth] = useState("2026-10")
  const [selectedMonthDate, setSelectedMonthDate] = useState("2026-10-03")
  const [weekStartsMonday, setWeekStartsMonday] = useState(false)
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const [composerDate, setComposerDate] = useState<string>()

  useEffect(() => {
    if (!showUndo) return
    const timeout = window.setTimeout(() => setShowUndo(false), 5000)
    return () => window.clearTimeout(timeout)
  }, [showUndo])

  const showSaved = (message = "保存しました") => {
    setComposerOpen(false)
    setEditingEvent(undefined)
    setComposerDraft("")
    if (isWriteScenario || isDetailScenario) setScenario("normal")
    setUndoMessage(message)
    setShowUndo(true)
  }

  const filter = scenario === "self" ? "self" : selectedFilter
  const isMonthScenario = scenario.startsWith("month-")
  const isWriteScenario = scenario.startsWith("write-")
  const isDetailScenario = scenario.startsWith("detail-")
  const isAvailabilityScenario = scenario.startsWith("availability-")
  const isSettingsScenario = scenario.startsWith("settings-")
  const isHistoryScenario = scenario.startsWith("history-")
  const isTrashScenario = scenario.startsWith("trash-")
  const isSearchScenario = scenario.startsWith("search-")
  const isOnboardingScenario = scenario.startsWith("onboarding-")
  const isInstallScenario = scenario.startsWith("install-")
  const availabilityVariant = (
    isAvailabilityScenario ? scenario.replace("availability-", "") : "found"
  ) as AvailabilityVariant
  const settingsVariant = (
    isSettingsScenario ? scenario.replace("settings-", "") : "normal"
  ) as SettingsVariant
  const searchVariant = (
    isSearchScenario ? scenario.replace("search-", "") : "recent"
  ) as SearchVariant
  const composerVariant = (
    isWriteScenario ? scenario.replace("write-", "") : "empty"
  ) as ComposerVariant
  const detailVariant = (
    isDetailScenario ? scenario.replace("detail-", "") : "normal"
  ) as DetailVariant
  const detailEvent =
    editingEvent ??
    (detailVariant === "recurring"
      ? events.find((event) => event.key === "yoga")
      : detailVariant === "multiday"
        ? events.find((event) => event.key === "kanazawa")
        : detailVariant === "private"
          ? events.find((event) => event.key === "saki-private")
          : detailVariant === "conflict"
            ? events.find((event) => event.key === "moving")
            : events.find((event) => event.key === "dentist"))

  const selectScenario = (nextScenario: Scenario) => {
    setScenario(nextScenario)
    setSelectedFilter("all")
    setFirstVisitDismissed(false)
    setComposerOpen(false)
    setEditingEvent(undefined)
    setComposerDraft("")
    setComposerDate(undefined)
    setMonthPickerOpen(false)
    if (nextScenario === "month-oct3") {
      setMonth("2026-10")
      setSelectedMonthDate("2026-10-03")
      setWeekStartsMonday(false)
    } else if (nextScenario === "month-oct10") {
      setMonth("2026-10")
      setSelectedMonthDate("2026-10-10")
      setWeekStartsMonday(false)
    } else if (nextScenario === "month-monday") {
      setMonth("2026-10")
      setSelectedMonthDate("2026-10-03")
      setWeekStartsMonday(true)
    } else if (nextScenario === "month-september") {
      setMonth("2026-09")
      setSelectedMonthDate("2026-09-27")
      setWeekStartsMonday(false)
    }
  }

  const shiftMonth = (direction: -1 | 1) => {
    const [year, monthNumber] = month.split("-").map(Number)
    const next = new Date(year, monthNumber - 1 + direction, 1)
    const nextMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`
    setMonth(nextMonth)
    setSelectedMonthDate(`${nextMonth}-01`)
  }

  const navigate = (
    view: "upcoming" | "month" | "availability" | "settings",
  ) => {
    if (view === "upcoming") selectScenario("normal")
    if (view === "month") selectScenario("month-oct3")
    if (view === "availability") selectScenario("availability-found")
    if (view === "settings") selectScenario("settings-normal")
  }

  return (
    <div className="gallery">
      <div className="gallery-toolbar">
        <div className="gallery-group" aria-label="表示する状態">
          {scenarioLabels.map((item) => (
            <Button
              aria-pressed={scenario === item.key}
              key={item.key}
              onClick={() => selectScenario(item.key)}
              variant="gallery"
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="gallery-group" aria-label="配色">
          {(["light", "dark"] as const).map((item) => (
            <Button
              aria-pressed={theme === item}
              key={item}
              onClick={() => setTheme(item)}
              variant="gallery"
            >
              {item === "light" ? "ライト" : "ダーク"}
            </Button>
          ))}
        </div>
      </div>
      <div
        className="device"
        data-large-text={
          scenario === "large" || scenario === "settings-large" || undefined
        }
        data-theme={theme}
      >
        {isOnboardingScenario ? (
          <OnboardingScreen
            onNext={() => setScenario("onboarding-share")}
            onStart={() => setScenario("normal")}
            step={scenario === "onboarding-color" ? 1 : 2}
          />
        ) : isInstallScenario ? (
          <InstallGuideScreen
            initialPlatform={
              scenario === "install-android" ? "android" : "iphone"
            }
            onClose={() => setScenario("settings-normal")}
          />
        ) : isHistoryScenario ? (
          <HistoryScreen
            allRead={scenario === "history-read"}
            events={events}
            members={members}
            onClose={() => setScenario("normal")}
            onNavigate={navigate}
            onOpenComposer={() => setComposerOpen(true)}
            onOpenEvent={setEditingEvent}
          />
        ) : isTrashScenario ? (
          <TrashScreen
            events={events}
            key={scenario}
            onClose={() => setScenario("settings-normal")}
            onNavigate={navigate}
            onOpenComposer={() => setComposerOpen(true)}
            onRestore={() => showSaved("予定を元に戻しました")}
            startsEmpty={scenario === "trash-empty"}
          />
        ) : isSearchScenario ? (
          <SearchScreen
            events={events}
            key={scenario}
            members={members}
            onClose={() => setScenario("normal")}
            onNavigate={navigate}
            onOpenComposer={() => setComposerOpen(true)}
            onOpenEvent={setEditingEvent}
            variant={searchVariant}
          />
        ) : isMonthScenario ? (
          <MonthScreen
            composerDraft={composerDraft}
            composerOpen={false}
            events={events}
            members={members}
            month={month}
            monthPickerOpen={monthPickerOpen}
            onComposerDraftChange={setComposerDraft}
            onEditEvent={(event) => {
              setEditingEvent(event)
            }}
            onGoToday={() => {
              setMonth("2026-09")
              setSelectedMonthDate("2026-09-27")
            }}
            onNavigate={navigate}
            onOpenComposer={() => setComposerOpen((open) => !open)}
            onSaveComposer={showSaved}
            onSelectDate={setSelectedMonthDate}
            onSelectMonth={(nextMonth) => {
              setMonth(nextMonth)
              setSelectedMonthDate(`${nextMonth}-01`)
              setMonthPickerOpen(false)
            }}
            onShiftMonth={shiftMonth}
            onToggleMonthPicker={() => setMonthPickerOpen((open) => !open)}
            onToggleWeekStart={() => setWeekStartsMonday((monday) => !monday)}
            selectedDate={selectedMonthDate}
            weekStartsMonday={weekStartsMonday}
          />
        ) : isAvailabilityScenario ? (
          <AvailabilityScreen
            key={scenario}
            members={members}
            onNavigate={navigate}
            onOpenComposer={(value) => {
              setComposerDraft(value ?? "")
              setComposerOpen(true)
            }}
            variant={availabilityVariant}
          />
        ) : isSettingsScenario ? (
          <SettingsScreen
            key={scenario}
            onNavigate={navigate}
            onOpenInstallGuide={() => setScenario("install-iphone")}
            onOpenComposer={() => {
              setComposerDraft("")
              setComposerOpen(true)
            }}
            onOpenTrash={() => setScenario("trash-normal")}
            onTextSizeChange={(value) =>
              setScenario(
                value === "大きめ" ? "settings-large" : "settings-normal",
              )
            }
            onThemeChange={(value) => {
              if (value === "ライト") setTheme("light")
              if (value === "ダーク") setTheme("dark")
            }}
            variant={settingsVariant}
          />
        ) : (
          <UpcomingScreen
            awayFromToday={awayFromToday}
            composerDraft={composerDraft}
            composerOpen={false}
            datePickerOpen={datePickerOpen}
            disconnected={
              scenario === "offline" || scenario === "write-offline"
            }
            editingEvent={undefined}
            empty={scenario === "empty"}
            events={events}
            firstVisit={scenario === "first" && !firstVisitDismissed}
            members={members}
            onComposerDraftChange={setComposerDraft}
            onDeleteEvent={() => showSaved("予定を削除しました")}
            onDismissFirstVisit={() => setFirstVisitDismissed(true)}
            onEditEvent={setEditingEvent}
            onOpenHistory={() => setScenario("history-normal")}
            onOpenInstallGuide={() => setScenario("install-iphone")}
            onOpenComposer={(date) => {
              if (!date && composerOpen) {
                setComposerOpen(false)
                return
              }
              setComposerDate(date)
              setComposerOpen(true)
            }}
            onSaveComposer={showSaved}
            onSaveEvent={showSaved}
            onSearch={() => setScenario("search-recent")}
            onSelectDate={(date) => {
              setDatePickerOpen(false)
              setAwayFromToday(date !== "2026-09-27")
              window.setTimeout(
                () =>
                  document
                    .getElementById(`date-${date}`)
                    ?.scrollIntoView({ behavior: "smooth" }),
                0,
              )
            }}
            onSelectFilter={(nextFilter) => {
              if (scenario === "self") setScenario("normal")
              setSelectedFilter(nextFilter)
            }}
            onReturnToday={() => {
              setAwayFromToday(false)
              document
                .getElementById("date-2026-09-27")
                ?.scrollIntoView({ behavior: "smooth" })
            }}
            onShiftWeek={() => setAwayFromToday(true)}
            onNavigate={navigate}
            onToggleDatePicker={() => setDatePickerOpen((open) => !open)}
            onUndo={() => setShowUndo(false)}
            selectedFilter={filter}
            showUndo={showUndo}
            undoMessage={undoMessage}
          />
        )}
        {(composerOpen || isWriteScenario) && (
          <EventComposerSheet
            initialDate={
              composerDate ?? (isMonthScenario ? selectedMonthDate : undefined)
            }
            initialValue={composerDraft || undefined}
            key={`${scenario}-${composerDate ?? ""}-${composerDraft}`}
            onClose={() => {
              setComposerOpen(false)
              setComposerDraft("")
              if (isWriteScenario) setScenario("normal")
            }}
            onSave={() => showSaved("保存しました")}
            variant={
              isWriteScenario
                ? composerVariant
                : composerDraft
                  ? "parsed"
                  : "empty"
            }
          />
        )}
        {(editingEvent || isDetailScenario) && detailEvent && (
          <EventDetailSheet
            event={detailEvent}
            key={`${scenario}-${detailEvent.key}`}
            members={members}
            onClose={() => {
              setEditingEvent(undefined)
              if (isDetailScenario) setScenario("normal")
            }}
            onDelete={() => showSaved("予定を削除しました")}
            onDuplicate={() => {
              setEditingEvent(undefined)
              if (isDetailScenario) setScenario("normal")
              setComposerDraft(detailEvent.title ?? "")
              setComposerDate(detailEvent.startDate)
              setComposerOpen(true)
            }}
            onEdit={() => {
              setEditingEvent(undefined)
              if (isDetailScenario) setScenario("normal")
              setComposerDraft(detailEvent.title ?? "")
              setComposerDate(detailEvent.startDate)
              setComposerOpen(true)
            }}
            variant={isDetailScenario ? detailVariant : "normal"}
          />
        )}
        {showUndo &&
          (isMonthScenario ||
            isAvailabilityScenario ||
            isSettingsScenario ||
            isHistoryScenario ||
            isTrashScenario ||
            isSearchScenario) && (
            <div className="gallery-undo-toast" role="status">
              <span>{undoMessage}</span>
              <Button onClick={() => setShowUndo(false)}>元に戻す</Button>
            </div>
          )}
      </div>
    </div>
  )
}
