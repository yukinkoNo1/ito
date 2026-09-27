// zod 4 は JIT を使うかどうかと new Function の試しを、スキーマを作った時点で決める。
// ほかのモジュールがスキーマを作る前に jitless にするため、入口の最初の import にする（SPEC §8。CSP の unsafe-eval を使わない）
import { z } from 'zod';

z.config({ jitless: true });
