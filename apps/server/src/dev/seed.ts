import { type Clock, type MemberColor, uuidv7 } from '@ito/core';
import type { Db } from '../db/client';
import { members } from '../db/schema';
import { findMemberByLogin } from '../services/members';

export const DEV_FAMILY: {
  login: string;
  name: string;
  mark: string;
  color: MemberColor;
  role: 'admin' | 'member';
  aliases: string[];
}[] = [
  {
    login: 'papa@example.com',
    name: 'お父さん',
    mark: '父',
    color: 'kaki',
    role: 'admin',
    aliases: ['父', 'パパ'],
  },
  {
    login: 'mama@example.com',
    name: 'お母さん',
    mark: '母',
    color: 'wakatake',
    role: 'member',
    aliases: ['母', 'ママ'],
  },
  {
    login: 'haruto@example.com',
    name: 'はると',
    mark: 'は',
    color: 'asagi',
    role: 'member',
    aliases: ['ハル'],
  },
  {
    login: 'saki@example.com',
    name: 'さき',
    mark: 'さ',
    color: 'momo',
    role: 'member',
    aliases: [],
  },
];

/** 開発用の家族 4 人を入れる（もういるログインは飛ばす） */
export function seedFamily(db: Db, clock: Clock): { members: number } {
  let added = 0;
  db.transaction((tx) => {
    for (const [i, m] of DEV_FAMILY.entries()) {
      if (findMemberByLogin(tx, m.login)) continue;
      const now = clock.now() + i;
      tx.insert(members)
        .values({
          id: uuidv7(now),
          login: m.login,
          name: m.name,
          mark: m.mark,
          color: m.color,
          aliases: JSON.stringify(m.aliases),
          role: m.role,
          settings: '{}',
          activityReadAt: 0,
          createdAt: now,
          updatedAt: now,
          disabledAt: null,
        })
        .run();
      added++;
    }
  });
  return { members: added };
}
