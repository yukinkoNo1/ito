import { useRef, useState } from "react"
import { ExternalLink, MapPin } from "lucide-react"
import type { CalendarEvent, Member } from "../mock"
import { Button, Link } from "../primitives/Controls"

export type DetailVariant = "normal" | "recurring" | "multiday" | "private" | "conflict"

type EventDetailSheetProps = {
  event: CalendarEvent
  members: Member[]
  variant?: DetailVariant
  offline?: boolean
  onClose: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

const dateText = (event: CalendarEvent) => {
  const start = new Date(`${event.startDate}T12:00:00`)
  const end = new Date(`${event.endDate}T12:00:00`)
  const startText = `${start.getMonth() + 1}月${start.getDate()}日`
  const endText = `${end.getMonth() + 1}月${end.getDate()}日`
  if (event.allDay && event.startDate !== event.endDate)
    return `${startText} — ${endText}　終日`
  if (event.allDay) return `${startText}　終日`
  if (event.startDate !== event.endDate)
    return `${startText} ${event.startTime} — ${endText} ${event.endTime}`
  return `${startText}　${event.startTime} — ${event.endTime ?? ""}`
}

const memberText = (event: CalendarEvent, members: Member[]) =>
  event.forEveryone
    ? "全員"
    : event.memberIds
        .map((id) => members.find((member) => member.id === id)?.shortName)
        .filter(Boolean)
        .join("・")

function SmallEditSheet({
  field,
  event,
  members,
  onClose,
}: {
  field: "date" | "members"
  event: CalendarEvent
  members: Member[]
  onClose: () => void
}) {
  return (
    <div className="subsheet-backdrop">
      <section
        className="bottom-sheet detail-subsheet"
        aria-modal="true"
        role="dialog"
      >
        <div className="sheet-title">
          <strong>{field === "date" ? "日時を直す" : "人を直す"}</strong>
          <Button onClick={onClose}>閉じる</Button>
        </div>
        {field === "date" ? (
          <>
            <p>日付</p>
            <div className="option-rail">
              {["今日", "明日", "10/3(土)", "10/10(土)", "日付を選ぶ"].map(
                (option, index) => (
                  <Button aria-pressed={index === 2} key={option}>
                    {option}
                  </Button>
                ),
              )}
            </div>
            <p>時刻</p>
            <div className="option-rail">
              {["終日", "9:00", "12:00", "15:00", "18:00", "時刻を選ぶ"].map(
                (option) => (
                  <Button
                    aria-pressed={option === event.startTime}
                    key={option}
                  >
                    {option}
                  </Button>
                ),
              )}
            </div>
          </>
        ) : (
          <div className="detail-member-options">
            {[
              { id: "self", label: "自分" },
              { id: "everyone", label: "全員" },
              ...members.map((member) => ({
                id: member.id,
                label: member.shortName,
              })),
            ].map((option) => (
              <Button
                aria-pressed={
                  option.id === "everyone"
                    ? event.forEveryone
                    : event.memberIds.includes(option.id)
                }
                key={option.id}
              >
                {option.label}
              </Button>
            ))}
          </div>
        )}
        <Button onClick={onClose} variant="accent">
          この内容に変更
        </Button>
      </section>
    </div>
  )
}

function ConflictSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="subsheet-backdrop">
      <section
        className="bottom-sheet conflict-sheet"
        aria-modal="true"
        role="dialog"
      >
        <div className="sheet-title">
          <strong>変更のぶつかりを解決</strong>
          <Button onClick={onClose}>閉じる</Button>
        </div>
        <p>
          家族側では「10:00開始」、自分側では「9:00開始」に変更されています。
        </p>
        <Button onClick={onClose}>家族の変更を使う</Button>
        <Button onClick={onClose}>自分の変更で上書き</Button>
        <Button onClick={onClose}>両方残す</Button>
      </section>
    </div>
  )
}

function RecurrenceDeleteSheet({
  offline,
  onClose,
  onDelete,
}: {
  offline: boolean
  onClose: () => void
  onDelete: () => void
}) {
  return (
    <div className="subsheet-backdrop">
      <section
        className="bottom-sheet recurrence-delete-sheet"
        aria-modal="true"
        role="dialog"
      >
        <div className="sheet-title">
          <strong>どの予定を削除しますか？</strong>
          <Button onClick={onClose}>閉じる</Button>
        </div>
        <Button onClick={onDelete}>この予定だけ</Button>
        <Button disabled={offline} onClick={onDelete}>
          これ以降すべて
        </Button>
        <Button disabled={offline} onClick={onDelete}>
          すべて
        </Button>
        {offline && <p>オフライン中は、ほかの回をまとめて変更できません。</p>}
      </section>
    </div>
  )
}

