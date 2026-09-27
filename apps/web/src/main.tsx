import './zod-setup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { captureInstallPrompt, persistIfInstalled } from './pwa/install';
import './index.css';

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
