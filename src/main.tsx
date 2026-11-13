import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

const appBase = import.meta.env.BASE_URL;

function OfflineRegistration() {
  useEffect(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register(`${appBase}sw.js`, { scope: appBase }).catch(() => undefined);
    }
  }, []);
  return null;
}

// Retain the previous base path so existing bookmarks and installed apps still open.
const labPaths = ['/lab/cyber-security-map', '/lab/personal-cyber-os'];
const routerBase = labPaths.find((path) => window.location.pathname === path || window.location.pathname.startsWith(`${path}/`)) ?? '/';
// Static project hosts cannot serve arbitrary history URLs on refresh.
const Router = appBase === '/' ? BrowserRouter : HashRouter;

const root = document.getElementById('root')!;
// Do not expose the vault UI inside frames on hosts without anti-framing headers.
if (window.self === window.top) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Router basename={appBase === '/' ? routerBase : undefined}>
        <OfflineRegistration />
        <App />
      </Router>
    </React.StrictMode>,
  );
} else {
  root.textContent = 'このアプリは埋め込み表示では利用できません。URLを直接開いてください。';
}
