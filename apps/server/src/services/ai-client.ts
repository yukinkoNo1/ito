import Anthropic from '@anthropic-ai/sdk';

/**
 * 一言入力の AI（Anthropic Messages API。SPEC §8・§16）。公式の SDK（@anthropic-ai/sdk）で呼ぶ。
 * テストでは固定の応答を返すものに差し替える（RUNBOOK Phase 5。SDK の fetch も差し替えられる）。
 * 待つのは timeoutMs まで（§16 の 6 秒）で、SDK の再試行はしない（だめならすぐルール解析に切り替える）。
 * 入力文・応答の本文・API キーはログに出さない（呼び出し側は結果の種類とトークン数だけを見る）
 */

export interface AiRequest {
  system: string;
  /** 入力文（予定の内容としてだけ扱う） */
  user: string;
  /** Structured Outputs の JSON Schema（output_config.format） */
  schema: Record<string, unknown>;
}

export type AiResponse =
  | { kind: 'ok'; json: unknown; inputTokens: number; outputTokens: number }
  | { kind: 'refusal' }
  | { kind: 'max_tokens' }
  | { kind: 'timeout' }
  | { kind: 'error'; status: number | null };

export interface AiClient {
  complete(req: AiRequest): Promise<AiResponse>;
}

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** 差し替え用（テスト） */
  fetcher?: typeof fetch;
}

/** 下書き 1 件の JSON に足りる長さ（§16） */
export const AI_MAX_TOKENS = 800;

export function anthropicClient(opts: AnthropicOptions): AiClient {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    timeout: opts.timeoutMs,
    maxRetries: 0,
    ...(opts.fetcher ? { fetch: opts.fetcher } : {}),
  });
  return {
    async complete(req) {
      let message: Anthropic.Message;
      try {
        message = await client.messages.create({
          model: opts.model,
          max_tokens: AI_MAX_TOKENS,
          temperature: 0,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          output_config: { format: { type: 'json_schema', schema: req.schema } },
        });
      } catch (e) {
        if (e instanceof Anthropic.APIConnectionTimeoutError) return { kind: 'timeout' };
        if (e instanceof Anthropic.APIError) return { kind: 'error', status: e.status ?? null };
        return { kind: 'error', status: null };
      }
      // 拒否・打ち切りのときは本文がスキーマに合わないことがある（ルール解析に切り替える）
      if (message.stop_reason === 'refusal') return { kind: 'refusal' };
      if (message.stop_reason === 'max_tokens') return { kind: 'max_tokens' };
      const text = message.content.find((c) => c.type === 'text')?.text;
      if (typeof text !== 'string') return { kind: 'error', status: null };
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return { kind: 'error', status: null };
      }
      return {
        kind: 'ok',
        json,
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
      };
    },
  };
}
