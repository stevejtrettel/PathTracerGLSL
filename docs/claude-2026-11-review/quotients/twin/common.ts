// Shared helpers for the quotient-lighting twins: a seeded RNG (sfc32, one independent stream per
// estimator so that z-scores between estimators are independent tests) and running statistics.

export class Rng {
  private a: number; private b: number; private c: number; private d: number;
  constructor(seed: number) {
    // splitmix32 to spread the seed over the four words
    const sm = () => {
      seed = (seed + 0x9e3779b9) | 0;
      let z = seed;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = sm(); this.b = sm(); this.c = sm(); this.d = sm();
    for (let i = 0; i < 12; i++) this.next();
  }
  /** uniform in [0, 1) with 32 random bits */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
}

/** Running mean / variance (Welford). */
export class Acc {
  n = 0; mean = 0; m2 = 0; max = -Infinity;
  add(x: number) {
    this.n++;
    const d = x - this.mean;
    this.mean += d / this.n;
    this.m2 += d * (x - this.mean);
    if (x > this.max) this.max = x;
  }
  get variance() { return this.n > 1 ? this.m2 / (this.n - 1) : 0; }
  get se() { return Math.sqrt(this.variance / this.n); }
}

export const z = (a: Acc, b: Acc) => (a.mean - b.mean) / Math.sqrt(a.se ** 2 + b.se ** 2);
export const fmt = (x: number, d = 5) => x.toFixed(d);
