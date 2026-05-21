import React from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import { Buffer } from 'buffer';
import './styles.css';

window.global = window;
window.Buffer = Buffer;

import('./App.jsx').then(({ default: App }) => {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
      <Toaster position="top-right" toastOptions={{ duration: 3600 }} />
    </React.StrictMode>
  );
});
