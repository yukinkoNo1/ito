import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // PC の環境変数に ANTHROPIC_API_KEY があっても実 API を呼ばない（RUNBOOK 4.）
    env: { ANTHROPIC_API_KEY: '' },
    testTimeout: 20000,
  },
});
