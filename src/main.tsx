import { Capacitor } from "@capacitor/core";
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (!Capacitor.isNativePlatform() && "serviceWorker" in navigator && (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD) {
  void navigator.serviceWorker.register("/sw.js").catch(error => console.warn("No se pudo registrar la aplicación web.", error));
}
