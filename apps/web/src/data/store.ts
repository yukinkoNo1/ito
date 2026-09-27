import {
  applyChangesLocally,
  type Clock,
  canSeeContent,
  createLocally,
  type EventChangesInput,
  type EventCreateInput,
  type EventDTO,
  eventChangesSchema,
  eventCreateSchema,
  eventDtoSchema,
  type FieldError,
  type MeDTO,
  syncResponseSchema,
  uuidv7,
} from '@ito/core';
import { apiRequest, type Fetcher, NetworkError, problemCode } from './api';
import type { ConflictRecord, ItoDb, LocalEvent, OutboxItem } from './db';
import { diffChanges, dtoToCreateBody } from './diff';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

export type SyncBlock =
  | { kind: 'no_identity' }
  | { kind: 'not_member'; login: string | null }
  | { kind: 'client_outdated' }
  | { kind: 'server' };

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  block: SyncBlock | null;
}

export interface Toast {
  kind: 'info' | 'error';
  message: string;
}

/** 送信の再送の間隔（指数バックオフ。最大 1 時間。§12） */
export function backoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.min(attempts, 20), 60 * 60 * 1000);
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

/**
 * 手元の DB（Dexie）と同期（pull）・送信待ち（outbox）をまとめて持つ（§12）。
 * 画面はいつも Dexie から描画し、ここは Dexie を書き換えるだけ。
 */
export class DataStore {
  private state: SyncState = { status: 'syncing', lastSyncedAt: null, block: null };
  private listeners = new Set<(s: SyncState) => void>();
  private toastListeners = new Set<(t: Toast) => void>();
  private running: Promise<void> | null = null;
  private again = false;
  /** 送信中の送信待ち（畳む対象から外す） */
  private inflightId: string | null = null;

  constructor(
    readonly db: ItoDb,
    private readonly clock: Clock,
    private readonly fetcher?: Fetcher,
  ) {}

  /* ───────── 状態の通知 ───────── */

  getState(): SyncState {
    return this.state;
  }

