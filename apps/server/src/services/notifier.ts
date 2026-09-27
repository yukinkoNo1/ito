import {
  addDays,
  CHANGE_BATCH_MIN,
  type Clock,
  canSeeContent,
  compareOccurrences,
  DIGEST_TTL_SEC,
  type DigestKind,
  digestDateDue,
  digestKey,
  digestTargetDate,
  type EventDTO,
  type EventRecord,
  effectiveOffsets,
  expandAll,
  fitPayload,
  formatMdW,
  formatTimeShort,
  fromJst,
  hideDetails,
  inQuietHours,
  inSendWindow,
  MAX_FAIL_COUNT,
  MINUTE_MS,
  type NotificationSettings,
  type Occurrence,
  offsetLabel,
  type PushPayload,
  REMINDER_LOOKAHEAD_DAYS,
  REMINDER_LOOKBACK_MIN,
  readMemberSettings,
  recordToDto,
  reminderAt,
  reminderKey,
  todayJst,
  toJstParts,
} from '@ito/core';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import {
  type MemberRow,
  notificationLog,
  type PendingNoticeRow,
  pendingNotices,
  reminderPrefs,
} from '../db/schema';
import type { Logger } from '../logger';
import { countUnread } from './activity';
import { listActiveMembers } from './members';
import { listSubscriptionsOf, markDelivered, markFailed, removeGone } from './push';
import type { PushOptions, PushSender } from './push-sender';
import { loadActiveEvents } from './records';

/**
 * 通知を作って送る（§15）。送り先ごとに projectEvent と同じ規則で中身を見せるかを決める
 * （他人の非公開は「予定あり」。§10・§18 T5）。ロック画面に予定名を出さない設定なら文を伏せる（T8）。
 * ログには件数・種類・状態コードだけを出す（予定名・endpoint を出さない）。
 */

export interface NotifierDeps {
  db: DbLike;
  clock: Clock;
  sender: PushSender | null;
  logger: Logger;
}

export type DeliveryOutcome = 'sent' | 'gone' | 'retry' | 'failed' | 'none';

const HIDDEN_EVENT_TITLE = '予定あり';

function notificationSettingsOf(m: MemberRow): NotificationSettings {
  return readMemberSettings(m.settings).notifications;
}

function titleFor(event: Pick<EventRecord, 'title' | 'visibility' | 'ownerId'>, viewerId: string) {
  return canSeeContent(event, viewerId) ? event.title : HIDDEN_EVENT_TITLE;
}

/**
 * 1 人の全端末に送る。1 台でも届けば sent。すべて 404/410 で消したら gone。
 * 429・5xx・通信エラーが残れば retry（次の実行で再送）。失敗が 5 回を超えた購読には送らない
 */
export async function deliver(
  deps: NotifierDeps,
  member: MemberRow,
  payload: PushPayload,
  options: PushOptions,
): Promise<DeliveryOutcome> {
  const { db, clock, sender, logger } = deps;
  if (!sender) return 'none';
  const subs = listSubscriptionsOf(db, member.id).filter((s) => s.failCount <= MAX_FAIL_COUNT);
  if (subs.length === 0) return 'none';
  const settings = notificationSettingsOf(member);
  const body = fitPayload(
    settings.showDetailsOnLockScreen || payload.kind === 'test' ? payload : hideDetails(payload),
  );
  let sent = 0;
  let gone = 0;
  let retry = 0;
  for (const s of subs) {
    const result = await sender.send(s, body, options);
    switch (result.kind) {
      case 'ok':
        markDelivered(db, s.id, clock.now());
        sent++;
        break;
      case 'gone':
        removeGone(db, s.id, member.id);
        gone++;
        break;
      case 'retry':
      case 'fail':
        markFailed(db, s.id, s.failCount);
        if (result.kind === 'retry') retry++;
        if (s.failCount + 1 > MAX_FAIL_COUNT) {
          logger.warn({ memberId: member.id, subscriptionId: s.id }, 'push subscription stopped');
        }
        break;
    }
    logger.info(
      {
        memberId: member.id,
        kind: payload.kind,
        result: result.kind,
        ...('status' in result ? { status: result.status } : {}),
      },
      'push',
    );
  }
  if (sent > 0) return 'sent';
  if (gone === subs.length) return 'gone';
  if (retry > 0) return 'retry';
  return 'failed';
}

