import { z } from 'zod';

z.config({ jitless: true });

const HELP = `いと の管理用 CLI

使い方:
  node dist/cli.js feed-token create --name <名前>   連携キーを発行する（キーはこの 1 回だけ表示）
  node dist/cli.js feed-token list                   連携キーの一覧（キーそのものは出さない）
  node dist/cli.js feed-token revoke <id>            連携キーを止める
  node dist/cli.js --help                            この説明を出す
`;

export async function runCli(argv: string[], out: (s: string) => void): Promise<number> {
  const [cmd] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    out(HELP);
    return 0;
  }
  out(HELP);
  return 2;
}

runCli(process.argv.slice(2), (s) => process.stdout.write(s)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
