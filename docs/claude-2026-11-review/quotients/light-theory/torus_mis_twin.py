"""Partition-MIS twin in the cube 3-torus E^3/Z^3 (L = 1). Direct irradiance E(x) = int Le cos dw at
a floor point, every segment clipped at R_SEG (declared clip; all estimators share it). Tracing
is done in the universal cover (all translates of the scene), so this checks the light-image
bookkeeping, not a teleport tracer.

Estimators:
  A  BSDF only (cosine sampling)                                      -> must equal C
  B  partition MIS: NEE over S(x) (27 images around the nearest one, p ~ 1/max(d^2, r^2)),
     power heuristic; BSDF hit on image n gets NEE pdf p(n|x)*pA->w if n in S(x), else 0 -> = C
  B1 same with S(x) = {nearest image} (|S| = 1)                       -> = C
  B27u same with p uniform over the 27                                -> = C
  C  brute force: area-sample every image within R_SEG, sum             (reference)
  W1 WRONG: NEE over S(x) only, BSDF hits outside S(x) dropped        -> biased low
  W2 WRONG: NEE over the fixed patch {-1,0,1}^3 (cell-centred), BSDF membership tested
     against the x-centred block (two different S functions)          -> biased
"""
import math, sys, numpy as np
rng = np.random.default_rng(int(sys.argv[1]) if len(sys.argv) > 1 else 3)
R_SEG = 3.0
EPS = 1e-7
# scene in D = [0,1)^3: boxes (bmin, bmax); one-sided quad light facing -z
BOXES = [((0.0, 0.0, 0.0), (1.0, 1.0, 0.05)),          # floor slab (a plane in the torus)
         ((0.15, 0.55, 0.05), (0.45, 0.85, 0.50)),     # pillar
         ((0.60, 0.05, 0.40), (0.95, 0.25, 0.70))]     # floating block
QZ, QX, QY = 0.85, (0.80, 0.98), (0.55, 0.75)          # light near the x = 1 face on purpose
QA = (QX[1] - QX[0]) * (QY[1] - QY[0])
QC = np.array([(QX[0] + QX[1]) / 2, (QY[0] + QY[1]) / 2, QZ])
QR = 0.5 * math.hypot(QX[1] - QX[0], QY[1] - QY[0])
LE = 1.0
X = np.array([0.30, 0.20, 0.05]); NX = np.array([0, 0, 1.0])
SPAN = int(math.ceil(R_SEG)) + 1
CELLS = np.array([(i, j, k) for i in range(-SPAN, SPAN + 1) for j in range(-SPAN, SPAN + 1)
                  for k in range(-SPAN, SPAN + 1)], float)


CELLS = CELLS[np.linalg.norm(CELLS + 0.5 - X, axis=1) <= R_SEG + 0.9]   # cells a segment from X can reach


def seg_cells(y):
    """cells within reach of the segment X -> y (y a point)."""
    v = y - X; L2 = v @ v
    c = CELLS + 0.5
    s = np.clip(((c - X) @ v) / L2, 0, 1)
    dd = np.linalg.norm(X + s[:, None] * v - c, axis=1)
    return CELLS[dd <= 0.9]


def first_hit(o, d, tmax, cells=None):
    """o (3,), d (N,3), tmax (N,). Returns t, kind (0 none, 1 box, 2 light front, 3 light back), cell n."""
    N = d.shape[0]
    tbest = tmax.copy(); kind = np.zeros(N, int); ncell = np.zeros((N, 3))
    inv = 1.0 / np.where(np.abs(d) < 1e-30, 1e-30, d)
    for n in (CELLS if cells is None else cells):
        for bmin, bmax in BOXES:
            t0 = (np.array(bmin) + n - o) * inv; t1 = (np.array(bmax) + n - o) * inv
            tn = np.minimum(t0, t1).max(1); tf = np.maximum(t0, t1).min(1)
            hit = (tn <= tf) & (tn > EPS) & (tn < tbest)
            tbest[hit] = tn[hit]; kind[hit] = 1; ncell[hit] = n
        t = (QZ + n[2] - o[2]) * inv[:, 2]
        px = o[0] + t * d[:, 0] - n[0]; py = o[1] + t * d[:, 1] - n[1]
        hit = (t > EPS) & (t < tbest) & (px >= QX[0]) & (px <= QX[1]) & (py >= QY[0]) & (py <= QY[1])
        tbest[hit] = t[hit]; kind[hit] = np.where(d[hit, 2] > 0, 2, 3); ncell[hit] = n
    return tbest, kind, ncell


def cos_sample(N):
    u1, u2 = rng.random(N), rng.random(N)
    r = np.sqrt(u1); ph = 2 * math.pi * u2
    return np.stack([r * np.cos(ph), r * np.sin(ph), np.sqrt(1 - u1)], 1)


N0 = np.round(X - QC)                       # nearest light image to x (cube lattice: round)
BLOCK = np.array([N0 + np.array(v) for v in np.ndindex(3, 3, 3)]) - 1.0   # S(x): 27 images
PATCH = np.array([np.array(v) for v in np.ndindex(3, 3, 3)]) - 1.0        # fixed cell-centred patch


