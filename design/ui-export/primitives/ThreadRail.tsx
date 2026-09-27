import type { Member } from "../mock"

type ThreadRailProps = {
  members: Member[]
  activeIds?: string[]
  hollow?: boolean
  continuingId?: string
}

export default function ThreadRail({
  members,
  activeIds = [],
  hollow = false,
  continuingId,
}: ThreadRailProps) {
  const activeIndexes = members
    .map((member, index) => (activeIds.includes(member.id) ? index : -1))
    .filter((index) => index >= 0)
  const connector =
    activeIndexes.length > 1
      ? `connector connector--${activeIndexes[0]}-${activeIndexes[activeIndexes.length - 1]}`
      : ""

  return (
    <span className="thread-rail" aria-hidden="true">
      {members.map((member, index) => (
        <span
          className={`thread thread--${index} thread--${member.color} ${
            continuingId === member.id ? "thread--continuing" : ""
          }`}
          key={member.id}
        />
      ))}
      {connector && <span className={connector} />}
      {activeIndexes.map((index) => {
        const member = members[index]
        return (
          <span
            className={`node node--${index} node--${member.color} ${
              hollow ? "node--hollow" : ""
            }`}
            key={member.id}
          />
        )
      })}
    </span>
  )
}
