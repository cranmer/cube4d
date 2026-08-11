import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { setAppId } from '@mc4d/shell';

import { App } from './App.js';
import './styles.css';

setAppId('flat');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
