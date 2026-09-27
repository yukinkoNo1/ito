import type { CalendarEvent, Member } from "../mock"
import { Button } from "./Controls"
import ThreadRail from "./ThreadRail"

const getMemberLabel = (event: CalendarEvent, members: Member[]) =>
  event.forEveryone
    ? "全員"
    : event.memberIds
        .map((id) => members.find((member) => member.id === id)?.shortName)
        .filter(Boolean)
        .join("・")

export default function ScheduleEventRow({
  event,
  members,
  continuingId,
  onEdit,
}: {
  event: CalendarEvent
  members: Member[]
  continuingId?: string
  onEdit: () => void
}) {
  const crossesMidnight = event.startDate !== event.endDate && !event.allDay
  const privateForOther = event.isPrivate && event.title === null
  const member = members.find((item) => item.id === event.memberIds[0])
  const time = event.allDay
    ? "終日"
    : crossesMidnight
      ? `${event.startTime} → 翌${event.endTime}`
      : event.startTime

  return (
    <Button
      className={`timeline-row event-row ${
        event.key === "yoga" ? "event-row--past" : ""
      }`}
      id={event.isNew ? `new-${event.key}` : undefined}
      onClick={onEdit}
    >
      <ThreadRail
        activeIds={event.memberIds}
        continuingId={continuingId}
        hollow={privateForOther}
        members={members}
      />
      <span className="event-content">
        <span className="event-time">
          {event.isNew && (
            <span className="new-mark">
              <i />新
            </span>
          )}
          <time>{time}</time>
        </span>
        <span className="event-copy">
          <strong>{event.title ?? "予定あり"}</strong>
          <small>
            {event.changeLabel ??
              [event.location && `@${event.location}`, event.recurrenceLabel]
                .filter(Boolean)
                .join(" · ")}
          </small>
        </span>
        <span
          className={`member-tag ${
            event.forEveryone
              ? "member-tag--everyone"
              : `member-tag--${member?.color}`
          }`}
        >
          {getMemberLabel(event, members)}
        </span>
      </span>
    </Button>
  )
}
