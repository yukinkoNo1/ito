// 開発用シード: 家族 4 人（お父さん・お母さん・はると・さき。ログインは *@example.com）
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemClock } from '@ito/core';
import { openDatabase, runMigrations } from '../src/db/client';
import { seedFamily } from '../src/dev/seed';

const dbPath = process.env.DATABASE_PATH;
if (!dbPath) {
  process.stderr.write('DATABASE_PATH を設定してください\n');
  process.exit(1);
}
mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
const database = openDatabase(dbPath);
try {
  runMigrations(database.db, fileURLToPath(new URL('../drizzle', import.meta.url)));
  const result = seedFamily(database.db, systemClock);
  process.stdout.write(`seeded: members +${result.members}\n`);
} finally {
  database.close();
}
