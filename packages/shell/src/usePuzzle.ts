/**
 * The playable puzzle: picking, twisting, animation, history, scramble.
 *
 * Everything that decides *what happens* lives in `@mc4d/puzzle-core` and is tested headlessly.
 * This hook is the wiring — pointer events in, renderer calls out — plus the animation clock.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyMove,
  canRedo,
  canUndo,
  countTwists,
  decodeAsset,
  emptyHistory,
  fullScrambleLength,
  gripForPick,
  isSolved,
  isValidTwist,
  numSlicesForGrip,
  stickerForGrip,
  pushMark,
  pushMove,
  redo,
  scramble,
  solvedState,
  stickersInSlice,
  twistMatrix,
  undo,
  type History,
  type Move,
  type PuzzleGeometry,
} from '@mc4d/puzzle-core';
import { PuzzleRenderer } from '@mc4d/render';

import { sharedKey } from './storage.js';

/**
 * How long a quarter turn takes.
 *
 * The original counts frames — eleven of them for 90° — which makes the speed depend on the
 * monitor. Wall-clock time instead, calibrated to look like the original did at 60 Hz.
 */
const QUARTER_TURN_MS = 190;

/**
 * Playback runs at a quarter speed.
 *
 * Making a move yourself, you already know what you did; watching someone else's solve you are
 * trying to read it, and the pace that feels responsive under your own hand is far too quick to
 * follow.
 */
const PLAYBACK_SLOWDOWN = 4;

/**
 * How long the piece is lit, relative to how long the turn takes.
 *
 * Reading a move is two jobs and they are not equally hard: finding the highlighted piece among a
 * hundred others takes longer than watching it move once you have. So the pause is twice the turn.
 */
const TELEGRAPH_RATIO = 2;

/** Bounds on the playback speed slider: four times slower through four times faster. */
export const PLAYBACK_SPEED_RANGE = { min: 0.25, max: 4 } as const;
// Shared across apps: a preference about pace, not about layout.
const SPEED_KEY = sharedKey('playbackSpeed');

/** The original's easing: slow at both ends, quick through the middle. */
const ease = (x: number) => (Math.sin((x - 0.5) * Math.PI) + 1) / 2;

interface Animation {
  move: Move;
  startedAt: number;
  /**
   * How long the layer is lit before it moves. Zero for your own moves — you know what you just
   * clicked, and a delay there would only feel like lag.
   */
  telegraphMs: number;
  /** How long the turn itself takes, after any telegraph. */
  durationMs: number;
  /** Applied to the puzzle state when the animation ends; false while previewing an undo. */
  record: boolean;
}

export interface PuzzleSession {
  readonly geometry: PuzzleGeometry | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly twistCount: number;
  readonly solved: boolean;
  readonly scrambled: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly slicemask: number;
  /** Number of layers this puzzle has, and so how many slice toggles to offer. */
  readonly sliceCount: number;
  /** Increments on every change to the move list. Autosave watches this. */
  readonly revision: number;
  /** True while stepping automatically through the remaining moves. */
  readonly playing: boolean;
  /** 1 is the default pace; 4 is four times faster, 0.25 four times slower. */
  readonly playbackSpeed: number;
  /**
   * True when a plain tap twists the reverse way — the equivalent of holding right-click.
   *
   * This is the *effective* direction, so it flips while shift is held rather than only reporting
   * the toggle. A direction indicator built on it therefore shows what a click will actually do.
   */
  readonly reversed: boolean;
  /** True while Control is held: a click asks for the facet axis rather than inferring one. */
  readonly facetAxis: boolean;
  readonly busy: boolean;
}

export interface SessionState {
  readonly history: History;
  readonly scrambleState: 'none' | 'partial' | 'full' | 'solved';
  /**
   * Present only for scrambles this app generated. A scramble imported from a `.log` has none:
   * the original uses an unseeded RNG, so those solves can never be re-derived.
   */
  readonly scramble?: { seed: number; algo: 'mulberry32-v1'; twists: number } | undefined;
}

