/**
 * Port of Don Hatch's FuzzyPointHashTable — a spatial hash keyed on a point, with fuzzy equality.
 *
 * This is the heart of every twist: rotate a sticker's centre by the twist matrix, look the result
 * up here, and the answer is the sticker slot it landed in. Get this wrong and twisting breaks in
 * ways that are hard to see.
 *
 * The scheme: snap each coordinate to a grid line (of spacing `bucketSize`, biased by `bigEps`),
 * and key on the resulting integer tuple. Two points that should be the same land on the same grid
 * indices; two points that should differ land on different ones — provided no coordinate ever falls
 * in the forbidden band `(littleEps, bigEps]` from a grid line, which would make the answer
 * ambiguous. That case throws rather than guessing, and the exception is worth keeping: it catches
 * real bugs.
 *
 * A grid cell is far larger than `bigEps` (1/128 against 1e-8), so two genuinely distinct points can
 * share a bucket. Buckets therefore hold a list and are scanned with the fuzzy comparison, exactly
 * as java.util.Hashtable does with `hashCode` and then `equals`.
 *
 * PRECISION: these epsilons are ABSOLUTE, and the puzzle catalog reaches a circumradius of 31.87,
 * making the tolerance 3.1e-10 relative — about 380x finer than float32 resolves. Everything here
 * must stay Float64.
 */

export class FuzzyException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuzzyException';
  }
}

interface Entry {
  readonly offset: number;
  readonly value: number;
}

export class FuzzyPointHash {
  private readonly buckets = new Map<string, Entry[]>();
  private readonly points: Float64Array;
  private readonly nDims: number;
  private readonly littleEps: number;
  private readonly bigEps: number;
  private readonly bucketSize: number;
  private readonly invBucketSize: number;

  /**
   * Defaults match the two call sites in PolytopePuzzleDescription (lines 366 and 672).
   *
   * @param points packed coordinates, `nPoints * nDims` doubles
   * @param nDims  coordinates per point
   */
  constructor(
    points: Float64Array,
    nDims: number,
    littleEps = 1e-9,
    bigEps = 1e-8,
    bucketSize = 1 / 128,
  ) {
    if (!(littleEps >= 0)) throw new Error('littleEps must be >= 0');
    if (!(littleEps <= bigEps)) throw new Error('littleEps and bigEps are out of order');
    if (!(1e4 * bigEps <= bucketSize)) throw new Error('bucketSize is not enough bigger than bigEps');
    this.points = points;
    this.nDims = nDims;
    this.littleEps = littleEps;
    this.bigEps = bigEps;
    this.bucketSize = bucketSize;
    this.invBucketSize = 1 / bucketSize;
  }

  /** Index every point in the backing array. Call once after construction. */
  indexAll(): this {
    const n = this.points.length / this.nDims;
    for (let i = 0; i < n; ++i) this.put(i * this.nDims, i);
    return this;
  }

  private put(offset: number, value: number): void {
    const key = this.keyAt(this.points, offset);
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push({ offset, value });
    else this.buckets.set(key, [{ offset, value }]);
  }

  /** Look up a point. Returns the stored value, or -1 if nothing matches. */
  get(query: Float64Array, queryOffset = 0): number {
    const bucket = this.buckets.get(this.keyAt(query, queryOffset));
    if (!bucket) return -1;
    for (const entry of bucket) {
      if (this.fuzzyEquals(query, queryOffset, entry.offset)) return entry.value;
    }
    return -1;
  }

  /**
   * Mirrors FuzzyPoint.equals: equal if every coordinate is within littleEps, unequal if any
   * exceeds bigEps, and an error if some coordinate lands in between — that would mean the two
   * points are neither the same nor distinct, which the whole scheme depends on never happening.
   */
  private fuzzyEquals(query: Float64Array, queryOffset: number, storedOffset: number): boolean {
    let someoneBiggerThanLittleEps = false;
    for (let i = 0; i < this.nDims; ++i) {
      const diff = Math.abs(query[queryOffset + i] - this.points[storedOffset + i]);
      if (diff > this.bigEps) return false;
      if (diff > this.littleEps) someoneBiggerThanLittleEps = true;
    }
    if (someoneBiggerThanLittleEps) {
      throw new FuzzyException(
        `point is neither equal nor unequal to a stored point ` +
          `(littleEps=${this.littleEps}, bigEps=${this.bigEps})`,
      );
    }
    return true;
  }

  /** Mirrors FuzzyPoint.hashCode, but keys on the grid-index tuple rather than a folded integer. */
  private keyAt(coords: Float64Array, offset: number): string {
    let key = '';
    for (let i = 0; i < this.nDims; ++i) {
      const coord = coords[offset + i];
      const gridIndex = Math.floor((coord + this.bigEps) * this.invBucketSize);
      const gridLine = gridIndex * this.bucketSize;
      const diff = Math.abs(coord - gridLine);
      if (this.littleEps < diff && diff <= this.bigEps) {
        throw new FuzzyException(
          `coordinate ${coord} is neither equal nor unequal to grid line ${gridLine} ` +
            `(littleEps=${this.littleEps}, bigEps=${this.bigEps}, bucketSize=${this.bucketSize})`,
        );
      }
      key += i === 0 ? gridIndex : ',' + gridIndex;
    }
    return key;
  }
}
