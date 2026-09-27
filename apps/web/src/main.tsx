import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { App } from './app/App';
import './index.css';

// zod 4 が CSP（unsafe-eval なし）の下で new Function を試さないように（SPEC §8）
z.config({ jitless: true });

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