export interface PuzzleActions {
  /** `view` is the viewport the pointer is over; picking only means something under one camera. */
  onPointerMove(view: PuzzleRenderer, x: number, y: number): void;
  onPointerLeave(): void;
  /** Returns true if the click was consumed by a twist. */
  onClick(view: PuzzleRenderer, x: number, y: number, button: number): boolean;
  undo(): void;
  redo(): void;
  scramble(): void;
  reset(): void;
  toggleSlice(index: number): void;
  setReversed(reversed: boolean): void;
  /** Play the redo tail forward, or stop. */
  setPlaying(playing: boolean): void;
  setPlaybackSpeed(speed: number): void;
  /** Jump straight to a position without animating, for scrubbing a loaded solve. */
  seek(index: number): void;
  /** Everything a save file needs. */
  snapshot(): SessionState;
  /** Replay a loaded move list onto a solved puzzle, without animating. */
  restore(state: SessionState): void;
}

function readStoredSpeed(): number {
  try {
    const stored = Number(globalThis.localStorage?.getItem(SPEED_KEY));
    return Number.isFinite(stored) && stored > 0
      ? Math.max(PLAYBACK_SPEED_RANGE.min, Math.min(PLAYBACK_SPEED_RANGE.max, stored))
      : 1;
  } catch {
    return 1;
  }
}

function storeSpeed(speed: number): void {
  try {
    globalThis.localStorage?.setItem(SPEED_KEY, String(speed));
  } catch {
    /* a forgotten preference is not worth surfacing */
  }
}

