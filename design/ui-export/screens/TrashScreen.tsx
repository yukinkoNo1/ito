import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import type { CalendarEvent } from "../mock"
import AppBottomArea from "../primitives/AppBottomArea"
import { Button } from "../primitives/Controls"

type TrashScreenProps = {
  events: CalendarEvent[]
  startsEmpty?: boolean
  onClose: () => void
  onOpenComposer: () => void
  onRestore: () => void
  onNavigate: (view: "upcoming" | "month" | "availability" | "settings") => void
}

export default function TrashScreen({
  events,
  startsEmpty,
  onClose,
  onOpenComposer,
  onRestore,
  onNavigate,
}: TrashScreenProps) {
  const [restored, setRestored] = useState<string[]>([])
  const rows = [
    {
      event: events.find((event) => event.key === "dentist"),
      deleted: "はると が 9/25 に削除",
      remaining: "あと28日",
    },
    {
      event: events.find((event) => event.key === "beauty"),
      deleted: "さき が 9/24 に削除",
      remaining: "あと27日",
    },
  ].filter(
    (row): row is { event: CalendarEvent deleted: string remaining: string } =>
      Boolean(row.event) && !restored.includes(row.event?.key ?? ""),
  )
  const visibleRows = startsEmpty ? [] : rows

  return (
    <main className="app-shell trash-screen">
      <header className="secondary-header">
        <Button aria-label="閉じる" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div>
          <p>30日後に自動で削除</p>
          <strong>ゴミ箱</strong>
        </div>
        <span />
      </header>
      <section className="secondary-scroll">
        {visibleRows.length ? (
          <div className="trash-list">
            {visibleRows.map((row) => (
              <div className="trash-row" key={row.event.key}>
                <div>
                  <strong>{row.event.title}</strong>
                  <time>
                    {Number(row.event.startDate.slice(5, 7))}月
                    {Number(row.event.startDate.slice(8))}日　
                    {row.event.startTime}
                  </time>
                  <p>
                    {row.deleted} · <span>{row.remaining}</span>
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setRestored((current) => [...current, row.event.key])
                    onRestore()
                  }}
                >
                  元に戻す
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="secondary-empty">
            <strong>ゴミ箱は空です</strong>
            <p>削除した予定は30日間ここに残ります。</p>
          </div>
        )}
      </section>
      <AppBottomArea
        active="settings"
        onNavigate={onNavigate}
        onWrite={onOpenComposer}
      />
    </main>
  )
}
