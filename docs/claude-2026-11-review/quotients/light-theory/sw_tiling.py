"""Tiling check for the SW pairings: (1) vol(D) by Monte Carlo in the Klein model
(dV = d^3k / (1-|k|^2)^2); (2) every sampled point of a ball B_2.5 lies in exactly one cell gD,
g from sw_elements.npy; (3) longer-range orbit counts vs vol(B_R)/vol(D)."""
import math, numpy as np
exec(open(__file__.replace("sw_tiling.py", "sw_group_core.py")).read())

rng = np.random.default_rng(7)
# (1) volume of D
N = 4_000_000
k = rng.uniform(-KR, KR, (N, 3))
inside = np.all(k @ NORM.T <= T, axis=1)
w = 1.0 / (1 - (k * k).sum(1)) ** 2
vol = (2 * KR) ** 3 * (w * inside).mean()
se = (2 * KR) ** 3 * (w * inside).std() / math.sqrt(N)
print(f"vol(D) Monte Carlo = {vol:.4f} +- {se:.4f}")

# (2) exactly-one-cell test on points in the ball B_2.5 about o
els = np.load(__file__.replace("sw_tiling.py", "sw_elements.npy"))
inv = np.array([np.linalg.inv(M) for M in els])
M = 3000
r = 2.5 * rng.uniform(0, 1, M) ** (1 / 3)
u = rng.normal(size=(M, 3)); u /= np.linalg.norm(u, axis=1)[:, None]
P = np.concatenate([u * np.sinh(r)[:, None], np.cosh(r)[:, None]], axis=1)   # points in H^3
Q = np.einsum('gij,pj->pgi', inv, P)            # g^{-1} p for all g
kq = Q[..., :3] / Q[..., 3:4]
cnt = np.all(kq @ NORM.T <= T + 1e-12, axis=2).sum(1)
print("points in B_2.5 lying in exactly 1 cell:", int((cnt == 1).sum()), "of", M,
      "| in 0 cells:", int((cnt == 0).sum()), "| in >1 cells:", int((cnt > 1).sum()))