export function usePuzzleSession(
  /**
   * Every viewport showing this puzzle, in whatever order the app keeps them.
   *
   * State changes and twist animation are broadcast to all of them — one puzzle seen from several
   * angles, not several puzzles. Picking is the exception and cannot be broadcast: a click happens
   * under one camera, so those actions take the view it happened in.
   */
  views: () => readonly PuzzleRenderer[],
  geometry: PuzzleGeometry | null,
): { session: PuzzleSession; actions: PuzzleActions } {
  /** Apply something to every viewport. */
  const each = (fn: (view: PuzzleRenderer) => void) => {
    for (const view of views()) fn(view);
  };
  /** True when at least one viewport exists to draw into. */
  const anyView = () => views().length > 0;
  const stateRef = useRef<Int32Array | null>(null);
  const historyRef = useRef<History>(emptyHistory);
  const animationRef = useRef<Animation | null>(null);
  const queueRef = useRef<{ move: Move; record: boolean; telegraph: boolean }[]>([]);
  // Two sources for which layers turn: number keys, held momentarily, and on-screen toggles that
  // stay put. They union, and an empty selection means the outermost layer.
  const keyMaskRef = useRef(0);
  // Layer 1 to begin with, and never empty: deselecting the last layer snaps back to it, so the
  // toggles always show exactly what a click will turn rather than an implied default.
  const chipMaskRef = useRef(1);
  // Which way a plain tap turns. Right-click is the desktop way to reverse a twist, and touch has
  // no second button, so the direction has to be selectable.
  const reversedRef = useRef(false);
  // Shift, while held, means "the other way" — the same shape of control as holding a number key to
  // borrow a layer, and the same reason: reversing one twist should not mean changing a setting and
  // changing it back. It combines with the toggle by exclusive-or, so holding shift always reverses
  // whatever the toggle currently says rather than forcing one direction.
  const shiftReversedRef = useRef(false);
  // Control, while held, asks for the facet axis whatever the clicked piece's colour count implies —
  // the turn the face's centre sticker would give, on puzzles that have one and on those that do not.
  const facetAxisRef = useRef(false);
  const scrambleRef = useRef<SessionState['scramble']>(undefined);
  const effectiveMask = () => keyMaskRef.current | chipMaskRef.current || 1;
  const syncMask = () => setSlicemask(effectiveMask());
  const effectiveReversed = () => reversedRef.current !== shiftReversedRef.current;
  /** The facet's own dimension when Control is held, and nothing otherwise. */
  const axisOverride = (geo: PuzzleGeometry) =>
    facetAxisRef.current ? geo.nDims - 1 : undefined;
  // The reported value is the effective one, so the direction buttons light up to match what a click
  // would actually do while shift is down — exactly as the layer chips show the borrowed layer.
  const syncReversed = () => setReversedState(effectiveReversed());

  const [twistCount, setTwistCount] = useState(0);
  const [solved, setSolved] = useState(true);
  const [scrambled, setScrambled] = useState(false);
  const [undoable, setUndoable] = useState(false);
  const [redoable, setRedoable] = useState(false);
  const [slicemask, setSlicemask] = useState(0);
  const [reversed, setReversedState] = useState(false);
  const [revision, setRevision] = useState(0);
  const [playing, setPlayingState] = useState(false);
  const playingRef = useRef(false);
  const [playbackSpeed, setPlaybackSpeedState] = useState(() => readStoredSpeed());
  const [facetAxis, setFacetAxis] = useState(false);
  const speedRef = useRef(playbackSpeed);
  const [busy, setBusy] = useState(false);

  /**
   * How many layers this puzzle has, which is how many toggles to show.
   *
   * Taken from the geometry rather than hardcoded, so a 2⁴ offers two and a 4⁴ offers four without
   * anything here needing to change.
   */
  const sliceCount = geometry
    ? (() => {
        let most = 1;
        for (let g = 0; g < geometry.nGrips; ++g) {
          most = Math.max(most, numSlicesForGrip(geometry, g));
        }
        return most;
      })()
    : 0;

  // --- reset when a puzzle arrives
  useEffect(() => {
    if (!geometry) return;
    stateRef.current = solvedState(geometry);
    historyRef.current = emptyHistory;
    animationRef.current = null;
    queueRef.current = [];
    // A layer selection does not survive a puzzle change: layer 3 means nothing on a 2-layer
    // puzzle, and carrying it over would silently disable every click.
    chipMaskRef.current = 1;
    keyMaskRef.current = 0;
    playingRef.current = false;
    setPlayingState(false);
    setSlicemask(1);
    each((v) => v.setState(stateRef.current!));
    setTwistCount(0);
    setSolved(true);
    setScrambled(false);
    setUndoable(false);
    setRedoable(false);
  }, [geometry, views]);

  const refreshFlags = useCallback(() => {
    if (!geometry) return;
    setRevision((n) => n + 1);
    const history = historyRef.current;
    setUndoable(canUndo(history));
    setRedoable(canRedo(history));
    setTwistCount(countTwists(history, (g) => numSlicesForGrip(geometry, g)));
    setSolved(isSolved(geometry, stateRef.current!));
  }, [geometry]);

  // --- the animation clock
  useEffect(() => {
    if (!geometry) return;
    let frame = 0;

    const startNext = () => {
      const next = queueRef.current.shift();
      if (!next || !anyView()) return;
      // A 180° twist takes twice as long as a 90° one, so every move turns at the same rate.
      const base =
        (QUARTER_TURN_MS * 4) / Math.max(2, geometry.gripSymmetryOrders[next.move.g]);
      // The slowdown is reserved for playback, so stepping stays brisk while watching stays
      // legible. The speed slider scales both, and both phases, so their proportion never shifts.
      const speed = playingRef.current ? speedRef.current : 1;
      const turnMs = ((base * (playingRef.current ? PLAYBACK_SLOWDOWN : 1)) / 2) / speed;
      animationRef.current = {
        move: next.move,
        startedAt: performance.now(),
        telegraphMs: next.telegraph ? turnMs * TELEGRAPH_RATIO : 0,
        durationMs: turnMs,
        record: next.record,
      };
      const slice = stickersInSlice(geometry, next.move.g, next.move.s);
      const rest = twistMatrix(geometry, next.move.g, next.move.d, 0);
      each((v) => {
        v.beginTwist(slice);
        v.setTwistMatrix(rest);
      });
      if (next.telegraph) {
        // Point at the sticker a player would have clicked for this move, highlighted exactly as
        // hovering it would be. A log records only the grip, so the sticker has to be recovered.
        const sticker = stickerForGrip(geometry, next.move.g);
        const cubie = sticker >= 0 ? geometry.sticker2cubie[sticker] : -1;
        each((v) => v.setHighlight(-1, cubie));
      }
      setBusy(true);
    };

    const tick = () => {
      const drawing = anyView();
      const animation = animationRef.current;
      if (drawing && animation) {
        const elapsed = performance.now() - animation.startedAt;
        if (elapsed < animation.telegraphMs) {
          // Lit but still. The twist matrix is already at zero, so nothing needs updating.
          frame = requestAnimationFrame(tick);
          return;
        }
        if (animation.telegraphMs > 0) {
          each((v) => v.setHighlight(-1, -1));
          animation.telegraphMs = 0;
          animation.startedAt = performance.now();
        }
        const t = Math.min(1, (performance.now() - animation.startedAt) / animation.durationMs);
        const turning = twistMatrix(geometry, animation.move.g, animation.move.d, ease(t));
        each((v) => v.setTwistMatrix(turning));
        if (t >= 1) {
          // Commit: the state changes only once the animation has finished, exactly as in the
          // original, so what you see and what the puzzle believes never disagree mid-turn.
          applyMove(geometry, stateRef.current!, animation.move);
          each((v) => {
            v.endTwist();
            v.setState(stateRef.current!);
          });
          animationRef.current = null;
          refreshFlags();
          if (queueRef.current.length > 0) startNext();
          else setBusy(false);
        }
      } else if (drawing && queueRef.current.length > 0) {
        startNext();
      } else if (drawing && playingRef.current) {
        // Playback is just redo, driven by the same clock, so a watched solve animates exactly as
        // a played one does.
        const stepped = redo(historyRef.current);
        if (stepped) {
          historyRef.current = stepped.history;
          queueRef.current.push({ move: stepped.move, record: false, telegraph: true });
          startNext();
        } else {
          playingRef.current = false;
          setPlayingState(false);
          refreshFlags();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [geometry, views, refreshFlags]);

  // --- keys held to borrow a layer, or to reverse the twist
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        keyMaskRef.current |= 1 << (digit - 1);
        syncMask();
      }
      // Shift also selects the 4D drag planes, which is not a conflict: that is a drag and this is a
      // click, and the two are already told apart by whether the pointer moved.
      if (event.shiftKey && !shiftReversedRef.current) {
        shiftReversedRef.current = true;
        syncReversed();
      }
      if (event.ctrlKey !== facetAxisRef.current) {
        facetAxisRef.current = event.ctrlKey;
        setFacetAxis(event.ctrlKey);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        keyMaskRef.current &= ~(1 << (digit - 1));
        syncMask();
      }
      if (!event.shiftKey && shiftReversedRef.current) {
        shiftReversedRef.current = false;
        syncReversed();
      }
      if (event.ctrlKey !== facetAxisRef.current) {
        facetAxisRef.current = event.ctrlKey;
        setFacetAxis(event.ctrlKey);
      }
    };
    // Releasing a key while the window is unfocused would otherwise leave it stuck down.
    const onBlur = () => {
      keyMaskRef.current = 0;
      shiftReversedRef.current = false;
      facetAxisRef.current = false;
      syncMask();
      syncReversed();
      setFacetAxis(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  /**
   * Queue a move.
   *
   * `telegraph` is the answer to "does the viewer already know what is about to happen?" — false
   * for a move you just clicked, true for undo, redo and playback, where the piece is worth
   * pointing at before it moves.
   */
  const enqueue = useCallback((move: Move, record: boolean, telegraph = true) => {
    queueRef.current.push({ move, record, telegraph });
  }, []);

  // Expose the true puzzle state for automated testing. The UI deliberately hides "solved" until
  // the puzzle has been scrambled, so a test cannot read it off the screen.
  useEffect(() => {
    if (!geometry) return;
    const handle = globalThis as unknown as { __mc4d?: Record<string, unknown> };
    handle.__mc4d = {
      ...(handle.__mc4d ?? {}),
      isSolved: () => isSolved(geometry, stateRef.current!),
      stateHash: () => Array.from(stateRef.current!).join(','),
      moveCount: () => historyRef.current.moves.length,
      pending: () => queueRef.current.length + (animationRef.current ? 1 : 0),
    };
  }, [geometry, twistCount, solved]);

  const actions: PuzzleActions = {
    onPointerMove(view, x, y) {
      if (!geometry || animationRef.current) return;
      // Picked in the view the pointer is over, since a pixel only means something under one
      // camera — but lit in all of them, because it is one piece and the point of a second view is
      // to see where that piece went.
      const hit = view.pick(x, y);
      if (!hit) {
        each((v) => v.setHighlight(-1, -1));
        return;
      }
      const { gripIndex } = gripForPick(geometry, hit.sticker, hit.poly, axisOverride(geometry));
      // Only light up what could actually be twisted with the current slice selection.
      if (gripIndex < 0 || !isValidTwist(geometry, gripIndex, effectiveMask())) {
        each((v) => v.setHighlight(-1, -1));
        return;
      }
      const cubie = geometry.sticker2cubie[hit.sticker];
      each((v) => v.setHighlight(-1, cubie));
    },

    onPointerLeave() {
      each((v) => v.setHighlight(-1, -1));
    },

    onClick(view, x, y, button) {
      if (!geometry) return false;
      const hit = view.pick(x, y);
      if (!hit) return false;

      const { gripIndex } = gripForPick(geometry, hit.sticker, hit.poly, axisOverride(geometry));
      const mask = effectiveMask();
      if (gripIndex < 0 || !isValidTwist(geometry, gripIndex, mask)) return false;

      // Left turns one way, right the other — the original's convention. The direction toggle
      // flips the base, so right-click still means "the other way" whichever base is selected.
      const base = effectiveReversed() ? -1 : 1;
      const direction = (button === 2 ? -base : base) as 1 | -1;
      const move: Move = { g: gripIndex, d: direction, s: mask };
      playingRef.current = false;
      setPlayingState(false);
      historyRef.current = pushMove(historyRef.current, move);
      // No telegraph: you just clicked this piece, so pointing at it would only add lag.
      enqueue(move, true, false);
      setRedoable(false);
      return true;
    },

    undo() {
      const stepped = undo(historyRef.current);
      if (!stepped || !geometry) return;
      historyRef.current = stepped.history;
      enqueue(stepped.move, false);
      refreshFlags();
    },

    redo() {
      const stepped = redo(historyRef.current);
      if (!stepped || !geometry) return;
      historyRef.current = stepped.history;
      enqueue(stepped.move, false);
      refreshFlags();
    },

    snapshot() {
      return {
        history: historyRef.current,
        // "Solved" is a state the original records in the header, distinct from merely being
        // unscrambled — it means this file represents a completed solve.
        scrambleState: scrambled
          ? isSolved(geometry!, stateRef.current!)
            ? ('solved' as const)
            : ('full' as const)
          : ('none' as const),
        ...(scrambleRef.current ? { scramble: scrambleRef.current } : {}),
      };
    },

    restore(next) {
      if (!geometry || !anyView()) return;
      // Replay rather than trust a stored position: the move list is the source of truth, and
      // replaying it proves the file and the geometry actually agree.
      const state = solvedState(geometry);
      const applied = next.history.moves.slice(0, next.history.index);
      for (const move of applied) applyMove(geometry, state, move);
      stateRef.current = state;
      historyRef.current = next.history;
      scrambleRef.current = next.scramble;
      queueRef.current = [];
      animationRef.current = null;
      each((v) => {
        v.endTwist();
        v.setState(state);
      });
      setScrambled(next.scrambleState !== 'none');
      refreshFlags();
    },

    scramble() {
      if (!geometry || !anyView()) return;
      // Applied instantly rather than animated — watching sixty random twists is not interesting,
      // and the original does the same.
      stateRef.current = solvedState(geometry);
      const seed = (Math.random() * 0x7fffffff) | 0;
      const twists = fullScrambleLength(geometry);
      const moves = scramble(geometry, { twists, seed });
      scrambleRef.current = { seed, algo: 'mulberry32-v1', twists };
      let history = emptyHistory;
      for (const move of moves) {
        applyMove(geometry, stateRef.current, move);
        history = pushMove(history, move);
      }
      // The boundary is what makes the twist counter mean "moves you made", not "moves made".
      historyRef.current = pushMark(history, 'scramble');
      queueRef.current = [];
      animationRef.current = null;
      each((v) => {
        v.endTwist();
        v.setState(stateRef.current!);
      });
      setScrambled(true);
      refreshFlags();
    },

    toggleSlice(index) {
      const next = chipMaskRef.current ^ (1 << index);
      chipMaskRef.current = next === 0 ? 1 : next;
      syncMask();
    },

    setReversed(next) {
      reversedRef.current = next;
      syncReversed();
    },

    setPlaying(next) {
      playingRef.current = next;
      setPlayingState(next);
    },

    setPlaybackSpeed(next) {
      const clamped = Math.max(PLAYBACK_SPEED_RANGE.min, Math.min(PLAYBACK_SPEED_RANGE.max, next));
      speedRef.current = clamped;
      setPlaybackSpeedState(clamped);
      storeSpeed(clamped);
    },

    seek(index) {
      if (!geometry || !anyView()) return;
      playingRef.current = false;
      setPlayingState(false);
      queueRef.current = [];
      animationRef.current = null;
      const clamped = Math.max(0, Math.min(historyRef.current.moves.length, index));
      const state = solvedState(geometry);
      for (const move of historyRef.current.moves.slice(0, clamped)) applyMove(geometry, state, move);
      stateRef.current = state;
      historyRef.current = { ...historyRef.current, index: clamped };
      each((v) => {
        v.endTwist();
        v.setState(state);
      });
      refreshFlags();
    },

    reset() {
      if (!geometry || !anyView()) return;
      stateRef.current = solvedState(geometry);
      historyRef.current = emptyHistory;
      scrambleRef.current = undefined;
      queueRef.current = [];
      animationRef.current = null;
      each((v) => {
        v.endTwist();
        v.setState(stateRef.current!);
      });
      setScrambled(false);
      refreshFlags();
    },
  };

  return {
    session: {
      geometry,
      loading: false,
      error: null,
      twistCount,
      solved,
      scrambled,
      canUndo: undoable,
      canRedo: redoable,
      slicemask,
      sliceCount,
      revision,
      playing,
      playbackSpeed,
      facetAxis,
      reversed,
      busy,
    },
    actions,
  };
}

/** Kept here so the loader and the session hook agree on how an asset is fetched. */
export async function loadPuzzle(url: string): Promise<PuzzleGeometry> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load ${url} (${response.status})`);

  let bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Response(bytes).body?.pipeThrough(new DecompressionStream('gzip'));
    if (!stream) throw new Error('could not decompress the puzzle asset');
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (bytes.byteOffset % 8 !== 0) {
    const aligned = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(aligned).set(bytes);
    return decodeAsset(aligned);
  }
  return decodeAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
