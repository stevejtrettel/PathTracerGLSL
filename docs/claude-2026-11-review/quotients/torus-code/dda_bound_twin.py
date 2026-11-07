"""Float32 twin of the proposed torus cell walk (3D DDA over cells D + L k, D = [-L/2, L/2]^3).

Checks, for random rays (origins anywhere, including far outside D and exactly on faces,
directions including axis-aligned and near-axis ones):
  1. cells visited <= the static bound N = 5 + ceil(FAR * sqrt(sum 1/L_i^2));
  2. t_enter is non-decreasing and every cell's local entry point lies in D up to rounding;
  3. the walk's cell sequence matches a float64 reference walk (same cells, same order).
Run: python3 dda_bound_twin.py
"""
import math
import numpy as np

f32 = np.float32


def walk(o, d, L, FAR, dtype):
    o, d, L = o.astype(dtype), d.astype(dtype), L.astype(dtype)
    FAR = dtype(FAR)
    k = np.floor(o / L + dtype(0.5))
    step = np.where(d >= 0, dtype(1), dtype(-1))
    big = dtype(3.0e38)
    def t_next(kk):
        with np.errstate(divide='ignore', invalid='ignore'):
            t = ((kk + dtype(0.5) * step) * L - o) / d
        return np.where(d != 0, t, big)
    tn = t_next(k)
    t_enter = dtype(0)
    cells, entries = [], []
    while True:
        cells.append(tuple(int(v) for v in k))
        local = o + d * t_enter - L * k
        entries.append((float(t_enter), local))
        t_exit = tn.min()
        if t_exit >= FAR:
            return cells, entries
        i = int(np.argmin(tn))
        k = k.copy(); k[i] += step[i]
        tn = t_next(k)
        t_enter = max(t_enter, t_exit)
        if len(cells) > 100000:
            raise RuntimeError('runaway')


rng = np.random.default_rng(7)
worst_ratio, worst_overshoot, mismatches, max_out = 0.0, 0.0, 0, 0.0
for trial in range(4000):
    L = rng.uniform(0.3, 3.0, 3)
    FAR = rng.uniform(1.0, 200.0)
    bound = 5 + math.ceil(FAR * math.sqrt(np.sum(1 / L ** 2)))
    kind = trial % 4
    o = rng.uniform(-0.5, 0.5, 3) * L
    if kind == 1:
        o = o + L * rng.integers(-1000, 1000, 3)          # camera far outside D
    if kind == 2:
        o[rng.integers(3)] = 0.5 * L[0] if False else o[0]  # placeholder, replaced below
        ax = rng.integers(3); o[ax] = 0.5 * L[ax] * rng.choice([-1, 1])   # exactly on a face
    d = rng.normal(size=3)
    if kind == 3:
        d = np.zeros(3); d[rng.integers(3)] = 1.0; d += rng.normal(size=3) * 1e-7   # near-axis
    d /= np.linalg.norm(d)
    c32, e32 = walk(o, d, L, FAR, f32)
    c64, _ = walk(o, d, L, FAR, np.float64)
    worst_ratio = max(worst_ratio, len(c32) / bound)
    if len(c32) > bound:
        worst_overshoot = max(worst_overshoot, len(c32) - bound)
    if c32 != c64:
        mismatches += 1
    ts = [t for t, _ in e32]
    assert all(b >= a for a, b in zip(ts, ts[1:]))
    for _, loc in e32:
        out = np.max(np.abs(loc) - 0.5 * L)   # >0 means outside D
        max_out = max(max_out, out)

print(f'max cells / bound      = {worst_ratio:.3f}   (must be <= 1)')
print(f'max overshoot of bound = {worst_overshoot}')
print(f'float32 vs float64 cell-sequence mismatches: {mismatches} / 4000')
print(f'max distance of a local entry point outside D: {max_out:.3e}')
