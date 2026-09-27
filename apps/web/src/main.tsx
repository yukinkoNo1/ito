import './zod-setup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyStoredAppearance } from './app/appearance';
import { captureInstallPrompt, persistIfInstalled } from './pwa/install';
import './index.css';

// 描画の前に、端末に写しておいたテーマと文字の大きさを当てる（色のちらつきを防ぐ）
applyStoredAppearance();
captureInstallPrompt();
void persistIfInstalled();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
