import { fromJst } from '@ito/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aiUsage } from '../src/db/schema';
import type { AiClient, AiRequest, AiResponse } from '../src/services/ai-client';
import { anthropicClient } from '../src/services/ai-client';
import { as, IDS, seedFamily } from './family';
import { createTestContext, devEnv, send, type TestContext } from './helpers';

/** 固定の応答を返す AI（RUNBOOK Phase 5）。受け取った要求を記録する */
class FakeAi implements AiClient {
  calls: AiRequest[] = [];
  constructor(public reply: (req: AiRequest) => AiResponse) {}
  async complete(req: AiRequest): Promise<AiResponse> {
    this.calls.push(req);
    return this.reply(req);
  }
}

/** 家族は 父(m1)・母(m2)・ゆき(m3)・はる(m4)。書いた人は はる */
function aiOut(over: Record<string, unknown> = {}): AiResponse {
  return {
    kind: 'ok',
    inputTokens: 2000,
    outputTokens: 200,
    json: {
      title: '歯医者',
      date: '2026-09-28',
      end_date: null,
      all_day: false,
      start_time: '19:00',
      end_time: null,
      member_keys: ['M2'],
      for_everyone: false,
      location: '駅前歯科',
      private: false,
      recurrence: 'none',
      recurrence_weekdays: [],
      recurrence_nth: [],
      ambiguities: [],
      ...over,
    },
  };
}

let ctx: TestContext;
let ai: FakeAi;
beforeEach(() => {
  ai = new FakeAi(() => aiOut());
  ctx = createTestContext(devEnv({ AI_RATE_PER_MIN: '3', AI_RATE_PER_DAY: '5' }), {
    now: fromJst('2026-09-27', '14:18'),
    ai,
  });
  seedFamily(ctx);
});
afterEach(() => ctx.close());

const TEXT = '明日 19時 歯医者 @駅前歯科 母';

