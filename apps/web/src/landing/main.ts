/**
 * The landing page's only script: the Hall of Fame list.
 *
 * Deliberately vanilla rather than React. The page is otherwise zero-JavaScript, and pulling in a
 * framework to print eight links would put the shared React chunk on the one page with no need of
 * it — the same trap the gallery fell into with Three.js. The import is the deep path
 * `@mc4d/shell/examples` for the same reason: the shell's barrel reaches the renderer.
 */

import { EXAMPLES } from '@mc4d/shell/examples';

/** A cup, drawn rather than typed: the emoji renders differently on every platform. */
const TROPHY = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"
  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4.6 2.2h6.8v3.1a3.4 3.4 0 0 1-6.8 0Z"/>
  <path d="M4.6 3.2H3.1a1.6 1.6 0 0 0 1.7 3"/>
  <path d="M11.4 3.2h1.5a1.6 1.6 0 0 1-1.7 3"/>
  <path d="M8 8.7v2.1"/><path d="M5.7 13.8h4.6l-.5-2.9H6.2Z"/>
</svg>`;

function escapeHtml(text: string): string {
  const holder = document.createElement('div');
  holder.textContent = text;
  return holder.innerHTML;
}

const base = document.baseURI.replace(/index\.html$/, '');
const list = document.querySelector('#solves');

if (list) {
  for (const example of EXAMPLES) {
    const link = document.createElement('a');
    link.className = 'solve';
    // Opens the solve in the classic app at the position its solver faced.
    link.href = `${base}classic/#solve=${encodeURIComponent(example.file)}`;
    link.innerHTML =
      `<span class="solve-icon">${TROPHY}</span>` +
      `<span class="solve-text"><b>${escapeHtml(example.solver)}</b>` +
      `<span>${escapeHtml(example.puzzle)} · ${example.twists.toLocaleString()} twists` +
      `${example.note ? ` · ${escapeHtml(example.note)}` : ''}</span></span>`;
    list.append(link);
  }
}
