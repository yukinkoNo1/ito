import { z } from 'zod';
import type { App, AppDeps } from '../app';
import { parseBody } from '../lib/validate';
import type { AiClient } from '../services/ai-client';
import { parseText } from '../services/parse';

/** 入力は 1〜200 文字（入力文はエラー応答にも出さない。§16） */
const parseInputSchema = z.object({ text: z.string().trim().min(1).max(200) }).strict();

/** POST /api/parse（一言入力の解析。§16） */
export function registerParseRoutes(app: App, deps: AppDeps & { ai: AiClient | null }): void {
  const { db, clock, logger, env, ai } = deps;
  app.post('/api/parse', async (c) => {
    const { text } = await parseBody(c, parseInputSchema);
    const result = await parseText(
      { db, clock, logger, ai, ratePerMin: env.AI_RATE_PER_MIN, ratePerDay: env.AI_RATE_PER_DAY },
      c.get('me'),
      text,
    );
    return c.json(result);
  });
}
