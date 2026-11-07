"""SW: for a fixed image table T_R = {g : d(o, g o) <= R}, with x and light centre c uniform in D
(Klein-uniform sampling, then hyperbolic-volume weighted): how far is the nearest image NOT in
T_R? Is the nearest image of c (from x) always in T_R? How many images lie within distance s of x?"""
import math, numpy as np
exec(open(__file__.replace("sw_tables.py", "sw_group_core.py")).read())
els = np.load(__file__.replace("sw_tables.py", "sw_elements.npy"))
O = np.array([0, 0, 0, 1.0])
J = np.array([1, 1, 1, -1.0])
dO = np.arccosh(np.maximum(1, (els @ O)[:, 3]))
rng = np.random.default_rng(11)


def sample_D(n):
    out = []
    while len(out) < n:
        k = rng.uniform(-KR, KR, (4 * n, 3))
        ok = np.all(k @ NORM.T <= T, axis=1)
        k = k[ok]
        w = 1 / (1 - (k * k).sum(1)) ** 2        # volume density in Klein coordinates
        keep = rng.random(len(k)) < w / w.max() * 0.999 if len(k) else []
        out += list(k[keep])
    k = np.array(out[:n])
    wv = 1 / np.sqrt(1 - (k * k).sum(1))
    return np.concatenate([k * wv[:, None], wv[:, None]], 1)


n = 3000
X = sample_D(n); C = sample_D(n)
GC = np.einsum('gij,nj->ngi', els, C)                 # images g c, (n, G, 4)
dd = np.arccosh(np.maximum(1, -(GC * J * X[:, None, :]).sum(2)))   # d(x, g c)
near = dd.argmin(1)
print("elements available:", len(els), "(complete up to d(o,go) <= 3.6)")
for R in (0.0, 2.0, 3.0, 3.5):
    inT = dO <= R + 1e-9
    nearest_in = inT[near].mean()
    dout = np.where(inT[None, :], np.inf, dd).min(1)
    print(f"T_R, R = {R}: |T| = {int(inT.sum()):3d}; nearest image in T: {100*nearest_in:6.2f}% of (x,c);"
          f" nearest image outside T: min {dout.min():.3f}, 5th pct {np.percentile(dout, 5):.3f}, median {np.median(dout):.3f}")
for s in (1, 2, 3, 4):
    cnt = (dd <= s).sum(1)
    print(f"images of c within distance {s} of x: mean {cnt.mean():6.2f}, max {cnt.max()}   "
          f"(vol(B_s)/vol = {math.pi*(math.sinh(2*s)-2*s)/11.199:.2f})")
print("d(x, nearest image): mean %.3f, max %.3f (covering radius of the orbit; <= circumradius 1.903)"
      % (dd.min(1).mean(), dd.min(1).max()))
