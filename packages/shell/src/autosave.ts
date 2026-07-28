/**
 * Autosave.
 *
 * There is no server, so this is browser storage. Cookies are the wrong tool — 4 KB, and sent on
 * every HTTP request to a server that does not exist. IndexedDB would give far more room than is
 * needed at the cost of making every read and write async. localStorage is the fit: a solve is the
 * same save document a file gets, and moves dominate it at roughly twelve characters each, so even
 * a 5,765-twist blindfolded solve lands around 70 KB against a ~5 MB quota.
 *
 * The key is namespaced per app, since apps sharing an origin share storage but not sessions —
 * see storage.ts.
 *
 * Two things localStorage demands care about, and both are handled here:
 *
 *   - it is **synchronous**, so writing on every twist would stutter the animation. Writes are
 *     debounced, with a flush when the page is hidden so nothing is lost to a closed tab.
 *   - it can **refuse**. Quota is finite and private modes can deny it outright, so a failure is
 *     reported once and then left alone rather than thrown on every move.
 */

import type { SaveDoc } from '@mc4d/legacy-format';
import { appKey } from './storage.js';

const WRITE_DELAY_MS = 800;

export interface AutosaveHandlers {
  /** Called once if storage refuses, so the app can say so rather than fail silently. */
  onUnavailable?: (reason: string) => void;
}

export class Autosave {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: SaveDoc | null = null;
  private disabled = false;

  constructor(private readonly handlers: AutosaveHandlers = {}) {
    // A tab being hidden is the last reliable moment to write: `beforeunload` is unreliable on
    // mobile, where the OS can discard a backgrounded tab without ever firing it.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flush();
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flush());
    }
  }

  /** Queue a save. Cheap to call on every move; the write itself is debounced. */
  schedule(doc: SaveDoc): void {
    if (this.disabled) return;
    this.pending = doc;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const doc = this.pending;
    if (!doc || this.disabled) return;
    this.pending = null;
    try {
      globalThis.localStorage?.setItem(appKey('session'), JSON.stringify(doc));
    } catch (e) {
      this.disabled = true;
      const quota = e instanceof DOMException && /quota/i.test(e.name);
      this.handlers.onUnavailable?.(
        quota
          ? 'This solve is too long to save automatically — use Save to keep it.'
          : 'Automatic saving is unavailable in this browser.',
      );
    }
  }

  /** The last autosaved session, or null. Malformed data is discarded rather than thrown. */
  load(): SaveDoc | null {
    try {
      const text = globalThis.localStorage?.getItem(appKey('session'));
      if (!text) return null;
      const doc = JSON.parse(text) as SaveDoc;
      return doc?.format === 'mc4d-save' ? doc : null;
    } catch {
      return null;
    }
  }

  clear(): void {
    this.pending = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      globalThis.localStorage?.removeItem(appKey('session'));
    } catch {
      /* nothing useful to do */
    }
  }
}
