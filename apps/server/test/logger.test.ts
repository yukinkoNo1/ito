import { describe, expect, it } from 'vitest';
import { createLogger, maskSecrets } from '../src/logger';
import { LogCapture } from './helpers';

describe('ログ（SPEC §18）', () => {
  it('ito_feed_ で始まる文字列は、どこに出てもマスクする', () => {
    const logs = new LogCapture();
    const logger = createLogger('info', logs.stream);
    const token = `ito_feed_${'A'.repeat(43)}`;
    logger.info({ nested: { value: `Bearer ${token}` }, list: [token] }, `msg ${token}`);
    logger.error(new Error(`boom ${token}`));
    expect(logs.text).not.toContain(token);
    expect(logs.text).toContain('ito_feed_[masked]');
  });

  it('予定名・メモ・場所・入力文・ログイン・ヘッダは redact で消す', () => {
    const logs = new LogCapture();
    const logger = createLogger('info', logs.stream);
    logger.info({
      title: '歯医者',
      note: 'メモ',
      location: '駅前',
      text: '明日 19時 歯医者',
      login: 'mama@example.com',
      headers: { authorization: 'x' },
      event: { title: '内緒のプレゼント' },
    });
    for (const s of ['歯医者', 'メモ', '駅前', 'mama@example.com', '内緒のプレゼント']) {
      expect(logs.text).not.toContain(s);
    }
  });

  it('maskSecrets は Anthropic のキーもマスクする', () => {
    expect(maskSecrets('key=sk-ant-api03-abcdef')).toBe('key=sk-ant-[masked]');
  });
});
