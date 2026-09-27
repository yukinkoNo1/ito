import type { Clock } from '@ito/core';

/**
 * メモリ上の回数制限（単一プロセス。§15 のスケジューラと同じく 1 プロセスで動かす前提）。
 * 窓の中の回数を数え、上限を超えたら Retry-After（秒）を返す。
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  /** 1 回数える。上限を超えるなら数えずに { ok: false } */
  hit(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
    const now = this.clock.now();
    const from = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      const oldest = list[0] as number;
      return {
        ok: false,
        retryAfterSec: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      };
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.prune(from);
    return { ok: true };
  }

  private prune(from: number): void {
    for (const [k, list] of this.hits) {
      if (!list.some((t) => t > from)) this.hits.delete(k);
    }
  }
}