async function parse(text = TEXT, who: 'haru' | 'papa' = 'haru') {
  const res = await send(ctx, 'POST', '/api/parse', { headers: as(who), body: { text } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/parse（§16）', () => {
  it('AI の結果を下書きにする（キーは大文字小文字を区別せずに家族の ID に）', async () => {
    const { status, body } = await parse();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      source: 'ai',
      draft: {
        title: '歯医者',
        startDate: '2026-09-28',
        endDate: '2026-09-28',
        allDay: false,
        startTime: '19:00',
        endTime: null,
        memberIds: [IDS.mama],
        forEveryone: false,
        location: '駅前歯科',
        isPrivate: false,
        busy: true,
        recurrence: { kind: 'none' },
      },
      ambiguities: [],
    });
  });

  it('AI に送るのは入力文・日付表・家族の呼び名だけ。スキーマの enum は m1〜mN（実名を入れない）', async () => {
    await parse();
    const req = ai.calls[0] as AiRequest;
    expect(req.user).toBe(TEXT);
    expect(req.system).toContain('2026-09-27 (日) 今日');
    expect(req.system).toContain('2026-10-12 (月) 祝日:スポーツの日');
    expect(req.system).toContain('m1: お父さん（呼び名: 父）');
    expect(req.system).toContain('書いた人: m4');
    expect(req.system).toContain('日曜始まり: 今週 9/27(日)〜10/3(土)');
    const schema = JSON.stringify(req.schema);
    expect(schema).toContain('"enum":["m1","m2","m3","m4"]');
    expect(schema).not.toContain('お父さん');
  });

  it.each<[string, AiResponse]>([
    ['形が違う', { kind: 'ok', inputTokens: 1, outputTokens: 1, json: { title: 1 } }],
    ['知らないキー', aiOut({ member_keys: ['m9'] })],
    ['範囲外の日付', aiOut({ date: '2031-01-01' })],
    ['ありえない日付', aiOut({ date: '2026-02-30' })],
    ['時刻の形', aiOut({ start_time: '25:00' })],
    ['refusal', { kind: 'refusal' }],
    ['max_tokens', { kind: 'max_tokens' }],
    ['タイムアウト', { kind: 'timeout' }],
    ['エラー', { kind: 'error', status: 500 }],
  ])('%s → ルール解析に切り替える', async (_name, reply) => {
    ai.reply = () => reply;
    const { status, body } = await parse();
    expect(status).toBe(200);
    expect(body.source).toBe('rules');
    expect(body).toMatchObject({
      draft: {
        title: '歯医者',
        startDate: '2026-09-28',
        startTime: '19:00',
        memberIds: [IDS.mama],
      },
    });
  });

  it('鍵がなければいつもルール解析（AI を呼ばない）', async () => {
    const plain = createTestContext(devEnv(), { now: fromJst('2026-09-27', '14:18') });
    seedFamily(plain);
    try {
      const res = await send(plain, 'POST', '/api/parse', {
        headers: as('haru'),
        body: { text: TEXT },
      });
      expect(await res.json()).toMatchObject({ source: 'rules', reason: 'unavailable' });
    } finally {
      plain.close();
    }
  });

  it('回数制限（1 分・1 日）を超えたら AI を呼ばずにルール解析', async () => {
    for (let i = 0; i < 3; i++) expect((await parse()).body.source).toBe('ai');
    expect((await parse()).body).toMatchObject({ source: 'rules', reason: 'rate_limited' });
    expect(ai.calls).toHaveLength(3);
    // 1 分たてばまた使える。1 日の上限（5）で止まる
    ctx.clock.advance(61_000);
    expect((await parse()).body.source).toBe('ai');
    expect((await parse()).body.source).toBe('ai');
    expect((await parse()).body).toMatchObject({ source: 'rules', reason: 'rate_limited' });
    // ほかの人は別に数える
    expect((await parse(TEXT, 'papa')).body.source).toBe('ai');
  });

  it('入力文はログ・DB・エラー応答に残らない', async () => {
    const secret = '内緒 金曜 19時 誕生日のサプライズ';
    await parse(secret);
    ai.reply = () => ({ kind: 'error', status: 500 });
    await parse(secret);
    const tooLong = `${secret}${'あ'.repeat(200)}`;
    const bad = await parse(tooLong);
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).not.toContain('サプライズ');
    expect(ctx.logs.text).not.toContain('サプライズ');
    const dump = JSON.stringify(ctx.database.sqlite.prepare('SELECT * FROM ai_usage').all());
    expect(dump).not.toContain('サプライズ');
    expect(ctx.database.db.select().from(aiUsage).all()).toHaveLength(2);
  });

  it('非公開・全員・繰り返し・曖昧さを下書きの形にする', async () => {
    ai.reply = () =>
      aiOut({
        title: 'ゴミ出し',
        start_time: '07:30',
        member_keys: [],
        for_everyone: true,
        location: null,
        recurrence: 'monthly_nth_weekday',
        recurrence_weekdays: ['WE'],
        recurrence_nth: [2, 4],
        date: '2026-10-14',
        ambiguities: [
          { field: 'time', question: '何時？', options: ['07:30', 'all_day'] },
          { field: 'members', question: 'だれ？', options: ['m1', 'M2'] },
          { field: 'recurrence', question: '毎月？', options: ['毎月'] },
        ],
      });
    const { body } = await parse('第2・第4水曜 7:30 ゴミ出し みんな');
    expect(body).toMatchObject({
      source: 'ai',
      draft: {
        forEveryone: true,
        memberIds: [],
        recurrence: { kind: 'monthlyByWeekday', nth: [2, 4], weekday: 3 },
      },
      ambiguities: [
        {
          field: 'time',
          options: [
            { label: '7:30', value: '07:30' },
            { label: '終日のまま', value: 'all_day' },
          ],
        },
        {
          field: 'members',
          options: [
            { label: 'お父さん', value: IDS.papa },
            { label: 'お母さん', value: IDS.mama },
          ],
        },
      ],
    });
    ai.reply = () => aiOut({ private: true, for_everyone: true, member_keys: ['m1'] });
    expect((await parse('内緒 明日 19時 歯医者')).body).toMatchObject({
      draft: { isPrivate: true, forEveryone: false, memberIds: [IDS.haru] },
    });
  });

  it('入力の曜日と決めた日の曜日が違えば、日付を聞く', async () => {
    // 「土曜」なのに AI が 10/4（日）にした
    ai.reply = () => aiOut({ date: '2026-10-04' });
    const { body } = await parse('土曜 19時 歯医者');
    expect(body).toMatchObject({
      source: 'ai',
      ambiguities: [
        {
          field: 'date',
          options: [{ value: '2026-10-04' }, { value: '2026-10-03' }],
        },
      ],
    });
  });

  it('1〜200 文字（空・長すぎは 422）', async () => {
    expect((await parse('')).status).toBe(422);
    expect((await parse('あ'.repeat(201))).status).toBe(422);
  });
});

