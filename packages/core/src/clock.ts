/**
 * 今の時刻の取り出し口。アプリのコードは Date.now() や引数なしの Date コンストラクタを直接呼ばず、
 * ここから注入した Clock を使う（フィードや通知のテストで偽の時計を使うため）。
 */
export interface Clock {
  /** epoch ミリ秒（UTC） */
  now(): number;
}

/** 本物の時計。Date.now() を呼んでよいのはこのファイルだけ */
export const systemClock: Clock = {
  now: () => Date.now(),
};

export interface FakeClock extends Clock {
  set(ms: number): void;
  advance(ms: number): void;
}

/** テスト用の偽の時計 */
export function fakeClock(startMs: number): FakeClock {
  let current = startMs;
  return {
    now: () => current,
    set: (ms) => {
      current = ms;
    },
    advance: (ms) => {
      current += ms;
    },
  };
}
