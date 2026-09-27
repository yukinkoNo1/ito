import { useRef, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button, Input, Textarea } from "../primitives/Controls"

export type ComposerVariant = "empty" | "chips" | "parsed" | "ambiguous" | "offline" | "error"

type EventComposerSheetProps = {
  variant?: ComposerVariant
  initialDate?: string
  initialValue?: string
  onClose: () => void
  onSave: () => void
}

const DATE_OPTIONS = [
  { value: "2026-09-27", label: "今日" },
  { value: "2026-09-28", label: "明日" },
  { value: "2026-10-03", label: "10/3(土)" },
  { value: "2026-10-04", label: "10/4(日)" },
  { value: "2026-10-10", label: "10/10(土)" },
]

const TIME_OPTIONS = ["終日", "9:00", "12:00", "15:00", "18:00", "19:00"]
const PEOPLE_OPTIONS = ["自分", "全員", "父", "母", "は", "さ"]

const getInitialValue = (variant: ComposerVariant, initialValue?: string) => {
  if (initialValue) return initialValue
  if (variant === "chips") return "ゴルフ"
  if (variant === "parsed" || variant === "offline")
    return "10/3 10時 父 ゴルフ"
  if (variant === "ambiguous") return "来週の土曜 ゴルフ"
  if (variant === "error") return "いつもの時間に集まる"
  return ""
}