export default function EventDetailSheet({
  event,
  members,
  variant = "normal",
  offline = false,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
}: EventDetailSheetProps) {
  const [notification, setNotification] = useState("10分前")
  const [editField, setEditField] = useState<"date" | "members">()
  const [conflictOpen, setConflictOpen] = useState(false)
  const [deleteScopeOpen, setDeleteScopeOpen] = useState(false)
  const dragStart = useRef<number>()
  const isPrivate = variant === "private"
  const isRecurring = variant === "recurring" || Boolean(event.recurrenceLabel)
  const owner = members.find((member) => member.id === event.memberIds[0])

  const handleDelete = () => {
    if (isRecurring) {
      setDeleteScopeOpen(true)
      return
    }
    onDelete()
  }

  return (
    <div className="sheet-backdrop sheet-backdrop--solid">
      <section
        className="full-sheet detail-sheet"
        aria-label="予定の詳細"
        aria-modal="true"
        onTouchEnd={(touchEvent) => {
          if (
            dragStart.current !== undefined &&
            touchEvent.changedTouches[0].clientY - dragStart.current > 64
          )
            onClose()
          dragStart.current = undefined
        }}
        onTouchStart={(touchEvent) => {
          dragStart.current = touchEvent.touches[0].clientY
        }}
        role="dialog"
      >
        <div className="sheet-grabber" aria-hidden="true" />
        <header className="full-sheet-header">
          <strong>予定の詳細</strong>
          <Button onClick={onClose}>閉じる</Button>
        </header>

        <div className="full-sheet-scroll detail-scroll">
          {variant === "conflict" && (
            <Button
              className="conflict-banner"
              onClick={() => setConflictOpen(true)}
            >
              家族の変更とぶつかっています　確認する
            </Button>
          )}

          <div className="detail-hero">
            <p>{isPrivate ? "非公開の予定" : "予定"}</p>
            <p className="detail-title">
              {isPrivate ? "予定あり" : event.title}
            </p>
            {isPrivate && (
              <span className={`member-tag member-tag--${owner?.color}`}>
                {owner?.shortName}
              </span>
            )}
          </div>

          <div className="detail-primary-fields">
            <Button onClick={() => setEditField("date")}>
              <span>日時</span>
              <strong>{dateText(event)}</strong>
              <small>タップして直す</small>
            </Button>
            <Button onClick={() => setEditField("members")}>
              <span>人</span>
              <strong>{memberText(event, members)}</strong>
              <small>タップして直す</small>
            </Button>
          </div>

          {!isPrivate && (
            <>
              <section className="detail-section">
                <p className="detail-section-title">自分への通知</p>
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
              </section>

              <section className="detail-section detail-info-list">
                <div>
                  <span>場所</span>
                  <strong>{event.location ?? "駅前歯科"}</strong>
                  <Button>
                    <MapPin aria-hidden="true" />
                    地図で開く
                  </Button>
                </div>
                <div>
                  <span>メモ</span>
                  <p>
                    診察券を忘れずに。詳しくは{" "}
                    <Link
                      href="https://example.com"
                      rel="noreferrer"
                      target="_blank"
                    >
                      example.com
                      <ExternalLink aria-hidden="true" />
                    </Link>
                  </p>
                </div>
                {isRecurring && (
                  <div>
                    <span>繰り返し</span>
                    <strong>{event.recurrenceLabel ?? "毎週"}</strong>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="detail-actions">
          <Button onClick={onEdit} variant="accent">
            編集
          </Button>
          <Button onClick={onDuplicate}>複製</Button>
          <Button onClick={handleDelete}>削除</Button>
        </footer>

        {editField && (
          <SmallEditSheet
            event={event}
            field={editField}
            members={members}
            onClose={() => setEditField(undefined)}
          />
        )}
        {conflictOpen && (
          <ConflictSheet onClose={() => setConflictOpen(false)} />
        )}
        {deleteScopeOpen && (
          <RecurrenceDeleteSheet
            offline={offline}
            onClose={() => setDeleteScopeOpen(false)}
            onDelete={onDelete}
          />
        )}
      </section>
    </div>
  )
}
