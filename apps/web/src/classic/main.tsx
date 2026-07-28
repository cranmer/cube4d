import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { claimLegacyKey, setAppId } from '@mc4d/shell';

import { App } from './App.js';
import './styles.css';

// Before anything renders: this app's saved state is its own, and does not belong to whatever else
// gets served from this origin. The two claims adopt values written when this was the only app.
setAppId('classic');
claimLegacyKey('mc4d.session', 'session');
claimLegacyKey('mc4d.sections', 'sections');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
