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

/**
 * How long a quarter turn takes.
 *
 * The original counts frames — eleven of them for 90° — which makes the speed depend on the
 * monitor. Wall-clock time instead, calibrated to look like the original did at 60 Hz.
 */
const QUARTER_TURN_MS = 190;

/** The original's easing: slow at both ends, quick through the middle. */
const ease = (x: number) => (Math.sin((x - 0.5) * Math.PI) + 1) / 2;

interface Animation {
  move: Move;
  startedAt: number;
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
  readonly busy: boolean;
}

export interface PuzzleActions {
  onPointerMove(x: number, y: number): void;
  onPointerLeave(): void;
  /** Returns true if the click was consumed by a twist. */
  onClick(x: number, y: number, button: number): boolean;
  undo(): void;
  redo(): void;
  scramble(): void;
  reset(): void;
  toggleSlice(index: number): void;
}

export function usePuzzleSession(
  renderer: () => PuzzleRenderer | null,
  geometry: PuzzleGeometry | null,
): { session: PuzzleSession; actions: PuzzleActions } {
  const stateRef = useRef<Int32Array | null>(null);
  const historyRef = useRef<History>(emptyHistory);
  const animationRef = useRef<Animation | null>(null);
  const queueRef = useRef<{ move: Move; record: boolean }[]>([]);
  // Two sources for which layers turn: number keys, held momentarily, and on-screen toggles that
  // stay put. They union, and an empty selection means the outermost layer.
  const keyMaskRef = useRef(0);
  const chipMaskRef = useRef(0);
  const effectiveMask = () => keyMaskRef.current | chipMaskRef.current || 1;

  const [twistCount, setTwistCount] = useState(0);
  const [solved, setSolved] = useState(true);
  const [scrambled, setScrambled] = useState(false);
  const [undoable, setUndoable] = useState(false);
  const [redoable, setRedoable] = useState(false);
  const [slicemask, setSlicemask] = useState(0);
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
    renderer()?.setState(stateRef.current);
    setTwistCount(0);
    setSolved(true);
    setScrambled(false);
    setUndoable(false);
    setRedoable(false);
  }, [geometry, renderer]);

  const refreshFlags = useCallback(() => {
    if (!geometry) return;
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
      const view = renderer();
      if (!next || !view) return;
      animationRef.current = {
        move: next.move,
        startedAt: performance.now(),
        // A 180° twist takes twice as long as a 90° one, so every move turns at the same rate.
        durationMs:
          (QUARTER_TURN_MS * 4) / Math.max(2, geometry.gripSymmetryOrders[next.move.g]),
        record: next.record,
      };
      view.beginTwist(stickersInSlice(geometry, next.move.g, next.move.s));
      setBusy(true);
    };

    const tick = () => {
      const view = renderer();
      const animation = animationRef.current;
      if (view && animation) {
        const t = Math.min(1, (performance.now() - animation.startedAt) / animation.durationMs);
        view.setTwistMatrix(
          twistMatrix(geometry, animation.move.g, animation.move.d, ease(t)),
        );
        if (t >= 1) {
          // Commit: the state changes only once the animation has finished, exactly as in the
          // original, so what you see and what the puzzle believes never disagree mid-turn.
          applyMove(geometry, stateRef.current!, animation.move);
          view.endTwist();
          view.setState(stateRef.current!);
          animationRef.current = null;
          refreshFlags();
          if (queueRef.current.length > 0) startNext();
          else setBusy(false);
        }
      } else if (view && queueRef.current.length > 0) {
        startNext();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [geometry, renderer, refreshFlags]);

  // --- number keys pick which slices turn
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        keyMaskRef.current |= 1 << (digit - 1);
        setSlicemask(effectiveMask());
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        keyMaskRef.current &= ~(1 << (digit - 1));
        setSlicemask(effectiveMask());
      }
    };
    // Releasing a key while the window is unfocused would otherwise leave it stuck down.
    const onBlur = () => {
      keyMaskRef.current = 0;
      setSlicemask(effectiveMask());
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

  const enqueue = useCallback((move: Move, record: boolean) => {
    queueRef.current.push({ move, record });
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
    onPointerMove(x, y) {
      const view = renderer();
      if (!view || !geometry || animationRef.current) return;
      const hit = view.pick(x, y);
      if (!hit) {
        view.setHighlight(-1, -1);
        return;
      }
      const { gripIndex } = gripForPick(geometry, hit.sticker, hit.poly);
      // Only light up what could actually be twisted with the current slice selection.
      if (gripIndex < 0 || !isValidTwist(geometry, gripIndex, effectiveMask())) {
        view.setHighlight(-1, -1);
        return;
      }
      view.setHighlight(-1, geometry.sticker2cubie[hit.sticker]);
    },

    onPointerLeave() {
      renderer()?.setHighlight(-1, -1);
    },

    onClick(x, y, button) {
      const view = renderer();
      if (!view || !geometry) return false;
      const hit = view.pick(x, y);
      if (!hit) return false;

      const { gripIndex } = gripForPick(geometry, hit.sticker, hit.poly);
      const mask = effectiveMask();
      if (gripIndex < 0 || !isValidTwist(geometry, gripIndex, mask)) return false;

      // Left turns one way, right the other — the original's convention.
      const move: Move = { g: gripIndex, d: button === 2 ? -1 : 1, s: mask };
      historyRef.current = pushMove(historyRef.current, move);
      enqueue(move, true);
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

    scramble() {
      const view = renderer();
      if (!geometry || !view) return;
      // Applied instantly rather than animated — watching sixty random twists is not interesting,
      // and the original does the same.
      stateRef.current = solvedState(geometry);
      const seed = (Math.random() * 0x7fffffff) | 0;
      const moves = scramble(geometry, { twists: fullScrambleLength(geometry), seed });
      let history = emptyHistory;
      for (const move of moves) {
        applyMove(geometry, stateRef.current, move);
        history = pushMove(history, move);
      }
      // The boundary is what makes the twist counter mean "moves you made", not "moves made".
      historyRef.current = pushMark(history, 'scramble');
      queueRef.current = [];
      animationRef.current = null;
      view.endTwist();
      view.setState(stateRef.current);
      setScrambled(true);
      refreshFlags();
    },

    toggleSlice(index) {
      chipMaskRef.current ^= 1 << index;
      setSlicemask(effectiveMask());
    },

    reset() {
      const view = renderer();
      if (!geometry || !view) return;
      stateRef.current = solvedState(geometry);
      historyRef.current = emptyHistory;
      queueRef.current = [];
      animationRef.current = null;
      view.endTwist();
      view.setState(stateRef.current);
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
