/**
 * Real solves, from the MagicCube4D Hall of Fame.
 *
 * These are the actual files people emailed to Superliminal, some of them records. They are here
 * because they are the sharpest possible demonstration that this port is compatible: a `.log`
 * stores each move as a bare index into a generated grip array, with no symbolic notation to fall
 * back on, so if the geometry were off by one these would replay into nonsense rather than into a
 * solved puzzle.
 *
 * Only the eight version 3 files are listed. Six more exist on the Hall of Fame in log format
 * version 1, which the current MagicCube4D cannot open either — see fixtures/logs/README.md.
 */

export interface Example {
  readonly file: string;
  readonly puzzleId: string;
  readonly solver: string;
  /** How the community names the puzzle: 2⁴, 3⁴, 5⁴. */
  readonly puzzle: string;
  /**
   * Twists in the solution, counted the way the app counts them — moves after the scramble
   * boundary, excluding whole-puzzle rotations.
   *
   * Counted rather than read from the file header, because two of these headers disagree with
   * their own contents. Both were written by solver scripts rather than by MagicCube4D:
   * Anderson's declares 0 for what its filename calls a 24-twist solve, and Andrew Luna's declares
   * 135 where the moves come to 147. Using our own count keeps the list consistent with the twist
   * counter you watch while the solve plays.
   */
  readonly twists: number;
  /** What is notable about it, if anything. */
  readonly note?: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    file: 'charles-3x3x3x3-191.log',
    puzzleId: '{4,3,3} 3',
    solver: 'Charles Doan',
    puzzle: '3⁴',
    twists: 191,
    note: 'shortest known',
  },
  {
    file: 'andrew-luna_3x3x3x3-comp-assist.log',
    puzzleId: '{4,3,3} 3',
    solver: 'Andrew Luna',
    puzzle: '3⁴',
    twists: 147,
    note: 'computer-assisted',
  },
  {
    file: 'sebastian-3x3x3x3-bld.log',
    puzzleId: '{4,3,3} 3',
    solver: 'Sebastian',
    puzzle: '3⁴',
    twists: 5765,
    note: 'blindfolded',
  },
  {
    file: 'andrey-5x5x5x5-1981.log',
    puzzleId: '{4,3,3} 5',
    solver: 'Andrey Astrelin',
    puzzle: '5⁴',
    twists: 1981,
  },
  {
    file: 'anderson-2x2x2x2-computer-24.log',
    puzzleId: '{4,3,3} 2',
    solver: 'Anderson',
    puzzle: '2⁴',
    twists: 24,
    note: 'computer-assisted',
  },
  {
    file: 'daniel-2x2x2x2-46.log',
    puzzleId: '{4,3,3} 2',
    solver: 'Daniel',
    puzzle: '2⁴',
    twists: 46,
  },
  {
    file: 'matt_2x2x2x2_blind.log',
    puzzleId: '{4,3,3} 2',
    solver: 'Matt',
    puzzle: '2⁴',
    twists: 256,
    note: 'blindfolded',
  },
  {
    file: 'liu-2x2x2x2-bld.log',
    puzzleId: '{4,3,3} 2',
    solver: 'Liu',
    puzzle: '2⁴',
    twists: 336,
    note: 'blindfolded',
  },
];
