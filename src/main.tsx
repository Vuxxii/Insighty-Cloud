import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { detectCodecSupport } from './images/pipeline';

// Detect WebP encode support once at startup (PRD §2.1).
void detectCodecSupport();

// Service worker: app shell only (PRD §2.3). Registered in production builds.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