const getDateLabel = (date?: string) =>
  DATE_OPTIONS.find((option) => option.value === date)?.label ??
  (date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8))}` : "")

export default function EventComposerSheet({
  variant = "empty",
  initialDate,
  initialValue,
  onClose,
  onSave,
}: EventComposerSheetProps) {
  const startingValue = getInitialValue(variant, initialValue)
  const [draft, setDraft] = useState(startingValue)
  const [selectedDate, setSelectedDate] = useState<string | undefined>(() => {
    if (variant === "error" || variant === "ambiguous") return undefined
    if (initialDate) return initialDate
    if (startingValue.includes("10/10")) return "2026-10-10"
    if (startingValue.includes("10/4")) return "2026-10-04"
    if (startingValue.includes("10/3")) return "2026-10-03"
    if (startingValue.includes("明日")) return "2026-09-28"
    if (startingValue.includes("今日")) return "2026-09-27"
    if (["chips", "parsed", "offline"].includes(variant)) return "2026-10-03"
    return undefined
  })
  const [selectedTime, setSelectedTime] = useState<string | undefined>(() => {
    const match = startingValue.match(/(\d{1,2})(?::|時)(\d{2})?/)
    if (match) return `${match[1].padStart(2, "0")}:${match[2] ?? "00"}`
    return ["chips", "parsed", "offline"].includes(variant)
      ? "10:00"
      : undefined
  })
  const [endOffset, setEndOffset] = useState("+1時間")
  const [people, setPeople] = useState<string[]>(() => {
    const parsed = PEOPLE_OPTIONS.filter(
      (person) => person !== "自分" && startingValue.includes(person),
    )
    if (parsed.length) return parsed
    return ["chips", "parsed", "offline"].includes(variant) ? ["父"] : []
  })
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [recurrence, setRecurrence] = useState("なし")
  const [recurrenceEnd, setRecurrenceEnd] = useState("なし")
  const [notification, setNotification] = useState("10分前")
  const [isPrivate, setIsPrivate] = useState(false)
  const [includeInFreeTime, setIncludeInFreeTime] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [parseError, setParseError] = useState(variant === "error")
  const [ambiguityResolved, setAmbiguityResolved] = useState(false)
  const [picker, setPicker] = useState<"date" | "time">()
  const dragStart = useRef<number>()

  const applyDraft = (value: string) => {
    setDraft(value)
    setConfirmed(false)
    if (value.includes("今日")) {
      setSelectedDate("2026-09-27")
      setParseError(false)
    } else if (value.includes("明日")) {
      setSelectedDate("2026-09-28")
      setParseError(false)
    } else if (value.includes("10/10")) {
      setSelectedDate("2026-10-10")
      setParseError(false)
    } else if (value.includes("10/4")) {
      setSelectedDate("2026-10-04")
      setParseError(false)
    } else if (value.includes("10/3")) {
      setSelectedDate("2026-10-03")
      setParseError(false)
    }

    const timeMatch = value.match(/(\d{1,2})(?::|時)(\d{2})?/)
    if (timeMatch) {
      setSelectedTime(
        `${timeMatch[1].padStart(2, "0")}:${timeMatch[2] ?? "00"}`,
      )
    }
    const parsedPeople = PEOPLE_OPTIONS.filter(
      (person) => person !== "自分" && value.includes(person),
    )
    if (parsedPeople.length) setPeople(parsedPeople)
  }

  const togglePerson = (person: string) => {
    if (person === "全員") {
      setPeople(["全員"])
      return
    }
    setPeople((current) => {
      const withoutEveryone = current.filter((item) => item !== "全員")
      return withoutEveryone.includes(person)
        ? withoutEveryone.filter((item) => item !== person)
        : [...withoutEveryone, person]
    })
  }

  const ambiguity =
    (variant === "ambiguous" || draft.includes("来週の土")) &&
    !ambiguityResolved
  const hasError = parseError
  const canSave = Boolean(selectedDate) && !hasError
  const saveLabel = canSave
    ? `${getDateLabel(selectedDate)} ${selectedTime ?? "終日"} に保存`
    : "日付を選んでください"

  return (
    <div className="sheet-backdrop sheet-backdrop--solid">
      <section
        className="full-sheet composer-sheet"
        aria-label="予定を書く"
        aria-modal="true"
        onTouchEnd={(event) => {
          if (
            dragStart.current !== undefined &&
            event.changedTouches[0].clientY - dragStart.current > 64
          )
            onClose()
          dragStart.current = undefined
        }}
        onTouchStart={(event) => {
          dragStart.current = event.touches[0].clientY
        }}
        role="dialog"
      >
        <div className="sheet-grabber" aria-hidden="true" />
        <header className="full-sheet-header">
          <strong>予定を書く</strong>
          <Button onClick={onClose}>閉じる</Button>
        </header>

        <div className="full-sheet-scroll">
          <Input
            aria-label="予定を一言で入力"
            autoFocus
            className="composer-main-input"
            onChange={(event) => applyDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              event.preventDefault()
              setConfirmed(true)
            }}
            placeholder="10/3 10時 父 ゴルフ"
            value={draft}
          />
          {confirmed && (
            <p className="parse-confirmation">
              入力を解析しました。札を確認してください。
            </p>
          )}

          <div className="composer-option-group">
            <p>日付</p>
            <div className="option-rail">
              {DATE_OPTIONS.map((option) => (
                <Button
                  aria-pressed={selectedDate === option.value}
                  key={option.value}
                  onClick={() => {
                    setSelectedDate(option.value)
                    setParseError(false)
                  }}
                >
                  {option.label}
                </Button>
              ))}
              <Button onClick={() => setPicker("date")}>日付を選ぶ</Button>
            </div>
          </div>

          <div className="composer-option-group">
            <p>時刻</p>
            <div className="option-rail">
              {TIME_OPTIONS.map((time) => (
                <Button
                  aria-pressed={selectedTime === time}
                  key={time}
                  onClick={() => setSelectedTime(time)}
                >
                  {time}
                </Button>
              ))}
              <Button onClick={() => setPicker("time")}>時刻を選ぶ</Button>
            </div>
            {selectedTime && selectedTime !== "終日" && (
              <div className="option-rail option-rail--end">
                <span>終わり</span>
                {["+1時間", "+2時間"].map((offset) => (
                  <Button
                    aria-pressed={endOffset === offset}
                    key={offset}
                    onClick={() => setEndOffset(offset)}
                  >
                    {offset}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="composer-option-group">
            <p>人</p>
            <div className="option-rail">
              {PEOPLE_OPTIONS.map((person) => (
                <Button
                  aria-pressed={people.includes(person)}
                  key={person}
                  onClick={() => togglePerson(person)}
                >
                  {person}
                </Button>
              ))}
            </div>
          </div>

          {draft && (
            <div className="recent-events">
              <p>最近の予定</p>
              {[
                { title: "歯医者", meta: "は · 19:30" },
                { title: "ゴルフ", meta: "父 · 07:00" },
                { title: "ヨガ", meta: "母 · 10:00" },
              ].map((item) => (
                <Button
                  key={item.title}
                  onClick={() => {
                    applyDraft(`${item.title} ${item.meta}`)
                    const person = item.meta.slice(0, 1)
                    setPeople([person])
                    setSelectedTime(item.meta.slice(-5))
                  }}
                >
                  <strong>{item.title}</strong>
                  <span>{item.meta}</span>
                </Button>
              ))}
            </div>
          )}

          {ambiguity && (
            <div className="clarification">
              <strong>「来週の土曜」はどちら？</strong>
              <div>
                <Button
                  onClick={() => {
                    setSelectedDate("2026-10-10")
                    setAmbiguityResolved(true)
                  }}
                >
                  10/10(土)
                </Button>
                <Button
                  onClick={() => {
                    setSelectedDate("2026-10-03")
                    setAmbiguityResolved(true)
                  }}
                >
                  10/3(土)
                </Button>
              </div>
            </div>
          )}
          {hasError && (
            <p className="composer-error">
              日付と時刻を読み取れませんでした。札から選んでください。
            </p>
          )}
          {selectedDate === "2026-10-03" && selectedTime && (
            <p className="overlap-warning">
              14:00から、さきの予定と重なる可能性があります
            </p>
          )}

          <Button
            aria-expanded={detailsOpen}
            className="details-toggle"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            くわしく
            {detailsOpen ? (
              <ChevronUp aria-hidden="true" />
            ) : (
              <ChevronDown aria-hidden="true" />
            )}
          </Button>

          {detailsOpen && (
            <div className="composer-details">
              <label>
                <span>場所</span>
                <Input placeholder="駅前歯科" />
              </label>
              <label>
                <span>メモ</span>
                <Textarea placeholder="持ち物や連絡事項" rows={3} />
              </label>
              <div className="detail-option">
                <p>繰り返し</p>
                <div className="option-rail">
                  {[
                    "なし",
                    "毎日",
                    "毎週",
                    "隔週",
                    "毎月（日付）",
                    "毎月（第n曜日）",
                    "毎年",
                  ].map((option) => (
                    <Button
                      aria-pressed={recurrence === option}
                      key={option}
                      onClick={() => setRecurrence(option)}
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              </div>
              {recurrence !== "なし" && (
                <div className="detail-option">
                  <p>繰り返しの終わり</p>
                  <div className="option-rail">
                    {["なし", "10回", "12/31まで"].map((option) => (
                      <Button
                        aria-pressed={recurrenceEnd === option}
                        key={option}
                        onClick={() => setRecurrenceEnd(option)}
                      >
                        {option}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <div className="detail-option">
                <p>自分への通知</p>
                <div className="option-rail">
                  {[
                    "なし",
                    "開始時",
                    "10分前",
                    "30分前",
                    "1時間前",
                    "前日",
                  ].map((option) => (
                    <Button
                      aria-pressed={notification === option}
                      key={option}
                      onClick={() => setNotification(option)}
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="binary-options">
                <Button
                  aria-pressed={isPrivate}
                  onClick={() => setIsPrivate((value) => !value)}
                >
                  非公開　{isPrivate ? "オン" : "オフ"}
                </Button>
                <Button
                  aria-pressed={includeInFreeTime}
                  onClick={() => setIncludeInFreeTime((value) => !value)}
                >
                  空き時間に含める　{includeInFreeTime ? "オン" : "オフ"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <footer className="full-sheet-footer">
          {variant === "offline" && (
            <p>オフラインです。保存後、接続時に送信します。</p>
          )}
          <Button disabled={!canSave} onClick={onSave} variant="accent">
            {saveLabel}
          </Button>
        </footer>
        {picker && (
          <div className="subsheet-backdrop">
            <section
              className="bottom-sheet composer-picker"
              aria-modal="true"
              role="dialog"
            >
              <div className="sheet-title">
                <strong>
                  {picker === "date" ? "日付を選ぶ" : "時刻を選ぶ"}
                </strong>
                <Button onClick={() => setPicker(undefined)}>閉じる</Button>
              </div>
              <div className="composer-picker-grid">
                {(picker === "date"
                  ? [
                      "10/1(木)",
                      "10/2(金)",
                      "10/3(土)",
                      "10/4(日)",
                      "10/5(月)",
                      "10/6(火)",
                      "10/7(水)",
                      "10/8(木)",
                      "10/9(金)",
                      "10/10(土)",
                      "10/11(日)",
                      "10/12(月)",
                    ]
                  : [
                      "8:00",
                      "9:00",
                      "10:00",
                      "11:00",
                      "12:00",
                      "13:00",
                      "14:00",
                      "15:00",
                      "16:00",
                      "17:00",
                      "18:00",
                      "19:00",
                    ]
                ).map((option) => (
                  <Button
                    key={option}
                    onClick={() => {
                      if (picker === "date") {
                        const day = option.match(/\d+\/(\d+)/)?.[1] ?? "3"
                        setSelectedDate(
                          `2026-10-${String(day).padStart(2, "0")}`,
                        )
                        setParseError(false)
                      } else {
                        setSelectedTime(option)
                      }
                      setPicker(undefined)
                    }}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  )
}
