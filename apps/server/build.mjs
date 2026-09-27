// サーバーと CLI をそれぞれ 1 ファイルにバンドルする（@ito/core を含む。外部に残すのは better-sqlite3 だけ。SPEC §20）
import { rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm(new URL('./dist', import.meta.url), { recursive: true, force: true });

const banner = [
  "import { createRequire as __itoCreateRequire } from 'node:module';",
  "import { fileURLToPath as __itoFileURLToPath } from 'node:url';",
  "import { dirname as __itoDirname } from 'node:path';",
  'const require = __itoCreateRequire(import.meta.url);',
  'const __filename = __itoFileURLToPath(import.meta.url);',
  'const __dirname = __itoDirname(__filename);',
].join('\n');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['better-sqlite3'],
  banner: { js: banner },
  legalComments: 'none',
  logLevel: 'warning',
  absWorkingDir: new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
};

await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/server.js' });
await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js' });
