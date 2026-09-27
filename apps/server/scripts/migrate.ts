// 開発用: DATABASE_PATH の DB にマイグレーションを適用する（本番は起動時に自動で適用する）
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, runMigrations } from '../src/db/client';

const dbPath = process.env.DATABASE_PATH;
if (!dbPath) {
  process.stderr.write('DATABASE_PATH を設定してください\n');
  process.exit(1);
}
mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
const database = openDatabase(dbPath);
try {
  runMigrations(database.db, fileURLToPath(new URL('../drizzle', import.meta.url)));
  process.stdout.write('migrated\n');
} finally {
  database.close();
}