function wasSent(db: DbLike, key: string): boolean {
  return db.select().from(notificationLog).where(eq(notificationLog.key, key)).get() !== undefined;
}

function writeLog(db: DbLike, key: string, memberId: string, now: number): void {
  db.insert(notificationLog).values({ key, memberId, sentAt: now }).onConflictDoNothing().run();
}

/** 通知の本文の日時（「今日 19:00〜20:00」「明日（終日）」「10月3日(土)〜10月4日(日)」） */
export function whenLabel(o: Occurrence, nowMs: number): string {
  const today = todayJst(nowMs);
  const day = (d: string) =>
    d === today ? '今日' : d === addDays(today, 1) ? '明日' : formatMdW(d);
  if (o.allDay) {
    return o.startDate === o.endDate
      ? `${day(o.startDate)}（終日）`
      : `${day(o.startDate)}〜${formatMdW(o.endDate)}`;
  }
  const start = formatTimeShort(o.startTime as string);
  return o.endTime
    ? `${day(o.startDate)} ${start}〜${formatTimeShort(o.endTime)}`
    : `${day(o.startDate)} ${start}〜`;
}

function occurrenceUrl(o: Occurrence): string {
  return o.recurrenceId
    ? `/e/${o.seriesId}?r=${encodeURIComponent(o.recurrenceId)}`
    : `/e/${o.seriesId}`;
}

function expandRecords(records: EventRecord[], fromMs: number, toMs: number) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const occs = expandAll(records.map(recordToDto), fromMs, toMs).sort(compareOccurrences);
  return occs.map((o) => ({ occ: o, record: byId.get(o.event.id) as EventRecord }));
}

function badgeOf(db: DbLike, m: MemberRow): number {
  return Math.min(countUnread(db, m), 9999);
}

/* ───────── 1. 予定の通知 ───────── */

export interface ReminderJob {
  key: string;
  member: MemberRow;
  occ: Occurrence<EventDTO>;
  record: EventRecord;
  offset: number;
  at: number;
}

/** 今送るべき予定の通知（まだ送っていないもの） */
export function dueReminders(db: DbLike, nowMs: number): ReminderJob[] {
  const fromMs = nowMs - REMINDER_LOOKBACK_MIN * MINUTE_MS;
  const toMs = nowMs + REMINDER_LOOKAHEAD_DAYS * 24 * 60 * MINUTE_MS;
  const active = listActiveMembers(db);
  if (active.length === 0) return [];
  const prefs = new Map<string, number[]>();
  for (const r of db.select().from(reminderPrefs).all()) {
    try {
      const v: unknown = JSON.parse(r.offsets);
      if (Array.isArray(v)) {
        prefs.set(
          `${r.eventId}:${r.memberId}`,
          v.filter((x): x is number => typeof x === 'number'),
        );
      }
    } catch {}
  }
  const settings = new Map(active.map((m) => [m.id, notificationSettingsOf(m)]));
  const jobs: ReminderJob[] = [];
  for (const { occ, record } of expandRecords(loadActiveEvents(db), fromMs, toMs)) {
    // 開始が範囲の外の回（前から続く長い予定）は通知の対象にしない
    if (occ.startMs < fromMs || occ.startMs > toMs) continue;
    for (const m of active) {
      const offsets = effectiveOffsets(
        record,
        m.id,
        prefs.get(`${occ.seriesId}:${m.id}`),
        settings.get(m.id) as NotificationSettings,
      );
      for (const offset of offsets) {
        const at = reminderAt(occ, offset);
        if (!inSendWindow(at, nowMs)) continue;
        const key = reminderKey(occ.key, occ.startMs, m.id, offset);
        if (wasSent(db, key)) continue;
        jobs.push({ key, member: m, occ: occ as Occurrence<EventDTO>, record, offset, at });
      }
    }
  }
  return jobs.sort((a, b) => a.at - b.at);
}

