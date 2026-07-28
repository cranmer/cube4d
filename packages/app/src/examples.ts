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
  readonly note: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    file: 'charles-3x3x3x3-191.log',
    puzzleId: '{4,3,3} 3',
    solver: 'Charles Doan',
    note: 'Shortest known 3⁴ solution — 191 twists',
  },
  {
    file: 'sebastian-3x3x3x3-bld.log',
    puzzleId: '{4,3,3} 3',
    solver: 'Sebastian',
    note: '3⁴ solved blindfolded, in 5,765 twists',
  },
  {
    file: 'andrew-luna_3x3x3x3-comp-assist.log',
    puzzleId: '{4,3,3} 3',
    solver: 'Andrew Luna',
    note: '3⁴, computer-assisted',
  },
  {
    file: 'andrey-5x5x5x5-1981.log',
    puzzleId: '{4,3,3} 5',
    solver: 'Andrey Astrelin',
    note: '5⁴ in 1,981 twists',
  },
  {
    file: 'daniel-2x2x2x2-46.log',
    puzzleId: '{4,3,3} 2',
    solver: 'Daniel',
    note: '2⁴ in 46 twists',
  },
  {
    file: 'anderson-2x2x2x2-computer-24.log',
    puzzleId: '{4,3,3} 2',
    solver: 'Anderson',
    note: '2⁴ in 24 twists, computer-assisted',
  },
  {
    file: 'liu-2x2x2x2-bld.log',
    puzzleId: '{4,3,3} 2',
    solver: 'Liu',
    note: '2⁴ blindfolded',
  },
  {
    file: 'matt_2x2x2x2_blind.log',
    puzzleId: '{4,3,3} 2',
    solver: 'Matt',
    note: '2⁴ blindfolded',
  },
];
