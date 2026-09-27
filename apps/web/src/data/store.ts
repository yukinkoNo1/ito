import {
  applyChangesLocally,
  type Clock,
  canSeeContent,
  createLocally,
  dtoToRecord,
  type EventChangesInput,
  type EventCreateInput,
  type EventDTO,
  eventChangesSchema,
  eventCreateSchema,
  eventDtoSchema,
  type FieldError,
  isSeriesOccurrence,
  type MeDTO,
  meDtoSchema,
  occurrenceFields,
  recordToDto,
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

const MAX_BACKOFF_MS = 60 * 60 * 1000;

/** 送信の再送の間隔（指数バックオフ。最大 1 時間。§12） */
export function backoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.min(attempts, 20), MAX_BACKOFF_MS);
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

export const CONFLICT_FIRST = '家族の変更とぶつかっています。先に「確認する」から解決してください';

/** push の結果: 送り切った / 通信エラー / 待ち（バックオフ・429・5xx）/ 止めた（401・403・426） */
type PushOutcome = 'ok' | 'network' | 'waiting' | 'blocked';

function isEmptyChanges(changes: object): boolean {
  return Object.keys(changes).length === 0;
}

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
  private againRetryNow = false;
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
   * retryNow: バックオフ中の送信待ちもすぐ送り直す（online イベント・前面復帰・再試行ボタン）。
   * 実行中に retryNow で呼ばれたら、次の回に持ち越す。
   */
  syncNow(opts: { retryNow?: boolean } = {}): Promise<void> {
    if (this.running) {
      this.again = true;
      this.againRetryNow ||= opts.retryNow ?? false;
      return this.running;
    }
    let retryNow = opts.retryNow ?? false;
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.cycle(retryNow);
          retryNow = this.againRetryNow;
          this.againRetryNow = false;
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async cycle(retryNow: boolean): Promise<void> {
    this.setState({ status: 'syncing' });
    if (retryNow) await this.resetBackoff('all');
    // 別の人としてつながっていたら、送信待ちを送る前に手元を消す
    if ((await this.db.outbox.count()) > 0) {
      const checked = await this.checkIdentity();
      if (checked === 'network') return this.setState({ status: 'offline' });
      if (checked === 'blocked') return;
    }
    const pushed = await this.push();
    if (pushed === 'network') return this.setState({ status: 'offline' });
    if (pushed === 'blocked') return;
    const pulled = await this.pull();
    if (pulled === 'network') return this.setState({ status: 'offline' });
    if (pulled === 'blocked') return;
    // つながったので、通信エラーで待っていた送信待ちはすぐ送り直す（429・5xx の待ちはそのまま）
    if (pushed === 'waiting' && (await this.resetBackoff('network')) > 0) {
      const again = await this.push();
      if (again === 'network') return this.setState({ status: 'offline' });
      if (again === 'blocked') return;
    }
    this.setState({ status: 'synced', lastSyncedAt: this.clock.now(), block: null });
  }

  private async resetBackoff(which: 'all' | 'network'): Promise<number> {
    // 429 の Retry-After の待ちは、再試行でも解かない（§12「429 は Retry-After に従う」）
    const collection =
      which === 'all'
        ? this.db.outbox.filter((o) => o.failure !== 'rate')
        : this.db.outbox.filter((o) => o.failure === 'network');
    return collection.modify({ nextAttemptAt: 0 });
  }

  private block(block: SyncBlock): 'blocked' {
    this.setState({ status: 'error', block });
    return 'blocked';
  }

  /** 手元の本人と、サーバーから見た本人が違えば手元を消す（前の本人の予定・送信待ちを残さない） */
  private async checkIdentity(): Promise<'ok' | 'network' | 'blocked'> {
    let res: Awaited<ReturnType<typeof apiRequest>>;
    try {
      res = await apiRequest('GET', '/api/me', { fetcher: this.fetcher });
    } catch (e) {
      if (e instanceof NetworkError) return 'network';
      throw e;
    }
    if (res.status !== 200) return this.blockFor(res.status, res.body) ?? 'network';
    const parsed = meDtoSchema.safeParse(res.body);
    if (!parsed.success) return this.block({ kind: 'server' });
    await this.forgetIfOtherPerson(parsed.data.id);
    return 'ok';
  }

  private async forgetIfOtherPerson(meId: string): Promise<boolean> {
    const stored = await this.me();
    if (!stored || stored.id === meId) return false;
    const db = this.db;
    await db.transaction('rw', [db.events, db.outbox, db.conflicts, db.meta], async () => {
      await db.events.clear();
      await db.outbox.clear();
      await db.conflicts.clear();
      await db.meta.clear();
    });
    return true;
  }

  /** 取得（GET /api/sync）。応答は zod で確かめてから手元に反映する */
  async pull(): Promise<'ok' | 'network' | 'blocked'> {
    const cursor = (await this.db.getMeta<number>('cursor')) ?? 0;
    let res: Awaited<ReturnType<typeof apiRequest>>;
    try {
      res = await apiRequest('GET', `/api/sync?cursor=${cursor}`, { fetcher: this.fetcher });
    } catch (e) {
      if (e instanceof NetworkError) return 'network';
      throw e;
    }
    if (res.status !== 200) return this.blockFor(res.status, res.body) ?? 'network';
    const parsed = syncResponseSchema.safeParse(res.body);
    if (!parsed.success) return this.block({ kind: 'server' });
    // 別の人の応答なら、手元を消して全件から取り直す（投影が人ごとに違うので差分は使えない）
    if (await this.forgetIfOtherPerson(parsed.data.me.id)) return this.pull();
    const data = parsed.data;
    const db = this.db;
    await db.transaction(
      'rw',
      [db.events, db.members, db.meta, db.outbox, db.conflicts],
      async () => {
        // 送信待ちの予定と、送信待ちの「この回だけ」の例外行は、取得で上書き・削除しない
        const pending = new Set(
          (await db.outbox.toArray()).flatMap((o) => {
            const ex = exceptionIdOf(o.body);
            return ex ? [o.eventId, ex] : [o.eventId];
          }),
        );
        const conflicts = new Map((await db.conflicts.toArray()).map((c) => [c.eventId, c]));
        const keep = (id: string) => pending.has(id) || conflicts.has(id);
        if (data.full) {
          const incoming = new Set(data.events.map((e) => e.id));
          const localIds = (await db.events.toCollection().primaryKeys()) as string[];
          await db.events.bulkDelete(localIds.filter((id) => !incoming.has(id) && !keep(id)));
          // 競合中の予定が全件に入っていなければ、家族が消した
          for (const [id, c] of conflicts) {
            if (!incoming.has(id)) await db.conflicts.put({ ...c, theirsDeleted: true });
          }
        }
        await db.events.bulkPut(
          data.events.filter((e) => !keep(e.id)).map((e) => ({ ...e, sync: 'synced' as const })),
        );
        await db.events.bulkDelete(data.deletedEventIds.filter((id) => !keep(id)));
        // 競合中の予定は、家族の側の最新を競合の記録に取り込む
        for (const e of data.events) {
          const c = conflicts.get(e.id);
          if (c) await db.conflicts.put({ ...c, theirs: e, theirsDeleted: false });
        }
        for (const id of data.deletedEventIds) {
          const c = conflicts.get(id);
          if (c) await db.conflicts.put({ ...c, theirsDeleted: true });
        }
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
    return null;
  }

  /** 送信（outbox を順に）。応答ごとの扱いは §12 の表のとおり */
  async push(): Promise<PushOutcome> {
    for (;;) {
      const item = await this.db.outbox.orderBy('createdAt').first();
      if (!item) return 'ok';
      // 待ちの途中なら止める。ただし端末の時計が戻って待ちが上限（1 時間）を超えていたら送る
      const wait = item.nextAttemptAt - this.clock.now();
      if (wait > 0 && wait <= MAX_BACKOFF_MS) return 'waiting';
      this.inflightId = item.id;
      try {
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
          if (!(e instanceof NetworkError)) throw e;
          await this.db.outbox.update(item.id, {
            attempts: item.attempts + 1,
            nextAttemptAt: this.clock.now() + backoffMs(item.attempts),
            failure: 'network',
          });
          return 'network';
        }
        const outcome = await this.handleResponse(item, res.status, res.body, res.headers);
        if (outcome !== 'next') return outcome;
      } finally {
        // 応答の処理が終わるまでは送信中として扱う（そのすきまの変更を送った項目に畳まない）
        this.inflightId = null;
      }
    }
  }

  private async handleResponse(
    item: OutboxItem,
    status: number,
    body: unknown,
    headers: Headers,
  ): Promise<'next' | 'waiting' | 'blocked'> {
    const db = this.db;
    const code = problemCode(body);
    // 2xx: サーバーの結果で手元を置き換え、同じ予定の後続の If-Match を新しい version にする
    if (status >= 200 && status < 300) {
      await db.transaction('rw', [db.events, db.outbox, db.conflicts], async () => {
        await db.outbox.delete(item.id);
        await db.conflicts.delete(item.eventId);
        const rest = await db.outbox.where('eventId').equals(item.eventId).sortBy('createdAt');
        const serverEvent = extractEvent(body);
        const version = serverEvent?.version ?? extractVersion(body);
        if (version !== null) {
          for (const r of rest) {
            if (r.baseVersion === null) continue;
            await db.outbox.update(r.id, {
              baseVersion: version,
              ...(r.snapshot ? { snapshot: { ...r.snapshot, version } } : {}),
            });
          }
        }
        // 繰り返しの回の変更: 例外行・新しいシリーズも手元に入れる（§11）
        for (const extra of extraEvents(body)) await db.events.put({ ...extra, sync: 'synced' });
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
          // 自分が変えた項目だけ（上書きのときにこれだけを送る）
          const firstSnapshot = all.find((o) => o.snapshot)?.snapshot ?? item.snapshot;
          const changes =
            mine && firstSnapshot
              ? (diffChanges(firstSnapshot, mine) as Record<string, unknown>)
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
        failure: 'rate',
      });
      return 'waiting';
    }
    if (status >= 500) {
      await db.outbox.update(item.id, {
        attempts: item.attempts + 1,
        nextAttemptAt: this.clock.now() + backoffMs(item.attempts),
        failure: 'server',
      });
      return 'waiting';
    }
    // 422・403 forbidden など、その予定だけの拒否: snapshot で手元を元に戻して知らせる
    await db.transaction('rw', [db.events, db.outbox, db.meta], async () => {
      const all = await db.outbox.where('eventId').equals(item.eventId).toArray();
      await db.outbox.bulkDelete(all.map((o) => o.id));
      // 送信待ちのあいだの取得でサーバーの版を捨てているので、次の取得を全件にして取り直す
      await db.setMeta('cursor', 0);
      if (item.snapshot) {
        await db.events.put({
          ...item.snapshot,
          version: item.baseVersion ?? item.snapshot.version,
          sync: 'synced',
        });
      } else {
        await db.events.delete(item.eventId);
      }
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

  private async itemsFor(eventId: string): Promise<OutboxItem[]> {
    return this.db.outbox.where('eventId').equals(eventId).sortBy('createdAt');
  }

  /**
   * 一度も送っていない項目か。送ったことのある項目（通信エラーのあとも残る）はサーバーが処理済みかもしれず、
   * 同じ Idempotency-Key の再送には保存済みの応答が返るので、畳んだり捨てたりしない。
   */
  private isUnsent(o: OutboxItem): boolean {
    return o.attempts === 0 && o.id !== this.inflightId;
  }

  /**
   * 送信待ちを作る（送信待ちのトランザクションの中で呼ぶ）。送る順番（createdAt）は、端末の時計が
   * 戻っても前の送信待ちより後ろにする（削除のあとの作成が先に送られないように）
   */
  private async newItem(
    fields: Omit<OutboxItem, 'id' | 'createdAt' | 'attempts' | 'nextAttemptAt'>,
  ): Promise<OutboxItem> {
    const now = this.clock.now();
    const last = await this.db.outbox.orderBy('createdAt').last();
    const createdAt = Math.max(now, (last?.createdAt ?? 0) + 1);
    return { ...fields, id: uuidv7(now), createdAt, attempts: 0, nextAttemptAt: 0 };
  }

  async createEvent(input: EventCreateInput): Promise<Result<LocalEvent>> {
    const parsed = eventCreateSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      };
    }
    const meId = await this.meId();
    const now = this.clock.now();
    const id = parsed.data.id ?? uuidv7(now);
    const local = createLocally(parsed.data, id, meId, now);
    if ('errors' in local) return { ok: false, errors: local.errors };
    const event: LocalEvent = { ...local.value, sync: 'pending' };
    await this.db.transaction('rw', [this.db.events, this.db.outbox], async () => {
      await this.db.events.put(event);
      await this.db.outbox.add(
        await this.newItem({
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

  /**
   * 変更（まず手元に当てて、送信待ちに積む）。中身が変わらなければ何も積まない。
   * 戻り値の undo で「元に戻す」（逆向きの変更を積む。まだ送っていなければ畳まれて消える）。
   */
  async updateEvent(
    eventId: string,
    changesInput: EventChangesInput,
  ): Promise<Result<LocalEvent> & { undo?: () => Promise<void> }> {
    const parsed = eventChangesSchema.safeParse(changesInput);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      };
    }
    const meId = await this.meId();
    const db = this.db;
    // トランザクションの中で書き換えるので、代入による型の絞り込みを避ける（as で宣言）
    let result = {
      ok: false,
      errors: [{ field: 'id', message: '予定が見つかりません' }],
    } as Result<LocalEvent>;
    let before = null as LocalEvent | null;
    let changed = false;
    await db.transaction('rw', [db.events, db.outbox, db.conflicts, db.meta], async () => {
      const current = await db.events.get(eventId);
      if (!current) return;
      if (!canSeeContent(current, meId)) {
        result = {
          ok: false,
          errors: [{ field: 'id', message: 'ほかの家族の内緒の予定は変えられません' }],
        };
        return;
      }
      // 競合中の予定は、C-05 で解決するまで変えない（自分の変更が黙って消えないように）
      if (await db.conflicts.get(eventId)) {
        result = { ok: false, errors: [{ field: 'id', message: CONFLICT_FIRST }] };
        return;
      }
      const applied = applyChangesLocally(current, parsed.data, meId, this.clock.now());
      if ('errors' in applied) {
        result = { ok: false, errors: applied.errors };
        return;
      }
      const next: LocalEvent = { ...applied.value, version: current.version, sync: 'pending' };
      const own = diffChanges(current, next);
      if (isEmptyChanges(own)) {
        result = { ok: true, value: current };
        return;
      }
      before = current;
      changed = true;
      const items = await this.itemsFor(eventId);
      const tail = items[items.length - 1];
      const last = tail && this.isUnsent(tail) ? tail : undefined;
      if (last?.kind === 'create') {
        // 作成＋更新 → 作成 1 件
        await db.outbox.update(last.id, { body: dtoToCreateBody(next) });
      } else if (last?.kind === 'update' && last.snapshot) {
        // 更新どうし → 1 件（最初の変更前の状態との差分）。差分がなくなれば送信待ちも消す
        const merged = diffChanges(last.snapshot, next);
        if (isEmptyChanges(merged)) {
          await db.outbox.delete(last.id);
          // 送らずに戻したので、次の取得を全件にしてサーバーの版を取り直す
          await db.setMeta('cursor', 0);
          const others = items.length > 1;
          await db.events.put({
            ...last.snapshot,
            version: current.version,
            sync: others ? 'pending' : 'synced',
          });
          result = { ok: true, value: last.snapshot };
          return;
        }
        await db.outbox.update(last.id, { body: { scope: 'all', changes: merged } });
      } else {
        await db.outbox.add(
          await this.newItem({
            eventId,
            kind: 'update',
            method: 'PATCH',
            path: `/api/events/${eventId}`,
            body: { scope: 'all', changes: own },
            baseVersion: current.version,
            snapshot: current,
          }),
        );
      }
      await db.events.put(next);
      result = { ok: true, value: next };
    });
    if (changed) void this.syncNow();
    const snapshot = before;
    if (!result.ok || !snapshot) return result;
    const after = result.value;
    return {
      ...result,
      undo: async () => {
        await this.updateEvent(eventId, diffChanges(after, snapshot));
      },
    };
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
    await db.transaction('rw', [db.events, db.outbox, db.conflicts], async () => {
      const current = await db.events.get(eventId);
      if (!current || !canSeeContent(current, meId)) return;
      // 競合中の予定は、C-05 で解決するまで消さない
      if (await db.conflicts.get(eventId)) return;
      const pending = (await this.itemsFor(eventId)).filter((o) => this.isUnsent(o));
      const unsentCreate = pending.find((o) => o.kind === 'create');
      await db.outbox.bulkDelete(pending.map((o) => o.id));
      await db.events.delete(eventId);
      await db.conflicts.delete(eventId);
      ok = true;
      if (unsentCreate) {
        undo = async () => {
          await this.createEvent(dtoToCreateBody(current));
        };
        return;
      }
      const serverState = pending.find((o) => o.snapshot)?.snapshot ?? current;
      const item = await this.newItem({
        eventId,
        kind: 'delete',
        method: 'DELETE',
        path: `/api/events/${eventId}`,
        body: {},
        baseVersion: current.version,
        snapshot: { ...serverState, version: current.version, sync: 'synced' },
      });
      await db.outbox.add(item);
      undo = () => this.undoDelete(item, current);
    });
    void this.syncNow();
    return { ok, undo };
  }

  private async undoDelete(item: OutboxItem, before: LocalEvent): Promise<void> {
    const db = this.db;
    await db.transaction('rw', [db.events, db.outbox, db.meta], async () => {
      const stored = await db.outbox.get(item.id);
      const stillPending = stored !== undefined && this.isUnsent(stored);
      if (stillPending) {
        await db.outbox.delete(item.id);
        // 送らずに取り消したので、次の取得を全件にしてサーバーの版を取り直す
        await db.setMeta('cursor', 0);
        // 書き換え済みの If-Match を古い版に戻さないように、保存されている値を使う
        const serverState = stored.snapshot
          ? { ...stored.snapshot, version: stored.baseVersion ?? stored.snapshot.version }
          : null;
        const changes = serverState ? diffChanges(serverState, before) : {};
        if (serverState && !isEmptyChanges(changes)) {
          await db.outbox.add(
            await this.newItem({
              eventId: before.id,
              kind: 'update',
              method: 'PATCH',
              path: `/api/events/${before.id}`,
              body: { scope: 'all', changes },
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
      // もう送った（かもしれない）削除は、復元を送る
      await db.outbox.add(
        await this.newItem({
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

  /* ───────── 繰り返しの回（§11） ───────── */

  /**
   * 繰り返しの回の変更。this＝この回だけ（手元に例外行を作って送信待ちに積む。オフラインでもよい）、
   * following・all＝これ以降・すべて（C-04 でオンラインのときだけ選べる。手元には送信中の印だけ付け、送れたら取り直す）
   */
  async updateOccurrence(
    eventId: string,
    recurrenceId: string,
    scope: 'this' | 'following' | 'all',
    changesInput: EventChangesInput,
  ): Promise<Result<LocalEvent> & { undo?: () => Promise<void> }> {
    const parsed = eventChangesSchema.safeParse(changesInput);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      };
    }
    const meId = await this.meId();
    const db = this.db;
    let result = {
      ok: false,
      errors: [{ field: 'id', message: '予定が見つかりません' }],
    } as Result<LocalEvent>;
    let undoChanges = null as EventChangesInput | null;
    await db.transaction('rw', [db.events, db.outbox, db.conflicts], async () => {
      const master = await db.events.get(eventId);
      if (!master) return;
      if (!canSeeContent(master, meId)) {
        result = {
          ok: false,
          errors: [{ field: 'id', message: 'ほかの家族の内緒の予定は変えられません' }],
        };
        return;
      }
      if (await db.conflicts.get(eventId)) {
        result = { ok: false, errors: [{ field: 'id', message: CONFLICT_FIRST }] };
        return;
      }
      if (scope !== 'this') {
        await db.outbox.add(
          await this.newItem({
            eventId,
            kind: 'update',
            method: 'PATCH',
            path: `/api/events/${eventId}`,
            body: { scope, recurrenceId, changes: parsed.data },
            baseVersion: master.version,
            snapshot: master,
          }),
        );
        await db.events.put({ ...master, sync: 'pending' });
        result = { ok: true, value: master };
        return;
      }
      const existing = (await db.events.where('parentId').equals(eventId).toArray()).find(
        (e) => e.recurrenceId === recurrenceId,
      );
      const base = existing ?? occurrenceBase(master, recurrenceId, uuidv7(this.clock.now()));
      if (!base) {
        result = {
          ok: false,
          errors: [{ field: 'recurrenceId', message: 'この回は見つかりません' }],
        };
        return;
      }
      const applied = applyChangesLocally(base, parsed.data, meId, this.clock.now());
      if ('errors' in applied) {
        result = { ok: false, errors: applied.errors };
        return;
      }
      const next: LocalEvent = {
        ...applied.value,
        id: base.id,
        version: base.version,
        rrule: null,
        exdates: [],
        parentId: eventId,
        recurrenceId,
        ownerId: master.ownerId,
        visibility: master.visibility,
        sync: 'pending',
      };
      const own = diffChanges(base, next);
      if (isEmptyChanges(own)) {
        result = { ok: true, value: base };
        return;
      }
      undoChanges = diffChanges(next, base);
      await db.outbox.add(
        await this.newItem({
          eventId,
          kind: 'update',
          method: 'PATCH',
          path: `/api/events/${eventId}`,
          body: { scope: 'this', recurrenceId, exceptionId: base.id, changes: own },
          baseVersion: master.version,
          snapshot: master,
        }),
      );
      await db.events.put(next);
      result = { ok: true, value: next };
    });
    void this.syncNow();
    const back = undoChanges;
    if (!result.ok || !back) return result;
    return {
      ...result,
      undo: async () => {
        await this.updateOccurrence(eventId, recurrenceId, 'this', back);
      },
    };
  }

  /**
   * 繰り返しの回の削除。this＝この回だけ（親の exdates。オフラインでもよい。元に戻せる）、
   * following＝これ以降（元に戻せない。C-04 で確かめる）、all＝シリーズごとゴミ箱（元に戻せる）
   */
  async deleteOccurrence(
    eventId: string,
    recurrenceId: string,
    scope: 'this' | 'following' | 'all',
  ): Promise<{ ok: boolean; undo: (() => Promise<void>) | null }> {
    if (scope === 'all') return this.deleteEvent(eventId);
    const meId = await this.meId();
    const db = this.db;
    let ok = false;
    let undo: (() => Promise<void>) | null = null;
    await db.transaction('rw', [db.events, db.outbox, db.conflicts], async () => {
      const master = await db.events.get(eventId);
      if (!master || !canSeeContent(master, meId)) return;
      if (await db.conflicts.get(eventId)) return;
      const path = `/api/events/${eventId}?scope=${scope}&recurrenceId=${encodeURIComponent(recurrenceId)}`;
      const item = await this.newItem({
        eventId,
        kind: 'delete',
        method: 'DELETE',
        path,
        body: {},
        baseVersion: master.version,
        snapshot: master,
      });
      await db.outbox.add(item);
      ok = true;
      if (scope === 'following') {
        await db.events.put({ ...master, sync: 'pending' });
        return;
      }
      const exception = (await db.events.where('parentId').equals(eventId).toArray()).find(
        (e) => e.recurrenceId === recurrenceId,
      );
      if (exception) await db.events.delete(exception.id);
      await db.events.put({
        ...master,
        exdates: [...new Set([...master.exdates, recurrenceId])].sort(),
        sync: 'pending',
      });
      undo = () => this.undoDeleteOccurrence(item, master, exception ?? null, recurrenceId);
    });
    void this.syncNow();
    return { ok, undo };
  }

  private async undoDeleteOccurrence(
    item: OutboxItem,
    master: LocalEvent,
    exception: LocalEvent | null,
    recurrenceId: string,
  ): Promise<void> {
    const db = this.db;
    await db.transaction('rw', [db.events, db.outbox, db.meta], async () => {
      const stored = await db.outbox.get(item.id);
      if (stored && this.isUnsent(stored)) {
        // まだ送っていなければ、送信待ちを消して手元を戻す
        await db.outbox.delete(item.id);
        await db.setMeta('cursor', 0);
        const now = await db.events.get(master.id);
        if (now) {
          await db.events.put({
            ...now,
            exdates: now.exdates.filter((d) => d !== recurrenceId),
            sync: (await this.itemsFor(master.id)).length > 0 ? 'pending' : 'synced',
          });
        }
        if (exception) await db.events.put(exception);
        return;
      }
      // 送ったあとなら、その回の復元を送る
      await db.outbox.add(
        await this.newItem({
          eventId: master.id,
          kind: 'restore',
          method: 'POST',
          path: `/api/events/${master.id}/restore?recurrenceId=${encodeURIComponent(recurrenceId)}`,
          body: {},
          baseVersion: null,
          snapshot: null,
        }),
      );
      const now = await db.events.get(master.id);
      if (now) {
        await db.events.put({
          ...now,
          exdates: now.exdates.filter((d) => d !== recurrenceId),
          sync: 'pending',
        });
      }
      if (exception) await db.events.put({ ...exception, sync: 'pending' });
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
    await db.transaction('rw', [db.events, db.outbox, db.conflicts], async () => {
      // 取得が取り込んだ最新の theirs を使うため、トランザクションの中で読む
      const conflict = await db.conflicts.get(eventId);
      if (!conflict) return;
      const theirs: LocalEvent = { ...conflict.theirs, sync: 'synced' };
      await db.conflicts.delete(eventId);
      // 家族が消していたら、「家族の変更を採用」は消す、ほかは自分の予定を新しく作る
      if (conflict.theirsDeleted) {
        await db.events.delete(eventId);
        if (choice !== 'theirs' && conflict.mine) await this.enqueueCopy(conflict.mine);
        return;
      }
      if (choice === 'theirs') {
        await db.events.put(theirs);
        return;
      }
      if (choice === 'mine') {
        if (conflict.kind === 'delete' || !conflict.mine) {
          await db.events.delete(eventId);
          await db.outbox.add(
            await this.newItem({
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
        // C-05 で見せた自分の版をそのまま採る（上書き）
        const mine: LocalEvent = { ...conflict.mine, version: theirs.version, sync: 'pending' };
        await db.events.put(mine);
        await db.outbox.add(
          await this.newItem({
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
      if (conflict.mine) await this.enqueueCopy(conflict.mine);
    });
    void this.syncNow();
  }

  private async enqueueCopy(mine: LocalEvent): Promise<void> {
    const copyId = uuidv7(this.clock.now());
    const copy: LocalEvent = { ...mine, id: copyId, version: 0, sync: 'pending' };
    await this.db.events.put(copy);
    await this.db.outbox.add(
      await this.newItem({
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
}

/** 「この回だけ」の送信待ちの例外行の ID */
function exceptionIdOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('exceptionId' in body)) return null;
  const v = (body as { exceptionId: unknown }).exceptionId;
  return typeof v === 'string' ? v : null;
}

/** 応答の例外行・新しいシリーズ（§11） */
function extraEvents(body: unknown): EventDTO[] {
  if (typeof body !== 'object' || body === null) return [];
  const out: EventDTO[] = [];
  for (const key of ['exception', 'created'] as const) {
    if (!(key in body)) continue;
    const parsed = eventDtoSchema.safeParse((body as Record<string, unknown>)[key]);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** その回の元の日時に置いた親の中身（例外行を手元で作るときの元。サーバーと同じ core の計算） */
function occurrenceBase(master: LocalEvent, recurrenceId: string, id: string): LocalEvent | null {
  const record = dtoToRecord(master);
  if (!isSeriesOccurrence(record, recurrenceId)) return null;
  const times = occurrenceFields(record, recurrenceId);
  if (!times) return null;
  const dto = recordToDto({
    ...record,
    ...times,
    rrule: null,
    exdates: [],
    parentId: master.id,
    recurrenceId,
  });
  return { ...dto, id, version: 0, sync: 'pending' };
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