export function reminderPayload(job: ReminderJob, nowMs: number, badge?: number): PushPayload {
  return {
    v: 1,
    kind: 'reminder',
    title: titleFor(job.record, job.member.id),
    body: `${whenLabel(job.occ, nowMs)}（${offsetLabel(job.offset, job.occ.allDay)}の通知）`,
    url: occurrenceUrl(job.occ),
    tag: `rem:${job.occ.key}`,
    ...(badge !== undefined ? { badge } : {}),
  };
}

/** TTL は開始までの秒数（最低 60 秒）・urgency high（§15） */
export function reminderOptions(job: ReminderJob, nowMs: number): PushOptions {
  return { TTL: Math.max(60, Math.ceil((job.occ.startMs - nowMs) / 1000)), urgency: 'high' };
}

export async function sendReminders(deps: NotifierDeps): Promise<number> {
  const now = deps.clock.now();
  let sent = 0;
  for (const job of dueReminders(deps.db, now)) {
    const payload = reminderPayload(job, now, badgeOf(deps.db, job.member));
    const outcome = await deliver(deps, job.member, payload, reminderOptions(job, now));
    // log は送信に成功してから（または 404/410 で購読を消してから）書く。retry は次の実行で再送
    if (outcome === 'sent' || outcome === 'gone' || outcome === 'failed') {
      writeLog(deps.db, job.key, job.member.id, deps.clock.now());
    }
    if (outcome === 'sent') sent++;
  }
  return sent;
}

/* ───────── 2. 朝のまとめ・前夜の予告 ───────── */

const DIGEST_LINES = 3;

export function digestPayload(
  kind: DigestKind,
  member: MemberRow,
  items: { occ: Occurrence; record: EventRecord }[],
  badge?: number,
): PushPayload {
  const lines = items.slice(0, DIGEST_LINES).map(({ occ, record }) => {
    const when = occ.allDay ? '終日' : formatTimeShort(occ.startTime as string);
    return `${when} ${titleFor(record, member.id)}`;
  });
  if (items.length > DIGEST_LINES) lines.push(`ほか ${items.length - DIGEST_LINES}件`);
  return {
    v: 1,
    kind: 'digest',
    title: `${kind === 'morning' ? '今日' : '明日'}の予定 ${items.length}件`,
    body: lines.join('\n'),
    url: '/',
    tag: `digest:${kind}`,
    ...(badge !== undefined ? { badge } : {}),
  };
}

/** その日の家族の予定（その日にかかる回。前から続く終日を含む） */
function occurrencesOn(records: EventRecord[], date: string) {
  const fromMs = fromJst(date);
  return expandRecords(records, fromMs, fromJst(addDays(date, 1)));
}

export async function sendDigests(deps: NotifierDeps): Promise<number> {
  const { db, clock } = deps;
  const now = clock.now();
  let records: EventRecord[] | null = null;
  let sent = 0;
  for (const m of listActiveMembers(db)) {
    const settings = notificationSettingsOf(m);
    const plans: [DigestKind, NotificationSettings['morningDigest']][] = [
      ['morning', settings.morningDigest],
      ['evening', settings.eveningPreview],
    ];
    for (const [kind, rule] of plans) {
      if (!rule.enabled) continue;
      const sendDate = digestDateDue(rule.time, now);
      if (!sendDate) continue;
      const key = digestKey(kind, m.id, sendDate);
      if (wasSent(db, key)) continue;
      records ??= loadActiveEvents(db);
      const items = occurrencesOn(records, digestTargetDate(kind, sendDate));
      // 予定がない日は送らない
      if (items.length === 0) continue;
      const outcome = await deliver(deps, m, digestPayload(kind, m, items, badgeOf(db, m)), {
        TTL: DIGEST_TTL_SEC,
        urgency: 'normal',
      });
      if (outcome === 'sent' || outcome === 'gone' || outcome === 'failed') {
        writeLog(db, key, m.id, clock.now());
      }
      if (outcome === 'sent') sent++;
    }
  }
  return sent;
}

