/**
 * Everything a MagicCube4D front-end needs that is not a layout.
 *
 * The division this package draws is between *what the app does* and *what it looks like*. Session
 * logic, puzzle loading, persistence and the example corpus live here; panels, buttons and page
 * structure live in the apps. The test of whether something belongs here is simple and worth
 * applying strictly: **this package must never know which app is using it.**
 *
 * See docs/multi-app.md for why.
 */

export { Autosave, type AutosaveHandlers } from './autosave.js';
export { appKey, claimLegacyKey, setAppId, sharedKey } from './storage.js';
export { EXAMPLES, type Example } from './examples.js';
export { PuzzlePicker } from './PuzzlePicker.js';
export { Section } from './Section.js';
export {
  decodePermalink,
  download,
  encodePermalink,
  fromSaveDoc,
  parseDropped,
  saveDocToLogText,
  suggestFilename,
  toSaveDoc,
  type SessionSnapshot,
} from './persist.js';
export {
  loadPuzzle,
  PLAYBACK_SPEED_RANGE,
  usePuzzleSession,
  type PuzzleActions,
  type PuzzleSession,
  type SessionState,
} from './usePuzzle.js';
export {
  DEFAULT_CONTROLS,
  usePuzzleCanvas,
  type CanvasHandlers,
  type PuzzleCanvas,
  type ViewControls,
} from './usePuzzleCanvas.js';
