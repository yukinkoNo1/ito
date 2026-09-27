import { fromJst } from '@ito/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { as, IDS, seedFamily } from './family';
import { createTestContext, devEnv, send, type TestContext } from './helpers';

let ctx: TestContext;
beforeEach(() => {
  ctx = createTestContext(devEnv({ MAX_MEMBERS: '6' }), { now: fromJst('2026-09-27', '14:18') });
  seedFamily(ctx);
});
afterEach(() => ctx.close());

const newMember = (extra: Record<string, unknown> = {}) => ({
  login: 'Grandma@Example.com',
  name: 'おばあちゃん',
  mark: 'ば',
  color: 'ruri',
  ...extra,
});

describe('家族の管理（§13・§14）', () => {
  it('管理者は追加でき、ログインは小文字化。管理者でなければ 403', async () => {
    const res = await send(ctx, 'POST', '/api/members', { headers: as('papa'), body: newMember() });
    expect(res.status).toBe(201);
    const { member } = (await res.json()) as { member: { login: string; role: string } };
    expect(member).toMatchObject({ login: 'grandma@example.com', role: 'member' });
    const denied = await send(ctx, 'POST', '/api/members', {
      headers: as('mama'),
      body: newMember({ login: 'x@example.com', name: 'x', color: 'yamabuki' }),
    });
    expect(denied.status).toBe(403);
  });

  it('ログインは管理者にだけ返す', async () => {
    const adminView = (await (
      await send(ctx, 'GET', '/api/members', { headers: as('papa') })
    ).json()) as {
      members: { login?: string }[];
    };
    expect(adminView.members[0]?.login).toBe('papa@example.com');
    const memberView = await send(ctx, 'GET', '/api/members', { headers: as('mama') });
    expect(await memberView.text()).not.toContain('@example.com');
  });

  it('名前の重複は NFC・前後の空白除去のあとで比べて拒否（追加・変更・再有効化・/api/me）', async () => {
    // 「お母さん」を分解した形＋空白
    const decomposed = ' お母さん'.normalize('NFD');
    const add = await send(ctx, 'POST', '/api/members', {
      headers: as('papa'),
      body: newMember({ name: decomposed }),
    });
    expect(add.status).toBe(409);
    expect(((await add.json()) as { code: string }).code).toBe('name_taken');

    const rename = await send(ctx, 'PATCH', `/api/members/${IDS.haru}`, {
      headers: as('papa'),
      body: { name: 'ゆき ' },
    });
    expect(rename.status).toBe(409);

    const me = await send(ctx, 'PATCH', '/api/me', {
      headers: as('haru'),
      body: { name: 'お父さん' },
    });
    expect(me.status).toBe(409);

    // 無効化した人の名前は使える。再有効化するときにぶつかれば拒否
    expect(
      (
        await send(ctx, 'PATCH', `/api/members/${IDS.haru}`, {
          headers: as('papa'),
          body: { disabled: true },
        })
      ).status,
    ).toBe(200);
    const reuse = await send(ctx, 'POST', '/api/members', {
      headers: as('papa'),
      body: newMember({ name: 'はる', color: 'asagi' }),
    });
    expect(reuse.status).toBe(201);
    const reenable = await send(ctx, 'PATCH', `/api/members/${IDS.haru}`, {
      headers: as('papa'),
      body: { disabled: false },
    });
    expect(reenable.status).toBe(409);
  });

  it('色の重複は拒否', async () => {
    const res = await send(ctx, 'POST', '/api/members', {
      headers: as('papa'),
      body: newMember({ color: 'kaki' }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('color_taken');
    const me = await send(ctx, 'PATCH', '/api/me', {
      headers: as('haru'),
      body: { color: 'fuji' },
    });
    expect(me.status).toBe(409);
  });

  it('上限（MAX_MEMBERS）を超えて追加・再有効化できない', async () => {
    await send(ctx, 'POST', '/api/members', { headers: as('papa'), body: newMember() });
    await send(ctx, 'POST', '/api/members', {
      headers: as('papa'),
      body: newMember({ login: 'g2@example.com', name: 'おじいちゃん', mark: 'じ', color: 'momo' }),
    });
    const over = await send(ctx, 'POST', '/api/members', {
      headers: as('papa'),
      body: newMember({ login: 'g3@example.com', name: 'いとこ', mark: 'い', color: 'wakakusa' }),
    });
    expect(over.status).toBe(409);
    expect(((await over.json()) as { code: string }).code).toBe('member_limit');
  });

  it('最後の管理者は降格・無効化できない', async () => {
    expect(
      (
        await send(ctx, 'PATCH', `/api/members/${IDS.papa}`, {
          headers: as('papa'),
          body: { role: 'member' },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send(ctx, 'PATCH', `/api/members/${IDS.papa}`, {
          headers: as('papa'),
          body: { disabled: true },
        })
      ).status,
    ).toBe(409);
    await send(ctx, 'PATCH', `/api/members/${IDS.mama}`, {
      headers: as('papa'),
      body: { role: 'admin' },
    });
    expect(
      (
        await send(ctx, 'PATCH', `/api/members/${IDS.papa}`, {
          headers: as('mama'),
          body: { role: 'member' },
        })
      ).status,
    ).toBe(200);
  });

  it('無効化したメンバーは 403 not_member になり、同期のメンバー一覧には disabled で残る', async () => {
    await send(ctx, 'PATCH', `/api/members/${IDS.haru}`, {
      headers: as('papa'),
      body: { disabled: true },
    });
    expect((await send(ctx, 'GET', '/api/me', { headers: as('haru') })).status).toBe(403);
    const sync = (await (await send(ctx, 'GET', '/api/sync', { headers: as('papa') })).json()) as {
      members: { id: string; disabled: boolean }[];
    };
    expect(sync.members.find((m) => m.id === IDS.haru)?.disabled).toBe(true);
  });
});

describe('/api/me', () => {
  it('名前・略称・色・呼び名・設定を変えられる。設定は部分的に混ぜる', async () => {
    const res = await send(ctx, 'PATCH', '/api/me', {
      headers: as('haru'),
      body: {
        name: ' ハル ',
        mark: 'ハ',
        color: 'ruri',
        aliases: ['はる', 'ハルくん'],
        settings: { weekStart: 1, notifications: { familyChanges: 'all' } },
      },
    });
    expect(res.status).toBe(200);
    const me = (await res.json()) as {
      name: string;
      settings: {
        weekStart: number;
        theme: string;
        notifications: { familyChanges: string; timedDefaults: number[] };
      };
    };
    expect(me.name).toBe('ハル');
    expect(me.settings).toMatchObject({
      weekStart: 1,
      theme: 'system',
      notifications: { familyChanges: 'all', timedDefaults: [-30] },
    });
  });

  it('通知の設定を 1 項目だけ送っても、ほかの項目は保たれる（既定値に戻らない）', async () => {
    const first = await send(ctx, 'PATCH', '/api/me', {
      headers: as('haru'),
      body: {
        settings: {
          notifications: {
            timedDefaults: [-60],
            quietHours: { enabled: false, from: '23:00', to: '06:00' },
          },
        },
      },
    });
    expect(first.status).toBe(200);
    const res = await send(ctx, 'PATCH', '/api/me', {
      headers: as('haru'),
      body: { settings: { notifications: { familyChanges: 'all' } } },
    });
    const me = (await res.json()) as { settings: { notifications: Record<string, unknown> } };
    expect(me.settings.notifications).toMatchObject({
      familyChanges: 'all',
      timedDefaults: [-60],
      quietHours: { enabled: false, from: '23:00', to: '06:00' },
    });
  });

  it('略称は 1 文字、呼び名は 10 個まで・各 10 文字まで、知らないキーは 422', async () => {
    expect(
      (await send(ctx, 'PATCH', '/api/me', { headers: as('haru'), body: { mark: 'はる' } })).status,
    ).toBe(422);
    expect(
      (
        await send(ctx, 'PATCH', '/api/me', {
          headers: as('haru'),
          body: { aliases: Array(11).fill('あ') },
        })
      ).status,
    ).toBe(422);
    expect(
      (await send(ctx, 'PATCH', '/api/me', { headers: as('haru'), body: { role: 'admin' } }))
        .status,
    ).toBe(422);
  });
});
