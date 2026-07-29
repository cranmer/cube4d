import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { claimLegacyKey, setAppId } from '@mc4d/shell';

import { App } from './App.js';
import './styles.css';

setAppId('multi');
// Nothing to claim from before namespacing — this app did not exist then — but stated rather than
// omitted, so the next app copied from this one does not silently skip it.
void claimLegacyKey;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
