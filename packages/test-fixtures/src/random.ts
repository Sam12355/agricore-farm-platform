/**
 * A small seeded generator so fixtures are reproducible.
 *
 * Reproducibility matters more here than statistical quality: when a test fails on CI I
 * want to regenerate exactly the same data locally from the same seed. mulberry32 is
 * about thirty lines and good enough for choosing names out of a list.
 */
export class SeededRandom {
  private state: number;

  constructor(seed = 20260101) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Cannot pick from an empty list.');
    const item = items[this.int(0, items.length - 1)];
    // The index is in range by construction; this keeps noUncheckedIndexedAccess happy
    // without reaching for a non-null assertion, which the lint config bans.
    if (item === undefined) throw new Error('Unreachable: index out of range.');
    return item;
  }

  bool(trueProbability = 0.5): boolean {
    return this.next() < trueProbability;
  }

  /** Deterministic uuid-shaped identifier. Version 4 shape, not cryptographically random. */
  uuid(): string {
    const hex = '0123456789abcdef';
    let out = '';
    for (let i = 0; i < 36; i += 1) {
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        out += '-';
      } else if (i === 14) {
        out += '4';
      } else if (i === 19) {
        out += hex[this.int(8, 11)];
      } else {
        out += hex[this.int(0, 15)];
      }
    }
    return out;
  }
}
