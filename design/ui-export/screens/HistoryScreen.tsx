import { ArrowLeft } from "lucide-react"
import type { CalendarEvent, Member } from "../mock"
import AppBottomArea from "../primitives/AppBottomArea"
import { Button } from "../primitives/Controls"

type HistoryScreenProps = {
  events: CalendarEvent[]
  members: Member[]
  allRead?: boolean
  onClose: () => void
  onOpenComposer: () => void
  onOpenEvent: (event: CalendarEvent) => void
  onNavigate: (view: "upcoming" | "month" | "availability" | "settings") => void
}

export default function HistoryScreen({
  events,
  members,
  allRead,
  onClose,
  onOpenComposer,
  onOpenEvent,
  onNavigate,
}: HistoryScreenProps) {
  const mother = members.find((member) => member.id === "mother")
  const father = members.find((member) => member.id === "father")
  const saki = members.find((member) => member.id === "saki")
  const rows = [
    {
      actor: "お母さん",
      color: mother?.color,
      action: "映画 を追加",
      time: "3分前",
      event: events.find((event) => event.key === "movie"),
      unread: true,
    },
    {
      actor: "お父さん",
      color: father?.color,
      action: "ゴルフ の時刻を変更",
      time: "18分前",
      event: events.find((event) => event.key === "golf"),
      unread: true,
    },
    {
      actor: "さき",
      color: saki?.color,
      action: "引っ越しの手伝い に参加",
      time: "1時間前",
      event: events.find((event) => event.key === "moving"),
      unread: false,
    },
  ]

  return (
    <main className="app-shell history-screen">
      <header className="secondary-header">
        <Button aria-label="閉じる" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div>
          <p>家族の動き</p>
          <strong>履歴</strong>
        </div>
        <Button>すべて既読</Button>
      </header>
      <section className="secondary-scroll">
        <div className="history-date">今日</div>
        <div className="history-list">
          {rows.map((row) => (
            <Button
              className="history-row"
              key={`${row.actor}-${row.action}`}
              onClick={() => row.event && onOpenEvent(row.event)}
            >
              {!allRead && row.unread && <i aria-label="未読" />}
              <p>
                <span className={`member-text--${row.color}`}>{row.actor}</span>
                <span> が </span>
                <strong>{row.action}</strong>
              </p>
              <time>{row.time}</time>
            </Button>
          ))}
        </div>
        <div className="history-date">昨日</div>
        <div className="history-list">
          <Button
            className="history-row"
            onClick={() => {
              const event = events.find((item) => item.key === "shopping")
              if (event) onOpenEvent(event)
            }}
          >
            <p>
              <span className="member-text--yamabuki">はると</span>
              <span> が </span>
              <strong>まとめ買い を変更</strong>
            </p>
            <time>昨日 20:12</time>
          </Button>
        </div>
      </section>
      <AppBottomArea
        active="upcoming"
        onNavigate={onNavigate}
        onWrite={onOpenComposer}
      />
    </main>
  )
}
