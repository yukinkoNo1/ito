import { fakeClock, fromJst } from '@ito/core';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/run';
import { type Database_, openDatabase, runMigrations } from '../src/db/client';
import { feedTokens, members } from '../src/db/schema';
import { MIGRATIONS_DIR } from './helpers';

function memoryDb(): Database_ {
  const database = openDatabase(':memory:');
  runMigrations(database.db, MIGRATIONS_DIR);
  return database;
}

/** runCli は終わると DB を閉じるので、閉じない包みで渡す */
function keepOpen(database: Database_): () => Database_ {
  return () => ({ ...database, close: () => {} });
}

async function run(database: Database_, argv: string[]) {
  let out = '';
  let err = '';
  const code = await runCli(
    argv,
    { out: (s) => (out += s), err: (s) => (err += s) },
    keepOpen(database),
    fakeClock(fromJst('2026-09-29', '07:30')),
  );
  return { code, out, err };
}

describe('CLI（§13.1・§20 の運用）', () => {
  it('--help', async () => {
    const database = memoryDb();
    const r = await run(database, ['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('feed-token create');
  });

  it('create はキーを 1 回だけ表示し、メンバーの一覧（名前・略称）も出す。DB にはハッシュだけ', async () => {
    const database = memoryDb();
    database.db
      .insert(members)
      .values({
        id: '0192f5a0-1c00-7000-8000-000000000001',
        login: 'papa@example.com',
        name: 'お父さん',
        mark: '父',
        color: 'kaki',
        aliases: '[]',
        role: 'admin',
        settings: '{}',
        activityReadAt: 0,
        createdAt: 1,
        updatedAt: 1,
        disabledAt: null,
      })
      .run();
    const r = await run(database, ['feed-token', 'create', '--name', 'いえボード']);
    expect(r.code).toBe(0);
    const keys = r.out.match(/ito_feed_[A-Za-z0-9_-]{43}/g) ?? [];
    expect(keys).toHaveLength(1);
    expect(r.out).toContain('父  お父さん');
    const dump = JSON.stringify(database.db.select().from(feedTokens).all());
    expect(dump).not.toContain(keys[0] as string);

    const list = await run(database, ['feed-token', 'list']);
    expect(list.code).toBe(0);
    expect(list.out).toContain('いえボード');
    expect(list.out).toContain('人の端末から使われていない');
    expect(list.out).toContain('有効');
    expect(list.out).not.toMatch(/ito_feed_/);
  });

  it('revoke で止める。知らない id は 1、名前なしの create は 2', async () => {
    const database = memoryDb();
    await run(database, ['feed-token', 'create', '--name', 'a']);
    const id = database.db.select().from(feedTokens).all()[0]?.id as string;
    const r = await run(database, ['feed-token', 'revoke', id]);
    expect(r.code).toBe(0);
    expect(database.db.select().from(feedTokens).all()[0]?.revokedAt).not.toBeNull();
    expect((await run(database, ['feed-token', 'list'])).out).toContain('止めた');
    expect((await run(database, ['feed-token', 'revoke', 'nothing'])).code).toBe(1);
    expect((await run(database, ['feed-token', 'create'])).code).toBe(2);
  });

  it('有効なキーは 5 つまで（止めれば作れる）', async () => {
    const database = memoryDb();
    for (let i = 0; i < 5; i++)
      expect((await run(database, ['feed-token', 'create', '--name', `k${i}`])).code).toBe(0);
    const sixth = await run(database, ['feed-token', 'create', '--name', 'k5']);
    expect(sixth.code).toBe(1);
    expect(sixth.err).toContain('5 つまで');
    const first = database.db.select().from(feedTokens).all()[0]?.id as string;
    await run(database, ['feed-token', 'revoke', first]);
    expect((await run(database, ['feed-token', 'create', '--name', 'k5'])).code).toBe(0);
  });
});
