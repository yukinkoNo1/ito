import { useState } from "react"
import { ArrowLeft, Search, X } from "lucide-react"
import type { CalendarEvent, Member } from "../mock"
import AppBottomArea from "../primitives/AppBottomArea"
import { Button, Input } from "../primitives/Controls"
import ScheduleEventRow from "../primitives/ScheduleEventRow"

export type SearchVariant = "recent" | "results" | "empty"

type SearchScreenProps = {
  events: CalendarEvent[]
  members: Member[]
  variant: SearchVariant
  onClose: () => void
  onOpenComposer: () => void
  onOpenEvent: (event: CalendarEvent) => void
  onNavigate: (view: "upcoming" | "month" | "availability" | "settings") => void
}

export default function SearchScreen({
  events,
  members,
  variant,
  onClose,
  onOpenComposer,
  onOpenEvent,
  onNavigate,
}: SearchScreenProps) {
  const [query, setQuery] = useState(
    variant === "results" ? "ゴルフ" : variant === "empty" ? "発表会" : "",
  )
  const [selectedPeople, setSelectedPeople] = useState<string[]>([])
  const matchingEvents =
    variant === "empty" || query === "発表会"
      ? []
      : query
        ? events.filter(
            (event) =>
              event.title?.includes(query) ||
              event.location?.includes(query) ||
              (query === "家族" && event.forEveryone),
          )
        : []
  const resultEvents = matchingEvents.filter(
    (event) =>
      !selectedPeople.length ||
      selectedPeople.some((id) => event.memberIds.includes(id)),
  )
  const groupedDates = [
    ...new Set(resultEvents.map((event) => event.startDate)),
  ]

  const togglePerson = (id: string) =>
    setSelectedPeople((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    )

  return (
    <main className="app-shell search-screen">
      <header className="search-header">
        <Button aria-label="閉じる" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div>
          <Search aria-hidden="true" />
          <Input
            aria-label="予定を検索"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="予定名、場所、メモ"
            value={query}
          />
          {query && (
            <Button aria-label="検索語を消す" onClick={() => setQuery("")}>
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>
      <div className="search-people" aria-label="人で絞り込み">
        {members.map((member) => (
          <Button
            aria-pressed={selectedPeople.includes(member.id)}
            className={`search-person search-person--${member.color}`}
            key={member.id}
            onClick={() => togglePerson(member.id)}
          >
            {member.shortName}
          </Button>
        ))}
      </div>
      <section className="secondary-scroll search-content">
        {!query ? (
          <div className="recent-searches">
            <p>最近の検索</p>
            {["ゴルフ", "歯医者", "家族", "駅前"].map((term) => (
              <Button key={term} onClick={() => setQuery(term)}>
                {term}
              </Button>
            ))}
          </div>
        ) : resultEvents.length ? (
          <div className="search-results">
            <p className="search-count">
              {resultEvents.length}件見つかりました
            </p>
            {groupedDates.map((date) => {
              const value = new Date(`${date}T12:00:00`)
              const weekday = ["日", "月", "火", "水", "木", "金", "土"][
                value.getDay()
              ]
              return (
                <div className="search-date-group" key={date}>
                  <div className="search-date-heading">
                    {value.getMonth() + 1}月{value.getDate()}日　{weekday}曜日
                  </div>
                  {resultEvents
                    .filter((event) => event.startDate === date)
                    .map((event) => (
                      <ScheduleEventRow
                        event={event}
                        key={event.key}
                        members={members}
                        onEdit={() => onOpenEvent(event)}
                      />
                    ))}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="secondary-empty">
            <strong>「{query}」は見つかりませんでした</strong>
            <p>人の絞り込みを外すか、短い言葉で試してください。</p>
          </div>
        )}
      </section>
      <AppBottomArea
        active="upcoming"
        onNavigate={onNavigate}
        onWrite={onOpenComposer}
      />
    </main>
  )
}
