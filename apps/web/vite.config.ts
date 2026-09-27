import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// E2E 用のビルド（--mode e2e）は別のフォルダに出す（ギャラリーは E2E 用のビルドにだけ入れる。RUNBOOK 3.）
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      // インラインスクリプトを生成しない（CSP。登録は src/pwa で自前で行う）
      injectRegister: null,
      manifest: {
        name: 'いと — 家族のカレンダー',
        short_name: 'いと',
        id: '/',
        start_url: '/?source=pwa',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'ja',
        background_color: '#F9F6F2',
        theme_color: '#F9F6F2',
        icons: [],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    __ITO_E2E__: JSON.stringify(mode === 'e2e'),
  },
  build: {
    outDir: mode === 'e2e' ? 'dist-e2e' : 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
}));
