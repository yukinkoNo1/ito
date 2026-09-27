import { createHash } from 'node:crypto';
import {
  addDays,
  compareOccurrences,
  type DisplayFeedV1,
  expandAll,
  type FeedOccurrence,
  fromJst,
  holidaysBetween,
  type MemberColor,
  projectEvent,
  todayJst,
  toIsoJst,
} from '@ito/core';
import type { DbLike } from '../db/client';
import { listActiveMembers } from './members';
import { loadActiveEvents } from './records';

/**
 * 表示用フィードの本文（§13.1）。同じデータ・同じ日付なら同じバイト列にする
 * （項目と回の並びを固定し、生成時刻を入れない）。非公開は閲覧者なし（null）で投影する。
 */
export function buildDisplayFeed(db: DbLike, nowMs: number, days: number): DisplayFeedV1 {
  const from = todayJst(nowMs);
  const to = addDays(from, days);
  const fromMs = fromJst(from);
  const toMs = fromJst(to);

  const active = listActiveMembers(db);
  const order = new Map(active.map((m, i) => [m.id, i]));
  const members = active.map((m) => ({
    id: m.id,
    name: m.name,
    mark: m.mark,
    color: m.color as MemberColor,
  }));

  // 閲覧者なしで投影（持ち主のものも含め、誰の非公開も中身を出さない）
  const dtos = loadActiveEvents(db).map((r) => projectEvent(r, null));
  const occurrences: FeedOccurrence[] = [];
  const expanded = expandAll(dtos, fromMs, toMs).sort(compareOccurrences);
  for (const occ of expanded) {
    const e = occ.event;
    const isPrivate = e.visibility === 'private';
    // 無効化したメンバーの ID は除き、members と同じ順・重複なしにする
    const memberIds = e.forEveryone
      ? []
      : [...new Set(e.memberIds.filter((id) => order.has(id)))].sort(
          (a, b) => (order.get(a) as number) - (order.get(b) as number),
        );
    // 担当が全員無効化したメンバーだった回は出さない（全員の予定を除く）
    if (!e.forEveryone && memberIds.length === 0) continue;
    const base = {
      key: occ.key,
      title: isPrivate ? null : e.title,
      memberIds,
      forEveryone: isPrivate ? false : e.forEveryone,
      busy: e.busy,
      private: isPrivate,
    };
    if (occ.allDay) {
      occurrences.push({ ...base, allDay: true, startDate: occ.startDate, endDate: occ.endDate });
    } else {
      occurrences.push({
        ...base,
        allDay: false,
        startAt: toIsoJst(occ.startMs),
        endAt: occ.endMs === null ? null : toIsoJst(occ.endMs),
      });
    }
  }

  return {
    version: 1,
    range: { from, to },
    holidays: holidaysBetween(from, to),
    members,
    occurrences,
  };
}

/** 本文のバイト列と ETag（本文の SHA-256 の先頭 16 バイトを 16 進にして " で囲む） */
export function serializeFeed(feed: DisplayFeedV1): { body: string; etag: string } {
  const body = JSON.stringify(feed);
  const hex = createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 32);
  return { body, etag: `"${hex}"` };
}

/** If-None-Match が ETag を含むか（W/ と * も受け付ける） */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(',')
    .map((s) => s.trim().replace(/^W\//, ''))
    .some((t) => t === etag || t === '*');
}
