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

const labPath = '/lab/personal-cyber-os';
const routerBase = window.location.pathname === labPath || window.location.pathname.startsWith(`${labPath}/`) ? labPath : '/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBase}>
      <OfflineRegistration />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