describe('Phase 5 のレビューの指摘', () => {
  it('同時に送っても回数制限を超えて AI を呼ばない（枠は呼ぶ前に取る）', async () => {
    // 返事が遅い AI に、1 分の上限（3）を超える 10 件を同時に送る
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    ai.reply = () => aiOut();
    const slow: AiClient = {
      complete: async (req) => {
        ai.calls.push(req);
        await gate;
        return aiOut();
      },
    };
    const busy = createTestContext(devEnv({ AI_RATE_PER_MIN: '3', AI_RATE_PER_DAY: '5' }), {
      now: fromJst('2026-09-27', '14:18'),
      ai: slow,
    });
    seedFamily(busy);
    try {
      const pending = Array.from({ length: 10 }, () =>
        send(busy, 'POST', '/api/parse', { headers: as('haru'), body: { text: TEXT } }),
      );
      await new Promise((r) => setTimeout(r, 20));
      release();
      const bodies = await Promise.all(
        pending.map(async (p) => (await (await p).json()) as { source: string; reason?: string }),
      );
      expect(ai.calls).toHaveLength(3);
      expect(bodies.filter((b) => b.source === 'ai')).toHaveLength(3);
      expect(bodies.filter((b) => b.reason === 'rate_limited')).toHaveLength(7);
      // 使った枠は結果で書き直される（pending のまま残らない）
      const rows = busy.database.db.select().from(aiUsage).all();
      expect(rows.map((r) => r.source)).toEqual(['ai', 'ai', 'ai']);
    } finally {
      busy.close();
    }
  });

  it('複数日の予定は、期間のどこかの曜日と合えば曜日の食い違いを聞かない', async () => {
    ai.reply = () =>
      aiOut({
        title: '帰省',
        date: '2026-09-28',
        end_date: '2026-10-04',
        all_day: true,
        start_time: null,
        member_keys: [],
        for_everyone: true,
        location: null,
      });
    const { body } = await parse('明日から日曜まで 帰省 みんな');
    expect(body.source).toBe('ai');
    expect(body.ambiguities).toEqual([]);
  });

  it('ルール解析が読めなかった日付・人も、AI が決めていれば書いてあったとする（found）', async () => {
    ai.reply = () =>
      aiOut({
        title: '飲み会',
        date: '2026-09-30',
        start_time: '18:00',
        member_keys: [],
        for_everyone: true,
        location: null,
      });
    const { body } = await parse('30日 18時 みんなで飲み会');
    expect(body.source).toBe('ai');
    expect(body.found).toEqual({
      date: true,
      time: true,
      members: true,
      private: false,
      recurrence: false,
    });
    // 書いていない日付（AI も今日・明日の決まりのとおり）なら書いていないまま
    ai.reply = () =>
      aiOut({
        title: '打ち合わせ',
        date: '2026-09-27',
        start_time: '15:00',
        member_keys: ['m4'],
        location: null,
      });
    const second = await parse('15時 打ち合わせ');
    expect((second.body.found as { date: boolean; members: boolean }).date).toBe(false);
    expect((second.body.found as { date: boolean; members: boolean }).members).toBe(false);
  });
});

describe('Anthropic の呼び出し（公式 SDK の fetch を差し替えて形だけ確かめる。実 API は pnpm ai:eval だけ）', () => {
  it('Structured Outputs・temperature 0・max_tokens 800・再試行なしで送り、本文の JSON を読む', async () => {
    const sent: { url: string; init: RequestInit | undefined }[] = [];
    const client = anthropicClient({
      apiKey: 'test-key',
      model: 'claude-haiku-4-5',
      timeoutMs: 1000,
      fetcher: (async (url: string | URL | Request, init?: RequestInit) => {
        sent.push({ url: String(url), init });
        return Response.json({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-4-5',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"a":1}' }],
          usage: { input_tokens: 10, output_tokens: 2 },
        });
      }) as typeof fetch,
    });
    const r = await client.complete({ system: 's', user: 'u', schema: { type: 'object' } });
    expect(r).toEqual({ kind: 'ok', json: { a: 1 }, inputTokens: 10, outputTokens: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(String(sent[0]?.init?.body));
    expect(body).toEqual({
      model: 'claude-haiku-4-5',
      max_tokens: 800,
      temperature: 0,
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    });
    const headers = new Headers(sent[0]?.init?.headers);
    expect(headers.get('x-api-key')).toBe('test-key');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
  });

  it('refusal・max_tokens・タイムアウト・HTTP エラー・通信エラーを見分ける（どれも再試行しない）', async () => {
    let calls = 0;
    const make = (fetcher: typeof fetch, timeoutMs = 1000) =>
      anthropicClient({
        apiKey: 'k',
        model: 'm',
        timeoutMs,
        fetcher: (async (url: string | URL | Request, init?: RequestInit) => {
          calls++;
          return fetcher(url, init);
        }) as typeof fetch,
      });
    const req = { system: 's', user: 'u', schema: {} };
    const message = (stop_reason: string) =>
      Response.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'm',
        stop_reason,
        content: [],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    expect(await make((async () => message('refusal')) as typeof fetch).complete(req)).toEqual({
      kind: 'refusal',
    });
    expect(await make((async () => message('max_tokens')) as typeof fetch).complete(req)).toEqual({
      kind: 'max_tokens',
    });
    // 応答が来ないまま timeoutMs を過ぎたら、SDK が止めて timeout
    const hang = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as typeof fetch;
    calls = 0;
    expect(await make(hang, 50).complete(req)).toEqual({ kind: 'timeout' });
    expect(calls).toBe(1);
    calls = 0;
    expect(
      await make((async () =>
        Response.json(
          { type: 'error', error: { type: 'overloaded_error', message: 'x' } },
          { status: 529 },
        )) as typeof fetch).complete(req),
    ).toEqual({ kind: 'error', status: 529 });
    expect(calls).toBe(1);
    expect(
      await make((async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch).complete(req),
    ).toEqual({ kind: 'error', status: null });
    // 本文が JSON でない（形の不正）
    expect(
      await make((async () =>
        Response.json({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'm',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'not json' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        })) as typeof fetch).complete(req),
    ).toEqual({ kind: 'error', status: null });
  });
});
