// zod 4 は JIT を使うかどうかと new Function の試しを、スキーマを作った時点で決める。
// core のスキーマを作るモジュールは、最初にこのモジュールを読む（どの入口・どの読み込みの順でも、CSP の
// unsafe-eval を使わない。PWA はコードを分けて読むので、入口の zod-setup より先にスキーマが作られることがある）
import { z } from 'zod';

z.config({ jitless: true });