def weights(S, mode):
    if mode == 'uniform':
        return np.full(len(S), 1.0 / len(S))
    c = QC + S
    w = 1.0 / np.maximum(((c - X) ** 2).sum(1), QR * QR)
    return w / w.sum()


def nee(M, S, mode):
    """Returns per-sample NEE contribution with MIS weight vs cosine BSDF (power heuristic)."""
    p = weights(S, mode)
    idx = rng.choice(len(S), M, p=p)
    y = np.stack([QX[0] + rng.random(M) * (QX[1] - QX[0]), QY[0] + rng.random(M) * (QY[1] - QY[0]),
                  np.full(M, QZ)], 1) + S[idx]
    v = y - X; d = np.linalg.norm(v, axis=1); w = v / d[:, None]
    cosx = w @ NX; cosl = w[:, 2]
    ok = (cosx > 0) & (cosl > 0) & (d <= R_SEG)
    t, kind, _ = first_hit(X, w, d - 1e-6)
    ok &= kind == 0
    pl = p[idx] * d * d / (QA * np.maximum(cosl, 1e-30))
    pb = np.maximum(cosx, 0) / math.pi
    f = np.where(ok, LE * cosx / pl, 0.0)
    return f, f * pl ** 2 / (pl ** 2 + pb ** 2)


def in_set(n, S):
    return (np.abs(n[:, None, :] - S[None, :, :]).sum(2) < 0.5)


def bsdf(M, S, mode):
    """Returns per-sample BSDF-only contribution and its partition-MIS weighted version."""
    w = cos_sample(M)
    t, kind, n = first_hit(X, w, np.full(M, R_SEG))
    hitl = kind == 2
    f = np.where(hitl, LE * math.pi, 0.0)
    pb = w[:, 2] / math.pi
    memb = in_set(n, S)                       # (M, |S|)
    p = weights(S, mode)
    psel = (memb * p[None, :]).sum(1)         # p(n|x) if n in S(x), else 0
    cosl = np.maximum(w[:, 2], 1e-30)
    pl = psel * t * t / (QA * cosl)
    wmis = np.where(psel > 0, pb ** 2 / (pb ** 2 + pl ** 2), 1.0)
    return f, f * wmis, f * (psel > 0) * wmis, memb


def brute(Mper):
    tot = 0.0; outside = 0.0
    for n in CELLS:
        c = QC + n
        if np.linalg.norm(c - X) > R_SEG + QR:
            continue
        y = np.stack([QX[0] + rng.random(Mper) * (QX[1] - QX[0]), QY[0] + rng.random(Mper) * (QY[1] - QY[0]),
                      np.full(Mper, QZ)], 1) + n
        v = y - X; d = np.linalg.norm(v, axis=1); w = v / d[:, None]
        cosx = w @ NX; cosl = w[:, 2]
        ok = (cosx > 0) & (cosl > 0) & (d <= R_SEG)
        if not ok.any():
            continue
        t, kind, _ = first_hit(X, w, d - 1e-6, seg_cells(c))
        ok &= kind == 0
        val = QA * np.where(ok, LE * cosx * cosl / (d * d), 0).mean()
        tot += val
        if not in_set(n[None, :], BLOCK)[0].any():
            outside += val
    return tot, outside


M = 200_000
ms = lambda a: (a.mean(), a.std() / math.sqrt(len(a)), a.std())
C, Cout = brute(40_000)
print(f"C brute force          E = {C:.5f}   (images outside S(x): {Cout:.5f} = {100*Cout/C:.1f}%)")
fA, fB, fBin, memb = bsdf(M, BLOCK, 'importance')
m, se, sd = ms(fA); print(f"A BSDF only            E = {m:.5f} +- {se:.5f}  per-sample sd {sd:.3f}")
for name, S, mode in [('B  27 importance', BLOCK, 'importance'), ('B1 nearest only', BLOCK[13:14], 'importance'),
                      ('B27u 27 uniform', BLOCK, 'uniform')]:
    _, nw = nee(M, S, mode)
    _, bw, bin_, _ = bsdf(M, S, mode)
    tot = nw + bw
    m, se, sd = ms(tot)
    print(f"{name:22s} E = {m:.5f} +- {se:.5f}  per-sample sd (nee+bsdf pair) {sd:.3f}")
# W1: drop BSDF hits outside S(x)
_, nw = nee(M, BLOCK, 'importance'); _, _, bin_, _ = bsdf(M, BLOCK, 'importance')
m, se, _ = ms(nw + bin_); print(f"W1 drop outside S(x)   E = {m:.5f} +- {se:.5f}   (wrong)")
# W2: NEE samples the cell-centred patch, BSDF tests the x-centred block
_, nw = nee(M, PATCH, 'importance'); _, bw, _, _ = bsdf(M, BLOCK, 'importance')
m, se, _ = ms(nw + bw); print(f"W2 mismatched S        E = {m:.5f} +- {se:.5f}   (wrong)")
print("N0 (nearest image) =", N0, " | patch == block:", np.array_equal(np.sort(PATCH, 0), np.sort(BLOCK, 0)))
