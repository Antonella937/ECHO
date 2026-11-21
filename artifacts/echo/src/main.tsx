import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

// Keep development previews fresh; offline caching is for the built phone app.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: 'none',
      })
      .then((registration) => {
        // Home-screen shortcuts on iOS can stay open for days. Check for a
        // newer worker when the user returns instead of relying on Safari's
        // background update schedule. Do not clear local conversation data.
        let lastCheck = 0;
        const checkForUpdate = () => {
          if (document.visibilityState === 'hidden' || !navigator.onLine) return;
          const now = Date.now();
          if (now - lastCheck < 60_000) return;
          lastCheck = now;
          void registration.update().catch(() => undefined);
        };
        checkForUpdate();
        window.addEventListener('focus', checkForUpdate);
        document.addEventListener('visibilitychange', checkForUpdate);
      })
      .catch((error: unknown) => {
        console.warn('ECHO no pudo activar el modo sin conexión.', error);
      });
  });
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
