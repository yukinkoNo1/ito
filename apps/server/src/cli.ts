import './zod-setup';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemClock } from '@ito/core';
import { runCli } from './cli/run';
import { openDatabase, runMigrations } from './db/client';

// 入口（src/cli.ts → dist/cli.js）。中身は cli/run.ts（テストから呼べるように分けている）
const here = path.dirname(fileURLToPath(import.meta.url));
const open = () => {
  const dbPath = process.env.DATABASE_PATH || '/data/ito.db';
  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const database = openDatabase(dbPath);
  runMigrations(database.db, path.resolve(here, '../drizzle'));
  return database;
};

runCli(
  process.argv.slice(2),
  { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
  open,
  systemClock,
).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}
`);
    process.exit(1);
  },
);
