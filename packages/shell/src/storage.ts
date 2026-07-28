/**
 * Where a front-end's saved state lives.
 *
 * Every app in this project is served from one origin, and so shares one localStorage. What gets
 * stored divides cleanly in two:
 *
 *   - **Properties of the app** — an autosaved session, which panel sections are open. A different
 *     layout reading these would at best find them meaningless and at worst overwrite a solve in
 *     progress. These are namespaced per app.
 *   - **Properties of the person** — colour palette, playback speed. Someone who needs a
 *     high-contrast palette needs it in every app, and being asked twice would be a defect. These
 *     are deliberately shared.
 *
 * An app declares its id once at startup. This module is the only thing that knows the difference
 * between the two cases, which keeps the rest of the shell honestly ignorant of who is using it.
 */

let appId = 'app';

/**
 * Name the calling app. Call once, before rendering — keys are resolved lazily, so anything
 * written after this point is namespaced correctly, but anything written before is not.
 */
export function setAppId(id: string): void {
  appId = id;
}

/** A key private to the calling app. */
export function appKey(name: string): string {
  return `mc4d.${appId}.${name}`;
}

/** A key every app shares, for preferences that belong to the person rather than the layout. */
export function sharedKey(name: string): string {
  return `mc4d.${name}`;
}

/**
 * Adopt a value written before keys were namespaced.
 *
 * The classic app wrote `mc4d.session` and `mc4d.sections` back when it was the only app, so those
 * values are unambiguously its own. Claiming them means nobody who had a solve in progress loses it
 * to a refactor they never asked for. Safe to call on every start: it is a no-op once done.
 */
export function claimLegacyKey(legacy: string, name: string): void {
  try {
    const store = globalThis.localStorage;
    if (!store) return;
    const value = store.getItem(legacy);
    if (value === null) return;
    // Don't clobber a namespaced value that already exists — the legacy one is necessarily older.
    if (store.getItem(appKey(name)) === null) store.setItem(appKey(name), value);
    store.removeItem(legacy);
  } catch {
    /* storage can be unavailable; a lost preference is not worth surfacing */
  }
}
