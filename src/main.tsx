import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

function OfflineRegistration() {
  useEffect(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    }
  }, []);
  return null;
}

// Retain the previous base path so existing bookmarks and installed apps still open.
const labPaths = ['/lab/cyber-security-map', '/lab/personal-cyber-os'];
const routerBase = labPaths.find((path) => window.location.pathname === path || window.location.pathname.startsWith(`${path}/`)) ?? '/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBase}>
      <OfflineRegistration />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
