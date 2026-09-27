import type { CSSProperties } from 'react';
import type { MemberVM } from '../types';

type ThreadRailProps = {
  members: MemberVM[];
  activeIds?: string[];
  hollow?: boolean;
  /** 複数日の終日予定が続いている家族（その区間は糸を太くする） */
  continuingIds?: string[];
};

/** 糸の位置（rem）。4 人までは書き出しのクラス（.thread--0〜3）、5 人以上は均等割り（§24 D29） */
function leftRem(index: number, count: number): number {
  if (count <= 1) return 1;
  return 1 + (index * 1.5) / (count - 1);
}

export default function ThreadRail({
  members,
  activeIds = [],
  hollow = false,
  continuingIds = [],
}: ThreadRailProps) {
  const manyMembers = members.length > 4;
  const position = (index: number): CSSProperties | undefined =>
    manyMembers ? { left: `${leftRem(index, members.length)}rem` } : undefined;
  const activeIndexes = members
    .map((member, index) => (activeIds.includes(member.id) ? index : -1))
    .filter((index) => index >= 0);
  const first = activeIndexes[0] ?? 0;
  const last = activeIndexes[activeIndexes.length - 1] ?? 0;
  const connector = activeIndexes.length > 1 ? `connector connector--${first}-${last}` : '';
  const connectorStyle: CSSProperties | undefined = manyMembers
    ? {
        left: `${leftRem(first, members.length)}rem`,
        width: `${leftRem(last, members.length) - leftRem(first, members.length)}rem`,
      }
    : undefined;

  return (
    <span className="thread-rail" aria-hidden="true">
      {members.map((member, index) => (
        <span
          className={`thread thread--${index} thread--${member.color} ${
            continuingIds.includes(member.id) ? 'thread--continuing' : ''
          }`}
          key={member.id}
          style={position(index)}
        />
      ))}
      {connector && <span className={connector} style={connectorStyle} />}
      {activeIndexes.map((index) => {
        const member = members[index] as MemberVM;
        return (
          <span
            className={`node node--${index} node--${member.color} ${hollow ? 'node--hollow' : ''}`}
            key={member.id}
            style={position(index)}
          />
        );
      })}
    </span>
  );
}