/* ───────── 3. 家族の変更 ───────── */

export function changePayload(notices: PendingNoticeRow[], badge?: number): PushPayload {
  const first = notices[0] as PendingNoticeRow;
  const single = notices.length === 1;
  const lines = notices.slice(0, DIGEST_LINES).map((n) => n.summary);
  if (notices.length > DIGEST_LINES) lines.push(`ほか ${notices.length - DIGEST_LINES}件`);
  return {
    v: 1,
    kind: 'change',
    title: single ? '家族の予定の変更' : `家族の予定の変更 ${notices.length}件`,
    body: lines.join('\n'),
    url: single && first.action !== 'delete' ? `/e/${first.eventId}` : '/activity',
    tag: 'change',
    ...(badge !== undefined ? { badge } : {}),
  };
}

/** 2 分まとめ・静かな時間（§15）。最後の変更から 2 分たち、静かな時間でなければ 1 通にまとめて送る */
export async function flushFamilyNotices(deps: NotifierDeps): Promise<number> {
  const { db, clock } = deps;
  const now = clock.now();
  const pending = db.select().from(pendingNotices).where(isNull(pendingNotices.flushedAt)).all();
  if (pending.length === 0) return 0;
  const byRecipient = new Map<string, PendingNoticeRow[]>();
  for (const p of pending) {
    const list = byRecipient.get(p.recipientId) ?? [];
    list.push(p);
    byRecipient.set(p.recipientId, list);
  }
  const active = new Map(listActiveMembers(db).map((m) => [m.id, m]));
  const flush = (ids: string[]) => {
    for (let i = 0; i < ids.length; i += 500) {
      db.update(pendingNotices)
        .set({ flushedAt: now })
        .where(
          and(inArray(pendingNotices.id, ids.slice(i, i + 500)), isNull(pendingNotices.flushedAt)),
        )
        .run();
    }
  };
  let sent = 0;
  for (const [recipientId, list] of byRecipient) {
    const ids = list.map((n) => n.id);
    const member = active.get(recipientId);
    const settings = member ? notificationSettingsOf(member) : null;
    // 無効化した人・設定を off にした人の分は捨てる
    if (!member || !settings || settings.familyChanges === 'off') {
      flush(ids);
      continue;
    }
    const last = Math.max(...list.map((n) => n.createdAt));
    if (now - last < CHANGE_BATCH_MIN * MINUTE_MS) continue;
    if (inQuietHours(now, settings.quietHours)) continue;
    list.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    const outcome = await deliver(deps, member, changePayload(list, badgeOf(db, member)), {
      TTL: DIGEST_TTL_SEC,
      urgency: 'normal',
    });
    if (outcome === 'retry') continue;
    flush(ids);
    if (outcome === 'sent') sent++;
  }
  return sent;
}

/* ───────── テスト通知 ───────── */

export async function sendTestNotification(
  deps: NotifierDeps,
  member: MemberRow,
): Promise<DeliveryOutcome> {
  return deliver(
    deps,
    member,
    {
      v: 1,
      kind: 'test',
      title: 'いと',
      body: `テスト通知です（${formatTimeShort(toJstParts(deps.clock.now()).time)}）`,
      url: '/settings',
      tag: 'test',
    },
    { TTL: 600, urgency: 'high' },
  );
}

/** 終わった予定の通知の記録を読み取るテスト用の口 */
export function sentKeys(db: DbLike, memberId: string): string[] {
  return db
    .select()
    .from(notificationLog)
    .where(eq(notificationLog.memberId, memberId))
    .all()
    .map((r) => r.key);
}
