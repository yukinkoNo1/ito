import type { EventDTO, MeDTO, MemberDTO } from '@ito/core';
import Dexie, { type Table } from 'dexie';

/** 手元の予定（サーバーの投影済みの写し＋送信の状態。§12） */
export interface LocalEvent extends EventDTO {
  sync: 'synced' | 'pending' | 'conflict';
}

export type OutboxKind = 'create' | 'update' | 'delete' | 'restore';

/** 送信待ち（§12: { id, eventId, method, path, body, baseVersion, snapshot, createdAt, attempts }） */
export interface OutboxItem {
  id: string;
  eventId: string;
  kind: OutboxKind;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body: unknown;
  baseVersion: number | null;
  /** 変更前の状態（元に戻すときに使う。作成は null） */
  snapshot: LocalEvent | null;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
}

/** 競合（C-05 で解決する） */
export interface ConflictRecord {
  eventId: string;
  /** 自分の変更（送ろうとした状態。削除なら null） */
  mine: LocalEvent | null;
  /** サーバーの最新（409 の本文。投影済み） */
  theirs: EventDTO;
  /** 自分の変更の中身（上書きするときに送り直す） */
  changes: Record<string, unknown> | null;
  kind: OutboxKind;
  createdAt: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export class ItoDb extends Dexie {
  events!: Table<LocalEvent, string>;
  members!: Table<MemberDTO, string>;
  outbox!: Table<OutboxItem, string>;
  conflicts!: Table<ConflictRecord, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'ito') {
    super(name);
    this.version(1).stores({
      events: 'id, parentId, updatedAt',
      members: 'id',
      outbox: 'id, eventId, createdAt',
      conflicts: 'eventId',
      meta: 'key',
    });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }
}

export type MetaKeys = {
  cursor: number;
  me: MeDTO;
  unreadActivity: number;
  lastSyncedAt: number;
};
