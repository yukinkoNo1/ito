import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, DAY_MS, fromJst, HOUR_MS } from '@ito/core';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activity,
  aiUsage,
  changes,
  eventMembers,
  events,
  idempotencyKeys,
  notificationLog,
  pendingNotices,
} from '../src/db/schema';
import { backupFileName, cleanup, runBackup } from '../src/services/maintenance';
import { createScheduler } from '../src/services/scheduler';
import { as, createEvent, IDS, seedFamily, timed } from './family';
import { createTestContext, devEnv, send, type TestContext } from './helpers';

/** 掃除とバックアップ（§15 のスケジューラの 4・5。RUNBOOK 7. Phase 7「14 世代のローテーション」） */

// 一時ファイルはリポジトリの .data（.gitignore 済み）に置く（リポジトリの外を書き換えない）
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
let seq = 0;
function tempDir(): string {
  seq++;
  const dir = path.join(REPO, '.data', 'test', `maintenance-${process.pid}-${seq}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Windows では開いたままのファイルを消せないので、少し待ってやり直す（RUNBOOK 4.） */
async function removeDir(dir: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

let ctx: TestContext;
const dirs: string[] = [];
beforeEach(() => {
  ctx = createTestContext(devEnv(), { now: fromJst('2026-09-27', '14:18') });
  seedFamily(ctx);
});
afterEach(async () => {
  ctx.close();
  for (const d of dirs.splice(0)) await removeDir(d);
});

describe('掃除（毎日 4:00）', () => {
  it('ゴミ箱 30 日・changes 90 日・notification_log 60 日・idempotency 48 時間・ai_usage 90 日・activity 1 年・送ったまとめ待ち 7 日', async () => {
    const now = fromJst('2026-09-27', '04:00');
    const db = ctx.database.db;
    // ゴミ箱: 31 日前に消した予定（担当・例外行ごと消える）と、29 日前に消した予定（残る）
    const { event: old } = await createEvent(ctx, 'papa', {
      ...timed('2026-08-01', '10:00', null, { title: '古い', rrule: 'FREQ=DAILY;COUNT=3' }),
    });
    const { event: recent } = await createEvent(ctx, 'papa', timed('2026-08-20', '10:00', null));
    const r = await send(ctx, 'PATCH', `/api/events/${old.id}`, {
      headers: { ...as('papa'), 'if-match': String(old.version) },
      body: { scope: 'this', recurrenceId: '2026-08-02T10:00', changes: { title: '古い（別）' } },
    });
    expect(r.status).toBe(200);
    db.update(events)
      .set({ deletedAt: now - 31 * DAY_MS })
      .where(eq(events.id, old.id))
      .run();
    db.update(events)
      .set({ deletedAt: now - 29 * DAY_MS })
      .where(eq(events.id, recent.id))
      .run();
    const ids = (rows: { id: string }[]) => rows.map((x) => x.id);
    expect(ids(db.select().from(events).all())).toContain(old.id);

    const age = (ms: number) => now - ms;
    db.insert(changes)
      .values([
        { entity: 'event', entityId: 'a', createdAt: age(91 * DAY_MS) },
        { entity: 'event', entityId: 'b', createdAt: age(89 * DAY_MS) },
      ])
      .run();
    db.insert(notificationLog)
      .values([
        { key: 'old', memberId: IDS.papa, sentAt: age(61 * DAY_MS) },
        { key: 'new', memberId: IDS.papa, sentAt: age(59 * DAY_MS) },
      ])
      .run();
    db.insert(idempotencyKeys)
      .values([
        { key: 'old', memberId: IDS.papa, response: '{}', createdAt: age(49 * HOUR_MS) },
        { key: 'new', memberId: IDS.papa, response: '{}', createdAt: age(47 * HOUR_MS) },
      ])
      .run();
    const usage = (id: string, createdAt: number) => ({
      id,
      memberId: IDS.papa,
      createdAt,
      ok: true,
      source: 'ai',
      latencyMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    });
    db.insert(aiUsage)
      .values([usage('old', age(91 * DAY_MS)), usage('new', age(89 * DAY_MS))])
      .run();
    const act = (id: string, createdAt: number) => ({
      id,
      actorId: IDS.papa,
      eventId: 'x',
      action: 'create',
      title: 't',
      diff: '[]',
      visibility: 'family',
      ownerId: IDS.papa,
      createdAt,
    });
    db.insert(activity)
      .values([act('old', age(366 * DAY_MS)), act('new', age(364 * DAY_MS))])
      .run();
    const notice = (id: string, flushedAt: number | null) => ({
      id,
      recipientId: IDS.mama,
      actorId: IDS.papa,
      eventId: 'x',
      action: 'create',
      summary: 's',
      createdAt: age(30 * DAY_MS),
      flushedAt,
    });
    db.insert(pendingNotices)
      .values([
        notice('sent-old', age(8 * DAY_MS)),
        notice('sent-new', age(6 * DAY_MS)),
        notice('waiting', null),
      ])
      .run();

    const result = cleanup(db, now);
    expect(result).toMatchObject({
      trash: 1,
      changes: 1,
      notificationLog: 1,
      idempotency: 1,
      aiUsage: 1,
      activity: 1,
      pendingNotices: 1,
    });
    const left = ids(db.select().from(events).all());
    expect(left).not.toContain(old.id);
    expect(left).toContain(recent.id);
    // 例外行・担当も消えている（外部キーの cascade）
    expect(
      db
        .select()
        .from(events)
        .all()
        .filter((e) => e.parentId === old.id),
    ).toEqual([]);
    expect(
      db
        .select()
        .from(eventMembers)
        .all()
        .filter((m) => m.eventId === old.id),
    ).toEqual([]);
    expect(
      db
        .select()
        .from(changes)
        .all()
        .map((c) => c.entityId),
    ).not.toContain('a');
    expect(
      db
        .select()
        .from(notificationLog)
        .all()
        .map((x) => x.key),
    ).toEqual(['new']);
    expect(
      db
        .select()
        .from(idempotencyKeys)
        .all()
        .map((x) => x.key),
    ).toContain('new');
    expect(
      db
        .select()
        .from(idempotencyKeys)
        .all()
        .map((x) => x.key),
    ).not.toContain('old');
    expect(
      db
        .select()
        .from(aiUsage)
        .all()
        .map((x) => x.id),
    ).toEqual(['new']);
    expect(
      db
        .select()
        .from(activity)
        .all()
        .map((x) => x.id),
    ).toContain('new');
    expect(
      db
        .select()
        .from(activity)
        .all()
        .map((x) => x.id),
    ).not.toContain('old');
    expect(
      db
        .select()
        .from(pendingNotices)
        .all()
        .map((x) => x.id)
        .sort(),
    ).toEqual(['sent-new', 'waiting']);
  });
});

describe('バックアップ（毎日 3:30）', () => {
  it('VACUUM INTO で作り、書きかけ（.tmp）を残さない。中身は開ける DB', async () => {
    const dir = tempDir();
    dirs.push(dir);
    await createEvent(
      ctx,
      'papa',
      timed('2026-10-03', '10:00', null, { title: 'バックアップの確認' }),
    );
    // 前に止まった書きかけが残っていても消す
    writeFileSync(path.join(dir, 'ito-20260926.db.tmp'), 'broken');
    const r = runBackup(ctx.database.db, dir, 14, fromJst('2026-09-27', '03:30'));
    expect(r.file).toBe('ito-20260927.db');
    expect(readdirSync(dir)).toEqual(['ito-20260927.db']);
    const copy = new Database(path.join(dir, r.file), { readonly: true });
    try {
      const row = copy.prepare('SELECT title FROM events').get() as { title: string };
      expect(row.title).toBe('バックアップの確認');
    } finally {
      copy.close();
    }
  });

  it('14 世代を残し、古いものから消す（16 日続けて作る）', () => {
    const dir = tempDir();
    dirs.push(dir);
    let date = '2026-09-01';
    for (let i = 0; i < 16; i++) {
      runBackup(ctx.database.db, dir, 14, fromJst(date, '03:30'));
      date = addDays(date, 1);
    }
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(14);
    expect(files[0]).toBe(backupFileName('2026-09-03'));
    expect(files[13]).toBe(backupFileName('2026-09-16'));
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('スケジューラ: 3:30 を過ぎてその日の分がなければ作り、4:00 を過ぎたら 1 日 1 回掃除する（止まっていた日の分は動き出したときに）', async () => {
    const dir = tempDir();
    dirs.push(dir);
    const s = createScheduler(
      { db: ctx.database.db, clock: ctx.clock, sender: null, logger: ctx.logger },
      60_000,
      { backupDir: dir, backupKeep: 14 },
    );
    ctx.clock.set(fromJst('2026-09-28', '03:29'));
    expect((await s.tick()).backup).toBeUndefined();
    ctx.clock.set(fromJst('2026-09-28', '03:30'));
    expect((await s.tick()).backup).toBe('ito-20260928.db');
    ctx.clock.set(fromJst('2026-09-28', '03:31'));
    expect((await s.tick()).backup).toBeUndefined();
    ctx.clock.set(fromJst('2026-09-28', '03:59'));
    expect((await s.tick()).cleanup).toBeUndefined();
    ctx.clock.set(fromJst('2026-09-28', '04:00'));
    expect((await s.tick()).cleanup).toBeDefined();
    ctx.clock.set(fromJst('2026-09-28', '04:01'));
    expect((await s.tick()).cleanup).toBeUndefined();
    // 次の日は 10:00 に動き出した（3:30・4:00 には止まっていた）
    ctx.clock.set(fromJst('2026-09-29', '10:00'));
    const next = await s.tick();
    expect(next.backup).toBe('ito-20260929.db');
    expect(next.cleanup).toBeDefined();
    await s.stop();
    expect(existsSync(path.join(dir, 'ito-20260928.db'))).toBe(true);
    // ログにはファイル名と件数だけ
    expect(ctx.logs.text).toContain('"msg":"backup"');
    expect(ctx.logs.text).toContain('"msg":"cleanup"');
  });
});
