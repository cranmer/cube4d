import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Gallery } from './Gallery.js';
import './gallery.css';

// Deliberately no `@mc4d/shell` import. The gallery stores nothing and renders nothing, and the
// shell's barrel reaches PuzzleRenderer, which would have pulled all of Three.js onto a page that
// only shows PNGs. Verified in the build output: the gallery's chunk is a few kB beside React.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
