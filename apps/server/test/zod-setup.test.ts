import '../src/zod-setup';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('zod の jitless（SPEC §8）', () => {
  it('入口の最初の import で jitless になる', () => {
    expect(z.core.globalConfig.jitless).toBe(true);
  });

  it('jitless のあとに作ったスキーマは new Function を使わない', () => {
    const original = globalThis.Function;
    let called = 0;
    const spy = new Proxy(original, {
      construct(target, args) {
        called++;
        return Reflect.construct(target, args);
      },
      apply(target, thisArg, args) {
        called++;
        return Reflect.apply(target, thisArg, args);
      },
    });
    globalThis.Function = spy;
    try {
      const schema = z.object({ a: z.string(), b: z.number(), c: z.object({ d: z.boolean() }) });
      for (let i = 0; i < 3; i++) schema.parse({ a: 'x', b: 1, c: { d: true } });
    } finally {
      globalThis.Function = original;
    }
    expect(called).toBe(0);
  });
});