  subscribe(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onToast(fn: (t: Toast) => void): () => void {
    this.toastListeners.add(fn);
    return () => this.toastListeners.delete(fn);
  }

  private setState(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private toast(t: Toast): void {
    for (const fn of this.toastListeners) fn(t);
  }

  async me(): Promise<MeDTO | undefined> {
    return this.db.getMeta<MeDTO>('me');
  }

  private async meId(): Promise<string> {
    const me = await this.me();
    if (!me) throw new Error('まだ同期していません');
    return me.id;
  }

  /* ───────── 同期 ───────── */

  /**
   * 送信（push）→ 取得（pull）。同時に呼ばれたら 1 回にまとめて、終わったあとにもう 1 回だけ回す。
   * retryNow: バックオフ中の送信待ちもすぐ送り直す（online イベント・前面復帰・再試行ボタン）
   */
  syncNow(opts: { retryNow?: boolean } = {}): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.cycle(opts.retryNow ?? false);
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async cycle(retryNow: boolean): Promise<void> {
    this.setState({ status: 'syncing' });
    if (retryNow) await this.resetBackoff();
    const pushed = await this.push();
    if (pushed === 'offline') {
      this.setState({ status: 'offline' });
      return;
    }
    if (pushed === 'blocked') return;
    const pulled = await this.pull();
    if (pulled === 'offline') {
      this.setState({ status: 'offline' });
      return;
    }
    if (pulled === 'blocked') return;
    // つながったので、バックオフ中の送信待ちがあれば送り直す
    const waiting = await this.db.outbox.count();
    if (waiting > 0) {
      await this.resetBackoff();
      const again = await this.push();
      if (again === 'offline') {
        this.setState({ status: 'offline' });
        return;
      }
      if (again === 'blocked') return;
    }
    this.setState({ status: 'synced', lastSyncedAt: this.clock.now(), block: null });
  }

  private async resetBackoff(): Promise<void> {
    await this.db.outbox.toCollection().modify({ nextAttemptAt: 0 });
  }

  private block(block: SyncBlock): 'blocked' {
    this.setState({ status: 'error', block });
    return 'blocked';
  }

  /** 取得（GET /api/sync）。応答は zod で確かめてから手元に反映する */
  async pull(): Promise<'ok' | 'offline' | 'blocked'> {
    const cursor = (await this.db.getMeta<number>('cursor')) ?? 0;
    let res: Awaited<ReturnType<typeof apiRequest>>;
    try {
      res = await apiRequest('GET', `/api/sync?cursor=${cursor}`, { fetcher: this.fetcher });
    } catch (e) {
      if (e instanceof NetworkError) return 'offline';
      throw e;
    }
    if (res.status !== 200) return this.blockFor(res.status, res.body) ?? 'offline';
    const parsed = syncResponseSchema.safeParse(res.body);
    if (!parsed.success) return this.block({ kind: 'server' });
    const data = parsed.data;
    const db = this.db;
    await db.transaction(
      'rw',
      [db.events, db.members, db.meta, db.outbox, db.conflicts],
      async () => {
        const pending = new Set((await db.outbox.toArray()).map((o) => o.eventId));
        const conflicted = new Set((await db.conflicts.toArray()).map((c) => c.eventId));
        const keep = (id: string) => pending.has(id) || conflicted.has(id);
        if (data.full) {
          const incoming = new Set(data.events.map((e) => e.id));
          const localIds = (await db.events.toCollection().primaryKeys()) as string[];
          const gone = localIds.filter((id) => !incoming.has(id) && !keep(id));
          await db.events.bulkDelete(gone);
        }
        await db.events.bulkPut(
          data.events.filter((e) => !keep(e.id)).map((e) => ({ ...e, sync: 'synced' as const })),
        );
        await db.events.bulkDelete(data.deletedEventIds.filter((id) => !keep(id)));
        await db.members.clear();
        await db.members.bulkPut(data.members);
        await db.setMeta('cursor', data.cursor);
        await db.setMeta('me', data.me);
        await db.setMeta('unreadActivity', data.unreadActivity);
        await db.setMeta('myReminderPrefs', data.myReminderPrefs);
        await db.setMeta('lastSyncedAt', this.clock.now());
      },
    );
    return 'ok';
  }

  private blockFor(status: number, body: unknown): 'blocked' | null {
    const code = problemCode(body);
    if (status === 401) return this.block({ kind: 'no_identity' });
    if (status === 403 && code === 'not_member') {
      const login =
        typeof body === 'object' &&
        body !== null &&
        'login' in body &&
        typeof (body as { login: unknown }).login === 'string'
          ? (body as { login: string }).login
          : null;
      return this.block({ kind: 'not_member', login });
    }
    if (status === 426) return this.block({ kind: 'client_outdated' });
    if (status >= 500) return null;
    return null;
  }

  /** 送信（outbox を順に）。応答ごとの扱いは §12 の表のとおり */
  async push(): Promise<'ok' | 'offline' | 'blocked'> {
    for (;;) {
      const item = await this.db.outbox.orderBy('createdAt').first();
      if (!item) return 'ok';
      if (item.nextAttemptAt > this.clock.now()) return 'offline';
      this.inflightId = item.id;
      let res: Awaited<ReturnType<typeof apiRequest>>;
      try {
        res = await apiRequest(item.method, item.path, {
          body: item.body,
          headers: {
            'Idempotency-Key': item.id,
            ...(item.baseVersion !== null ? { 'If-Match': String(item.baseVersion) } : {}),
          },
          fetcher: this.fetcher,
        });
      } catch (e) {
        this.inflightId = null;
        if (!(e instanceof NetworkError)) throw e;
        await this.db.outbox.update(item.id, {
          attempts: item.attempts + 1,
          nextAttemptAt: this.clock.now() + backoffMs(item.attempts),
        });
        return 'offline';
      }
      this.inflightId = null;
      const outcome = await this.handleResponse(item, res.status, res.body, res.headers);
      if (outcome !== 'next') return outcome;
    }
  }

  private async handleResponse(
    item: OutboxItem,
    status: number,
    body: unknown,
    headers: Headers,
  ): Promise<'next' | 'offline' | 'blocked'> {
    const db = this.db;
    const code = problemCode(body);
    // 2xx: サーバーの結果で手元を置き換え、同じ予定の後続の If-Match を新しい version にする
    if (status >= 200 && status < 300) {
      await db.transaction('rw', [db.events, db.outbox], async () => {
        await db.outbox.delete(item.id);
        const rest = await db.outbox.where('eventId').equals(item.eventId).sortBy('createdAt');
        const serverEvent = extractEvent(body);
        const version = serverEvent?.version ?? extractVersion(body);
        if (version !== null) {
          for (const r of rest)
            if (r.baseVersion !== null) await db.outbox.update(r.id, { baseVersion: version });
        }
        if (serverEvent) {
          if (rest.length === 0) {
            await db.events.put({ ...serverEvent, sync: 'synced' });
          } else {
            const local = await db.events.get(item.eventId);
            if (local)
              await db.events.put({ ...local, version: serverEvent.version, sync: 'pending' });
          }
        }
      });
      return 'next';
    }
    if (status === 409 && code === 'conflict') {
      const theirs = extractEvent(body);
      await db.transaction('rw', [db.events, db.outbox, db.conflicts], async () => {
        const all = await db.outbox.where('eventId').equals(item.eventId).toArray();
        await db.outbox.bulkDelete(all.map((o) => o.id));
        const mine = (await db.events.get(item.eventId)) ?? null;
        if (theirs) {
          const changes =
            item.kind === 'update' && mine && item.snapshot
              ? (diffChanges(item.snapshot, mine) as Record<string, unknown>)
              : null;
          const record: ConflictRecord = {
            eventId: item.eventId,
            mine: mine ? { ...mine, sync: 'conflict' } : null,
            theirs,
            changes,
            kind: item.kind,
            createdAt: this.clock.now(),
          };
          await db.conflicts.put(record);
          await db.events.put({ ...(mine ?? theirs), version: theirs.version, sync: 'conflict' });
        }
      });
      return 'next';
    }
    if (status === 404 || status === 410) {
      await db.transaction('rw', [db.events, db.outbox, db.conflicts], async () => {
        const all = await db.outbox.where('eventId').equals(item.eventId).toArray();
        await db.outbox.bulkDelete(all.map((o) => o.id));
        await db.events.delete(item.eventId);
        await db.conflicts.delete(item.eventId);
      });
      this.toast({ kind: 'info', message: 'この予定は削除されていました' });
      return 'next';
    }
    if (status === 401 || (status === 403 && code === 'not_member') || status === 426) {
      return this.blockFor(status, body) ?? 'blocked';
    }
    if (status === 429) {
      const retry = Number(headers.get('retry-after') ?? '60');
      await db.outbox.update(item.id, {
        nextAttemptAt: this.clock.now() + (Number.isFinite(retry) ? retry : 60) * 1000,
      });
      return 'offline';
    }
    if (status >= 500) {
      await db.outbox.update(item.id, {
        attempts: item.attempts + 1,
        nextAttemptAt: this.clock.now() + backoffMs(item.attempts),
      });
      return 'offline';
    }
    // 422・403 forbidden など、その予定だけの拒否: snapshot で手元を元に戻して知らせる
    await db.transaction('rw', [db.events, db.outbox], async () => {
      const all = await db.outbox.where('eventId').equals(item.eventId).toArray();
      await db.outbox.bulkDelete(all.map((o) => o.id));
      if (item.snapshot) await db.events.put(item.snapshot);
      else await db.events.delete(item.eventId);
    });
    const detail =
      typeof body === 'object' &&
      body !== null &&
      'detail' in body &&
      typeof (body as { detail: unknown }).detail === 'string'
        ? (body as { detail: string }).detail
        : null;
    this.toast({
      kind: 'error',
      message: detail ? `保存できませんでした（${detail}）` : '保存できませんでした',
    });
    return 'next';
  }

  /* ───────── 変更（まず手元に反映し、outbox に積む） ───────── */

  private async pendingFor(eventId: string): Promise<OutboxItem[]> {
    return (await this.db.outbox.where('eventId').equals(eventId).sortBy('createdAt')).filter(
      (o) => o.id !== this.inflightId,
    );
  }

  private newItem(
    fields: Omit<OutboxItem, 'id' | 'createdAt' | 'attempts' | 'nextAttemptAt'>,
  ): OutboxItem {
    const now = this.clock.now();
    return { ...fields, id: uuidv7(now), createdAt: now, attempts: 0, nextAttemptAt: 0 };
  }

  async createEvent(input: EventCreateInput): Promise<Result<LocalEvent>> {
    const parsed = eventCreateSchema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      };
    const meId = await this.meId();
    const now = this.clock.now();
    const id = parsed.data.id ?? uuidv7(now);
    const local = createLocally(parsed.data, id, meId, now);
    if ('errors' in local) return { ok: false, errors: local.errors };
    const event: LocalEvent = { ...local.value, sync: 'pending' };
    await this.db.transaction('rw', [this.db.events, this.db.outbox], async () => {
      await this.db.events.put(event);
      await this.db.outbox.add(
        this.newItem({
          eventId: id,
          kind: 'create',
          method: 'POST',
          path: '/api/events',
          body: dtoToCreateBody(event),
          baseVersion: null,
          snapshot: null,
        }),
      );
    });
    void this.syncNow();
    return { ok: true, value: event };
  }

  async updateEvent(eventId: string, changesInput: EventChangesInput): Promise<Result<LocalEvent>> {
    const parsed = eventChangesSchema.safeParse(changesInput);
    if (!parsed.success)
      return {
        ok: false,
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      };
    const meId = await this.meId();
    const db = this.db;
    let result: Result<LocalEvent> = {
      ok: false,
      errors: [{ field: 'id', message: '予定が見つかりません' }],
    };
    await db.transaction('rw', [db.events, db.outbox], async () => {
      const current = await db.events.get(eventId);
      if (!current) return;
      if (!canSeeContent(current, meId)) {
        result = {
          ok: false,
          errors: [{ field: 'id', message: 'ほかの家族の内緒の予定は変えられません' }],
        };
        return;
      }
      const applied = applyChangesLocally(current, parsed.data, meId, this.clock.now());
      if ('errors' in applied) {
        result = { ok: false, errors: applied.errors };
        return;
      }
      const next: LocalEvent = { ...applied.value, version: current.version, sync: 'pending' };
      const pending = await this.pendingFor(eventId);
      const last = pending[pending.length - 1];
      if (last?.kind === 'create') {
        // 作成＋更新 → 作成 1 件
        await db.outbox.update(last.id, { body: dtoToCreateBody(next) });
      } else if (last?.kind === 'update' && last.snapshot) {
        // 更新どうし → 1 件（最初の変更前の状態との差分）
        await db.outbox.update(last.id, {
          body: { scope: 'all', changes: diffChanges(last.snapshot, next) },
        });
      } else {
        await db.outbox.add(
          this.newItem({
            eventId,
            kind: 'update',
            method: 'PATCH',
            path: `/api/events/${eventId}`,
            body: { scope: 'all', changes: diffChanges(current, next) },
            baseVersion: current.version,
            snapshot: current,
          }),
        );
      }
      await db.events.put(next);
      result = { ok: true, value: next };
    });
    void this.syncNow();
    return result;
  }

  /**
   * 削除（ゴミ箱へ）。それより前の未送信の変更は捨てる。作成がまだ送られていなければ、作成も削除も送らない。
   * 戻り値の undo で「元に戻す」（§6.1）。
   */
  async deleteEvent(eventId: string): Promise<{ ok: boolean; undo: () => Promise<void> }> {
    const meId = await this.meId();
    const db = this.db;
    let undo: () => Promise<void> = async () => {};
    let ok = false;
    await db.transaction('rw', [db.events, db.outbox], async () => {
      const current = await db.events.get(eventId);
      if (!current || !canSeeContent(current, meId)) return;
      const pending = await this.pendingFor(eventId);
      const unsentCreate = pending.find((o) => o.kind === 'create');
      await db.outbox.bulkDelete(pending.map((o) => o.id));
      await db.events.delete(eventId);
      ok = true;
      if (unsentCreate) {
        undo = async () => {
          await this.createEvent(dtoToCreateBody(current));
        };
        return;
      }
      const serverState = pending.find((o) => o.snapshot)?.snapshot ?? current;
      const item = this.newItem({
        eventId,
        kind: 'delete',
        method: 'DELETE',
        path: `/api/events/${eventId}`,
        body: {},
        baseVersion: current.version,
        snapshot: { ...serverState, sync: 'synced' },
      });
      await db.outbox.add(item);
      undo = () => this.undoDelete(item, current);
    });
    void this.syncNow();
    return { ok, undo };
  }

  private async undoDelete(item: OutboxItem, before: LocalEvent): Promise<void> {
    const db = this.db;
    await db.transaction('rw', [db.events, db.outbox], async () => {
      const stillPending = (await db.outbox.get(item.id)) && item.id !== this.inflightId;
      if (stillPending) {
        await db.outbox.delete(item.id);
        const serverState = item.snapshot;
        if (serverState && JSON.stringify(diffChanges(serverState, before)) !== '{}') {
          await db.outbox.add(
            this.newItem({
              eventId: before.id,
              kind: 'update',
              method: 'PATCH',
              path: `/api/events/${before.id}`,
              body: { scope: 'all', changes: diffChanges(serverState, before) },
              baseVersion: serverState.version,
              snapshot: serverState,
            }),
          );
          await db.events.put({ ...before, sync: 'pending' });
        } else {
          await db.events.put(serverState ?? before);
        }
        return;
      }
      // もう送った削除は、復元を送る
      await db.outbox.add(
        this.newItem({
          eventId: before.id,
          kind: 'restore',
          method: 'POST',
          path: `/api/events/${before.id}/restore`,
          body: {},
          baseVersion: null,
          snapshot: null,
        }),
      );
      await db.events.put({ ...before, sync: 'pending' });
    });
    void this.syncNow();
  }

  /** ゴミ箱から復元（オンラインで） */
  async restoreEvent(eventId: string): Promise<boolean> {
    try {
      const res = await apiRequest('POST', `/api/events/${eventId}/restore`, {
        headers: { 'Idempotency-Key': uuidv7(this.clock.now()) },
        fetcher: this.fetcher,
      });
      if (res.status !== 200) return false;
      const e = extractEvent(res.body);
      if (e) await this.db.events.put({ ...e, sync: 'synced' });
      void this.syncNow();
      return true;
    } catch {
      return false;
    }
  }

  /* ───────── 競合の解決（C-05） ───────── */

  async resolveConflict(eventId: string, choice: 'theirs' | 'mine' | 'both'): Promise<void> {
    const db = this.db;
    const conflict = await db.conflicts.get(eventId);
    if (!conflict) return;
    const theirs: LocalEvent = { ...conflict.theirs, sync: 'synced' };
    await db.transaction('rw', [db.events, db.outbox, db.conflicts], async () => {
      await db.conflicts.delete(eventId);
      if (choice === 'theirs') {
        await db.events.put(theirs);
        return;
      }
      if (choice === 'mine') {
        if (conflict.kind === 'delete' || !conflict.mine) {
          await db.events.delete(eventId);
          await db.outbox.add(
            this.newItem({
              eventId,
              kind: 'delete',
              method: 'DELETE',
              path: `/api/events/${eventId}`,
              body: {},
              baseVersion: theirs.version,
              snapshot: theirs,
            }),
          );
          return;
        }
        const mine: LocalEvent = { ...conflict.mine, version: theirs.version, sync: 'pending' };
        await db.events.put(mine);
        await db.outbox.add(
          this.newItem({
            eventId,
            kind: 'update',
            method: 'PATCH',
            path: `/api/events/${eventId}`,
            body: { scope: 'all', changes: diffChanges(theirs, mine) },
            baseVersion: theirs.version,
            snapshot: theirs,
          }),
        );
        return;
      }
      // 両方残す: 家族の変更を採用し、自分の変更は新しい予定として作る
      await db.events.put(theirs);
      if (conflict.mine) {
        const copyId = uuidv7(this.clock.now());
        const copy: LocalEvent = { ...conflict.mine, id: copyId, version: 0, sync: 'pending' };
        await db.events.put(copy);
        await db.outbox.add(
          this.newItem({
            eventId: copyId,
            kind: 'create',
            method: 'POST',
            path: '/api/events',
            body: dtoToCreateBody(copy),
            baseVersion: null,
            snapshot: null,
          }),
        );
      }
    });
    void this.syncNow();
  }
}

function extractEvent(body: unknown): EventDTO | null {
  if (typeof body !== 'object' || body === null || !('event' in body)) return null;
  const parsed = eventDtoSchema.safeParse((body as { event: unknown }).event);
  return parsed.success ? parsed.data : null;
}

function extractVersion(body: unknown): number | null {
  if (typeof body === 'object' && body !== null && 'version' in body) {
    const v = (body as { version: unknown }).version;
    return typeof v === 'number' ? v : null;
  }
  return null;
}
