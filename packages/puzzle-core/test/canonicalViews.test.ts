import { describe, expect, it } from 'vitest';

import {
  CANONICAL_VIEWS,
  canonicalViewById,
  nextCanonicalView,
  quarterTurn,
  tipView,
  viewpointCentredBy,
} from '../src/canonicalViews.js';
import { gramSchmidt, NICE_VIEW } from '../src/rotation.js';

const N = 4;

/** Apply the row-vector convention used everywhere here: `v · M`. */
function transform(v: readonly number[], mat: readonly number[]): number[] {
  const out = [0, 0, 0, 0];
  for (let j = 0; j < N; ++j) for (let i = 0; i < N; ++i) out[j] += v[i] * mat[i * N + j];
  return out;
}

function determinant4(m: readonly number[]): number {
  // Laplace along the first row; four is small enough that clarity beats cleverness.
  const minor = (skipRow: number, skipCol: number) => {
    const v: number[] = [];
    for (let i = 0; i < N; ++i)
      for (let j = 0; j < N; ++j) if (i !== skipRow && j !== skipCol) v.push(m[i * N + j]);
    return (
      v[0] * (v[4] * v[8] - v[5] * v[7]) -
      v[1] * (v[3] * v[8] - v[5] * v[6]) +
      v[2] * (v[3] * v[7] - v[4] * v[6])
    );
  };
  let det = 0;
  for (let j = 0; j < N; ++j) det += (j % 2 ? -1 : 1) * m[j] * minor(0, j);
  return det;
}

describe('canonical views', () => {
  it('offers the default plus one per signed axis', () => {
    expect(CANONICAL_VIEWS).toHaveLength(9);
    expect(CANONICAL_VIEWS[0].id).toBe('default');
    // The same view, but orthonormalised: the original quotes NICE_VIEW to three decimals, which
    // is not quite a rotation, and everything in this list has to be one exactly.
    CANONICAL_VIEWS[0].mat.forEach((x, i) => expect(Math.abs(x - NICE_VIEW[i])).toBeLessThan(0.002));
    expect(new Set(CANONICAL_VIEWS.map((v) => v.id)).size).toBe(CANONICAL_VIEWS.length);
  });

  it('are all genuine rotations, never reflections', () => {
    // A reflection would mirror the puzzle — chirality is real here, and a mirrored view would
    // teach the wrong thing about which way a twist goes.
    for (const view of CANONICAL_VIEWS) {
      expect(determinant4(view.mat), `${view.id} determinant`).toBeCloseTo(1, 9);
    }
  });

  it('are orthonormal', () => {
    for (const view of CANONICAL_VIEWS) {
      for (let i = 0; i < N; ++i) {
        for (let j = 0; j < N; ++j) {
          let dot = 0;
          for (let k = 0; k < N; ++k) dot += view.mat[i * N + k] * view.mat[j * N + k];
          expect(dot, `${view.id} rows ${i}·${j}`).toBeCloseTo(i === j ? 1 : 0, 9);
        }
      }
    }
  });

  it.each([
    ['right', [1, 0, 0, 0]],
    ['left', [-1, 0, 0, 0]],
    ['up', [0, 1, 0, 0]],
    ['down', [0, -1, 0, 0]],
    ['front', [0, 0, 1, 0]],
    ['back', [0, 0, -1, 0]],
    ['ana', [0, 0, 0, 1]],
    ['kata', [0, 0, 0, -1]],
  ])('%s puts its axis at the centre, farthest from the eye', (id, axis) => {
    // The renderer's 4D eye is on +W and projects with eyeW/(eyeW - w), so w = -1 is farthest away
    // and therefore projects to the small cell at the middle of the picture. The oblique rotation
    // composed onto each viewpoint fixes W, so it cannot disturb this.
    const view = canonicalViewById(id)!;
    transform(axis, view.mat).forEach((x, i) => expect(x).toBeCloseTo(i === 3 ? -1 : 0, 12));
  });

  it('are all the default view with a different cell in the middle', () => {
    // Each viewpoint should differ from the default only by which puzzle axis is aligned where —
    // never by how obliquely the 3D part is seen. Equivalently: strip the alignment and the oblique
    // rotation that remains is the same one, which is what makes them all look alike.
    const rows = (m: readonly number[]) =>
      [0, 1, 2, 3].map((i) => m.slice(i * N, i * N + N));
    const defaultRows = rows(CANONICAL_VIEWS[0].mat);
    for (const view of CANONICAL_VIEWS) {
      // Every row of a viewpoint must be, up to sign, some row of the default view.
      for (const row of rows(view.mat)) {
        const matched = defaultRows.some((d) =>
          d.every((x, i) => Math.abs(Math.abs(x) - Math.abs(row[i])) < 1e-9),
        );
        expect(matched, `${view.id}: row ${row.map((x) => x.toFixed(3))}`).toBe(true);
      }
    }
  });

  it('makes kata coincide with the default, since both centre the −W cell', () => {
    canonicalViewById('kata')!.mat.forEach((x, i) =>
      expect(x).toBeCloseTo(CANONICAL_VIEWS[0].mat[i], 12),
    );
  });

  it('cycles forwards and backwards, wrapping', () => {
    expect(nextCanonicalView('default', 1).id).toBe('right');
    expect(nextCanonicalView('default', -1).id).toBe('kata');
    expect(nextCanonicalView('kata', 1).id).toBe('default');
    // A dragged view belongs to no viewpoint; stepping forward should land on the first.
    expect(nextCanonicalView(null, 1).id).toBe('default');
    expect(nextCanonicalView(null, -1).id).toBe('kata');
  });
});

