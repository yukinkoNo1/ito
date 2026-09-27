import { useState } from "react"
import {
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Settings,
} from "lucide-react"
import type { Member } from "../mock"
import { Button } from "../primitives/Controls"

export type AvailabilityVariant = "found" | "empty" | "details"

type AvailabilityScreenProps = {
  members: Member[]
  variant: AvailabilityVariant
  onOpenComposer: (value?: string) => void
  onNavigate: (view: "upcoming" | "month" | "availability" | "settings") => void
}

const CANDIDATES = [
  { date: "10/3(土)", time: "16:00–24:00" },
  { date: "10/4(日)", time: "18:00–24:00" },
  { date: "10/6(火)", time: "19:00–22:00" },
  { date: "10/9(金)", time: "20:00–24:00" },
  { date: "10/12(月)", time: "15:00–18:00" },
]

function TimelineDay({
  date,
  members,
  layout,
}: {
  date: string
  members: Member[]
  layout: number
}) {
  return (
    <div className="availability-day">
      <strong>{date}</strong>
      <div className={`availability-chart availability-chart--${layout}`}>
        <span className="availability-time-labels" aria-hidden="true">
          <i>6</i>
          <i>12</i>
          <i>18</i>
          <i>24</i>
        </span>
        <div className="availability-lanes">
          {members.map((member, index) => (
            <div
              aria-label={`${member.name}の予定`}
              className={`availability-lane availability-lane--${member.color}`}
              key={member.id}
            >
              <span
                className={`busy-block busy-block--${(index + layout) % 4} ${
                  layout === 1 && index === 3 ? "busy-block--private" : ""
                }`}
              />
            </div>
          ))}
          <span
            className={`free-window free-window--${layout}`}
            aria-label="全員が空いている時間"
          />
        </div>
      </div>
    </div>
  )
}

export default function AvailabilityScreen({
  members,
  variant,
  onOpenComposer,
  onNavigate,
}: AvailabilityScreenProps) {
  const [detailsOpen, setDetailsOpen] = useState(variant === "details")
  const [timeRange, setTimeRange] = useState("夜 17–24時")
  const [duration, setDuration] = useState("2時間")
  const [people, setPeople] = useState(["父", "母", "は", "さ"])
  const [showFallbackResults, setShowFallbackResults] = useState(false)
  const candidates =
    variant === "empty" && !showFallbackResults
      ? []
      : variant === "details"
        ? CANDIDATES.slice(0, 2)
        : CANDIDATES

  const togglePerson = (person: string) =>
    setPeople((current) =>
      current.includes(person)
        ? current.filter((item) => item !== person)
        : [...current, person],
    )

  return (
    <main className="app-shell availability-screen">
      <header className="availability-header">
        <div>
          <p>2026年</p>
          <strong>空き時間</strong>
        </div>
        <div>
          <Button aria-label="前の週">
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span>9/27 — 10/3</span>
          <Button aria-label="次の週">
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </header>

      <section className="availability-scroll">
        <div className="availability-answer">
          <div className="section-heading">
            <div>
              <p>答え</p>
              <strong>全員があいている候補</strong>
            </div>
            <span>{candidates.length}件</span>
          </div>
          {candidates.length ? (
            <div className="candidate-list">
              {candidates.map((candidate) => (
                <div
                  className="candidate-row"
                  key={`${candidate.date}-${candidate.time}`}
                >
                  <p>
                    <strong>{candidate.date}</strong>
                    <span>{candidate.time}</span>
                  </p>
                  <Button
                    onClick={() =>
                      onOpenComposer(
                        `${candidate.date} ${candidate.time.split("–")[0]} 全員`,
                      )
                    }
                  >
                    この時間で書く
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="availability-empty">
              <strong>この条件では見つかりません</strong>
              <p>時間を短くするか、次の週を探してみてください。</p>
              <div>
                <Button
                  onClick={() => {
                    setDuration("1時間")
                    setShowFallbackResults(true)
                  }}
                >
                  長さを短くする
                </Button>
                <Button onClick={() => setShowFallbackResults(true)}>
                  次の週を見る
                </Button>
              </div>
            </div>
          )}
        </div>

        <section className="availability-conditions">
          <div>
            <p>時間帯</p>
            <div className="option-rail">
              {["夜 17–24時", "休日 8–24時", "終日 6–24時"].map((option) => (
                <Button
                  aria-pressed={timeRange === option}
                  key={option}
                  onClick={() => setTimeRange(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p>長さ</p>
            <div className="option-rail">
              {["1時間", "2時間", "半日"].map((option) => (
                <Button
                  aria-pressed={duration === option}
                  key={option}
                  onClick={() => setDuration(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p>対象の家族</p>
            <div className="option-rail">
              {members.map((member) => (
                <Button
                  aria-pressed={people.includes(member.shortName)}
                  key={member.id}
                  onClick={() => togglePerson(member.shortName)}
                >
                  {member.shortName}
                </Button>
              ))}
            </div>
          </div>
        </section>

        <Button
          aria-expanded={detailsOpen}
          className="availability-detail-toggle"
          onClick={() => setDetailsOpen((open) => !open)}
        >
          くわしく見る
          {detailsOpen ? (
            <ChevronUp aria-hidden="true" />
          ) : (
            <ChevronDown aria-hidden="true" />
          )}
        </Button>

        {detailsOpen && (
          <section className="availability-timeline" aria-label="家族の時間軸">
            <div className="timeline-legend">
              {members.map((member) => (
                <span
                  className={`timeline-legend--${member.color}`}
                  key={member.id}
                >
                  <i />
                  {member.shortName}
                </span>
              ))}
              <span className="timeline-private-legend">
                <i>///</i>非公開
              </span>
            </div>
            <TimelineDay date="10/3(土)" layout={0} members={members} />
            <TimelineDay date="10/4(日)" layout={1} members={members} />
            <TimelineDay date="10/5(月)" layout={2} members={members} />
          </section>
        )}
      </section>

      <div className="bottom-area">
        <Button className="quick-add-trigger" onClick={() => onOpenComposer()}>
          <b>＋</b>
          <span>予定を書く</span>
          <small>空いている時間から追加</small>
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
                aria-current={index === 2 ? "page" : undefined}
                key={item.label}
                onClick={() => onNavigate(item.view)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Button>
            )
          })}
        </nav>
      </div>
    </main>
  )
}
