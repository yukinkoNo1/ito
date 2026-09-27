import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
/** Db とトランザクションの両方を受け取る型（サービスの関数はこれを受け取る） */
export type DbLike = BaseSQLiteDatabase<'sync', Database.RunResult, typeof schema>;

export interface Database_ {
  sqlite: Database.Database;
  db: Db;
  close(): void;
}

/** SQLite を開く（WAL・busy_timeout。CLI と動いているサーバーが同じ DB に書けるように。SPEC §20） */
export function openDatabase(path: string): Database_ {
  const sqlite = new Database(path);
  if (path !== ':memory:') sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });
  let closed = false;
  return {
    sqlite,
    db,
    close() {
      if (closed) return;
      closed = true;
      sqlite.close();
    },
  };
}

export function runMigrations(db: Db, migrationsFolder: string): void {
  migrate(db, { migrationsFolder });
}