describe('turning to the next corner', () => {
  const nice = gramSchmidt(Float64Array.from(NICE_VIEW));

  function det4(m: Float64Array | readonly number[]): number {
    const minor = (skipRow: number, skipCol: number) => {
      const v: number[] = [];
      for (let i = 0; i < N; ++i)
        for (let j = 0; j < N; ++j) if (i !== skipRow && j !== skipCol) v.push(m[i * N + j]);
      return (
        v[0] * (v[4] * v[8] - v[5] * v[7]) -
        v[1] * (v[3] * v[8] - v[5] * v[6]) +
        v[2] * (v[3] * v[7] - v[4] * v[6])
      );
    };
    let det = 0;
    for (let j = 0; j < N; ++j) det += (j % 2 ? -1 : 1) * m[j] * minor(0, j);
    return det;
  }

  it('returns exactly where it started after four turns, from every viewpoint', () => {
    for (const view of CANONICAL_VIEWS) {
      let m: Float64Array | readonly number[] = view.mat;
      for (let i = 0; i < 4; ++i) m = quarterTurn(m, 1);
      for (let i = 0; i < N * N; ++i) expect(m[i], `${view.id} entry ${i}`).toBeCloseTo(view.mat[i], 9);
    }
  });

  it('leaves the centred cell alone', () => {
    // A viewpoint is a claim about which direction sits on the view's -W axis. Turning to another
    // corner must not change that, or the two controls would fight each other.
    for (const view of CANONICAL_VIEWS) {
      const turned = quarterTurn(view.mat, 1);
      for (let row = 0; row < N; ++row) {
        expect(turned[row * N + 3], `${view.id} W column, row ${row}`).toBeCloseTo(
          view.mat[row * N + 3],
          9,
        );
      }
    }
  });

  it('is a rotation, not a reflection', () => {
    for (const view of CANONICAL_VIEWS) {
      expect(det4(quarterTurn(view.mat, 1)), `${view.id} clockwise`).toBeCloseTo(1, 9);
      expect(det4(quarterTurn(view.mat, -1)), `${view.id} anticlockwise`).toBeCloseTo(1, 9);
    }
  });

  it('undoes itself', () => {
    const there = quarterTurn(nice, 1);
    const back = quarterTurn(there, -1);
    for (let i = 0; i < N * N; ++i) expect(back[i]).toBeCloseTo(nice[i], 9);
  });

  it('cycles the ring clockwise from the default view', () => {
    // Pinned against screenshots compared with hand-rotated reference images: from the default,
    // one clockwise turn must send the cell on the upper left round to the upper right. Puzzle axis
    // 0 is the upper-left cell there, and axis 1 the upper-right, so its row must move to axis 1's.
    const turned = quarterTurn(nice, 1);
    for (let j = 0; j < N; ++j) expect(turned[1 * N + j]).toBeCloseTo(nice[0 * N + j], 9);
  });
});

describe('tipping to a new centred cell', () => {
  it('reproduces the kata to down transition exactly', () => {
    // The motion this control generalises, named by the two viewpoints it connects.
    const tipped = tipView(canonicalViewById('kata')!.mat, 1);
    canonicalViewById('down')!.mat.forEach((x, i) => expect(tipped[i]).toBeCloseTo(x, 12));
  });

  it('is a three-cycle: three presses return exactly home', () => {
    for (const view of CANONICAL_VIEWS) {
      let m: Float64Array | readonly number[] = view.mat;
      for (let i = 0; i < 3; ++i) m = tipView(m, 1);
      for (let i = 0; i < N * N; ++i) expect(m[i], `${view.id} entry ${i}`).toBeCloseTo(view.mat[i], 9);
    }
  });

  it('undoes itself', () => {
    const there = tipView(CANONICAL_VIEWS[0].mat, 1);
    tipView(there, -1).forEach((x, i) => expect(x).toBeCloseTo(CANONICAL_VIEWS[0].mat[i], 9));
  });

  it('changes which cell is centred, where turning never does', () => {
    for (const view of CANONICAL_VIEWS) {
      expect(viewpointCentredBy(quarterTurn(view.mat, 1))?.id, `turn from ${view.id}`).toBe(
        viewpointCentredBy(view.mat)?.id,
      );
      expect(viewpointCentredBy(tipView(view.mat, 1))?.id, `tip from ${view.id}`).not.toBe(
        viewpointCentredBy(view.mat)?.id,
      );
    }
  });

  it('reaches only four of the eight centred cells, even combined with turning', () => {
    // Worth pinning, because it is the natural thing to assume otherwise. Tipping and turning
    // generate a group of 48 orientations — a quarter of the 4-cube's 192 rotations — and every one
    // of them centres a *negative* axis. Reaching +X, +Y, +Z or +W needs a third move that reverses
    // a direction, which neither of these does: turning fixes W, and tipping is a pure axis cycle
    // with no sign changes.
    type Mat = Float64Array | readonly number[];
    const key = (m: Mat) => Array.from(m, (x) => x.toFixed(5)).join(',');
    const start: Mat = CANONICAL_VIEWS[0].mat;
    const visited = new Map<string, Mat>([[key(start), start]]);
    let frontier: Mat[] = [start];
    while (frontier.length) {
      const next: Mat[] = [];
      for (const m of frontier) {
        for (const c of [tipView(m, 1), tipView(m, -1), quarterTurn(m, 1), quarterTurn(m, -1)]) {
          if (!visited.has(key(c))) {
            visited.set(key(c), c);
            next.push(c);
          }
        }
      }
      frontier = next;
    }
    expect(visited.size).toBe(48);
    const centred = new Set(
      [...visited.values()].map((m) => viewpointCentredBy(m)?.id).filter(Boolean),
    );
    expect([...centred].sort()).toEqual(['back', 'default', 'down', 'left']);
  });
});
