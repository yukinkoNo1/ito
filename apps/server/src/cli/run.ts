import { type Clock, toIsoJst } from '@ito/core';
import type { Database_ } from '../db/client';
import {
  createFeedToken,
  FeedTokenLimitError,
  listFeedTokens,
  revokeFeedToken,
} from '../services/feed-tokens';
import { listActiveMembers } from '../services/members';

const HELP = `いと の管理用 CLI（動いているサーバーと同じ DB に書く。DATABASE_PATH を使う）

使い方:
  node dist/cli.js feed-token create --name <名前>   連携キーを発行する（キーはこの 1 回だけ表示）
  node dist/cli.js feed-token list                   連携キーの一覧（キーそのものは出さない）
  node dist/cli.js feed-token revoke <id>            連携キーを止める（次の要求から 401）
  node dist/cli.js --help                            この説明を出す
`;

function when(ms: number | null): string {
  return ms === null ? '-' : toIsoJst(ms).slice(0, 16).replace('T', ' ');
}

export interface CliIo {
  out: (s: string) => void;
  err: (s: string) => void;
}

export async function runCli(
  argv: string[],
  io: CliIo,
  open: () => Database_,
  clock: Clock,
): Promise<number> {
  const [cmd, sub, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    io.out(HELP);
    return 0;
  }
  if (cmd !== 'feed-token' || !sub) {
    io.err(HELP);
    return 2;
  }
  const database = open();
  try {
    if (sub === 'create') {
      const i = rest.indexOf('--name');
      const name = i >= 0 ? (rest[i + 1] ?? '').trim() : '';
      if (!name || name.length > 50) {
        io.err('--name <名前>（1〜50 文字）を指定してください\n');
        return 2;
      }
      try {
        const { row, token } = createFeedToken(database.db, clock, name);
        const members = listActiveMembers(database.db);
        io.out(
          [
            `連携キーを発行しました（id: ${row.id}、名前: ${row.name}）。`,
            'キーはこの 1 回だけ表示します。いえボードの config/secrets.yaml に書いてください:',
            '',
            `  ${token}`,
            '',
            '家族（いえボードのメンバーと名前で対応させる。名前が違う人はいえボード側に対応を書く）:',
            ...members.map((m) => `  ${m.mark}  ${m.name}`),
            '',
          ].join('\n'),
        );
        return 0;
      } catch (e) {
        if (e instanceof FeedTokenLimitError) {
          io.err(`${e.message}\n`);
          return 1;
        }
        throw e;
      }
    }
    if (sub === 'list') {
      const rows = listFeedTokens(database.db);
      if (rows.length === 0) {
        io.out('連携キーはありません\n');
        return 0;
      }
      const lines = rows.map((r) =>
        [
          r.id,
          r.name,
          `作成 ${when(r.createdAt)}`,
          `最終利用 ${when(r.lastUsedAt)}`,
          r.lastUserDeviceAt !== null
            ? `人の端末から使われた ${when(r.lastUserDeviceAt)}`
            : '人の端末から使われていない',
          r.revokedAt !== null ? `止めた ${when(r.revokedAt)}` : '有効',
        ].join('  '),
      );
      io.out(`${lines.join('\n')}\n`);
      return 0;
    }
    if (sub === 'revoke') {
      const id = rest[0];
      if (!id) {
        io.err('revoke <id> の id を指定してください\n');
        return 2;
      }
      const row = revokeFeedToken(database.db, clock, id);
      if (!row) {
        io.err('その id の連携キーはありません\n');
        return 1;
      }
      io.out(`止めました（id: ${row.id}、名前: ${row.name}）。次の要求から 401 になります\n`);
      return 0;
    }
    io.err(HELP);
    return 2;
  } finally {
    database.close();
  }
}
