"""Point light (intensity I = 1) in the cube 3-torus, L = 1. NEE sums the 27 images in the block
S(x) = n0 + {-1,0,1}^3, n0 = round(x - c) (nearest image). Every image outside S(x) is LOST (a delta
light cannot be hit by BSDF rays). Lost fraction = sum_{n not in S} V cos/r^2 / sum_all V cos/r^2.

Scenes:
 slab  : one plane z = 0 (floor = ceiling). Visible images: (a, b, 0), all of them.
 tubes : solid cube with three orthogonal square tubes of half-width a through the cell centre
         ("jungle gym"); light at the junction; visibility by sampling points along the segment.
 balls : spheres of radius r at the lattice points; free path from random void points, to show a
         finite horizon R_h < 1.5 (then the 27-block is exact: lost fraction 0).
"""
import math, numpy as np
rng = np.random.default_rng(5)


def slab(h, R=400):
    a = np.arange(-R, R + 1)
    A, B = np.meshgrid(a, a, indexing='ij')
    x = np.array([0.3, 0.2]); c = np.array([0.5, 0.5])
    rho2 = (x[0] - c[0] - A) ** 2 + (x[1] - c[1] - B) ** 2
    e_surf = h / (rho2 + h * h) ** 1.5
    n0 = np.round(x - c)
    inS = (np.abs(A - n0[0]) <= 1) & (np.abs(B - n0[1]) <= 1)
    tail = 2 * math.pi * h / math.sqrt(R * R + h * h)        # integral of the cut-off tail (unit density)
    tot = e_surf.sum() + tail
    # medium receiver at height h/2 below the light (no cosine): partial sums grow like 2*pi*ln R
    e_med = [(1 / (rho2[(np.abs(A) <= r) & (np.abs(B) <= r)] + (h / 2) ** 2)).sum() for r in (10, 100, 400)]
    return (tot - e_surf[inS].sum()) / tot, e_med


print("slab (2-D horizon), surface receiver on the floor, light at height h:")
for h in (0.05, 0.1, 0.25, 0.5, 0.9):
    f, em = slab(h)
    print(f"  h = {h:4}: lost fraction = {100*f:6.2f}%   | medium receiver partial sums R=10,100,400: "
          f"{em[0]:.2f}, {em[1]:.2f}, {em[2]:.2f} (diverges like 2 pi ln R)")


def in_tubes(p, a):
    q = p - np.floor(p) - 0.5
    ax, ay, az = np.abs(q[..., 0]) < a, np.abs(q[..., 1]) < a, np.abs(q[..., 2]) < a
    return (ay & az) | (ax & az) | (ax & ay)


def tubes(a, recv='surface', R=12):
    c = np.array([0.5, 0.5, 0.5])
    if recv == 'surface':
        x = np.array([0.5 + 0.3, 0.5, 0.5 - a + 1e-9]); nx = np.array([0, 0, 1.0])
    else:
        x = np.array([0.5 + 0.3, 0.5, 0.5]); nx = None
    n0 = np.round(x - c)
    s = np.linspace(0, 1, 4000)[1:-1]
    tot = lost = 0.0
    rng_ = range(-R, R + 1)
    for i in rng_:
        for j in rng_:
            for k in rng_:
                y = c + (i, j, k); v = y - x; r = np.linalg.norm(v)
                cos = 1.0 if nx is None else v @ nx / r
                if cos <= 0 or r > R:
                    continue
                if not in_tubes(x[None, :] + s[:, None] * v[None, :], a).all():
                    continue
                e = cos / (r * r)
                tot += e
                if np.abs(np.array((i, j, k)) - n0).max() > 1:
                    lost += e
    return lost / tot, tot


print("tubes (1-D horizons; images visible only along the receiver's tube), radius-12 image ball:")
for a in (0.1, 0.2, 0.3):
    fs, _ = tubes(a, 'surface')
    fm, _ = tubes(a, 'medium')
    print(f"  half-width a = {a}: lost fraction surface receiver = {100*fs:5.2f}%   medium receiver (on axis) = {100*fm:5.2f}%")
# analytic check for the on-axis medium receiver: sum over m of 1/(m+d)^2 along +-x
d = 0.3
allm = np.arange(-10**6, 10**6 + 1)
e = 1 / (allm - d) ** 2
print("  on-axis medium receiver, exact 1-D series (all images visible along the tube): lost =",
      f"{100*(e.sum() - e[np.abs(allm) <= 1].sum())/e.sum():.2f}%")


def balls_horizon(r, M=200_000):
    """free path from random void points in random directions to the first lattice sphere."""
    p = rng.random((M * 3, 3))
    q = p - np.round(p)
    p = p[(q * q).sum(1) > r * r][:M]
    u = rng.normal(size=(len(p), 3)); u /= np.linalg.norm(u, axis=1)[:, None]
    best = np.full(len(p), np.inf)
    for n in np.array([(i, j, k) for i in range(-6, 8) for j in range(-6, 8) for k in range(-6, 8)], float):
        oc = p - n; b = (oc * u).sum(1); cc = (oc * oc).sum(1) - r * r
        disc = b * b - cc
        t = -b - np.sqrt(np.maximum(disc, 0))
        hit = (disc > 0) & (t > 0)
        best = np.where(hit, np.minimum(best, t), best)
    return best


for r in (0.72, 0.75, 0.8):
    fp = balls_horizon(r)
    print(f"balls r = {r}: sampled max free path = {fp.max():.3f}  (inf = escaped the 13-cell window: {np.isinf(fp).sum()})"
          f"  mean = {fp[np.isfinite(fp)].mean():.3f}")
