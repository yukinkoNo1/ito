import { defineProject } from 'vitest/config';

export default defineProject({
  define: {
    __ITO_E2E__: 'false',
    __ITO_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    name: 'web',
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    env: { ANTHROPIC_API_KEY: '' },
    passWithNoTests: true,
  },
});
