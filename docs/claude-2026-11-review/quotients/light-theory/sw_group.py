"""Seifert-Weber group from thurston-rebuild's construction (hyp/groups/seifert-weber/set.js),
in float64. Checks: dihedral angle 72 deg, face pairings map face to face, orbit growth vs
vol(B_R)/vol(SW), circumradius, injectivity radius. Hyperboloid model, coords (x,y,z,w),
<a,b> = a.xyz.b.xyz - a.w b.w, origin o = (0,0,0,1)."""
import itertools, math
import numpy as np

H = 0.996384497847316          # halfWidth from set.js:25 (inradius)
ROT = 3 * math.pi / 5          # set.js:26
PHI = 0.5 + 0.5 * math.sqrt(5)
J = np.diag([1, 1, 1, -1.0])
O = np.array([0, 0, 0, 1.0])


def mdot(a, b):
    return a[:3] @ b[:3] - a[3] * b[3]


def dist(a, b):
    return math.acosh(max(1.0, -mdot(a, b)))


def translation(u, s):
    u = np.asarray(u, float); u = u / np.linalg.norm(u)
    M = np.eye(4)
    M[:3, :3] += (math.cosh(s) - 1) * np.outer(u, u)
    M[:3, 3] = math.sinh(s) * u
    M[3, :3] = math.sinh(s) * u
    M[3, 3] = math.cosh(s)
    return M


def rotation(u, th):
    u = np.asarray(u, float); u = u / np.linalg.norm(u)
    K = np.array([[0, -u[2], u[1]], [u[2], 0, -u[0]], [-u[1], u[0], 0]])
    R = np.eye(3) + math.sin(th) * K + (1 - math.cos(th)) * K @ K
    M = np.eye(4); M[:3, :3] = R
    return M


dirs6 = [(0, 1, PHI), (0, 1, -PHI), (1, PHI, 0), (1, -PHI, 0), (PHI, 0, 1), (-PHI, 0, 1)]
normals = []
gens = []
for d in dirs6:
    u = np.array(d, float); u /= np.linalg.norm(u)
    shift = translation(u, -2 * H) @ rotation(u, ROT)      # set.js:79-80 (three.js multiply = post-multiply)
    inv = np.linalg.inv(shift)
    normals += [u, -u]
    gens += [shift, inv]          # shift applied when outside face +u; inv when outside -u

# --- Dirichlet domain in the Klein model: k.n <= tanh(H) for the 12 unit normals.
t = math.tanh(H)
verts = []
for i, j, k in itertools.combinations(range(12), 3):
    A = np.array([normals[i], normals[j], normals[k]])
    if abs(np.linalg.det(A)) < 1e-9:
        continue
    v = np.linalg.solve(A, np.full(3, t))
    if all(v @ n <= t + 1e-9 for n in normals):
        if not any(np.allclose(v, w) for w in verts):
            verts.append(v)
print("vertices:", len(verts))
kr = np.linalg.norm(verts[0])
print("circumradius (center to vertex) =", math.atanh(kr), " inradius =", H)

# dihedral angle between adjacent faces (share 2 vertices)
def Nhat(n):
    N = np.array([*n, t]); return N / math.sqrt(mdot(N, N))
angs = set()
for i, j in itertools.combinations(range(12), 2):
    shared = [v for v in verts if abs(v @ normals[i] - t) < 1e-9 and abs(v @ normals[j] - t) < 1e-9]
    if len(shared) == 2:
        angs.add(round(math.degrees(math.pi - math.acos(mdot(Nhat(normals[i]), Nhat(normals[j])))), 6))
print("dihedral angles (deg):", angs)

# --- each generator maps the +u face's vertex set onto the -u face's vertex set
def klein_to_hyp(k):
    w = 1 / math.sqrt(1 - k @ k); return np.array([*(k * w), w])
def face_verts(n):
    return [klein_to_hyp(v) for v in verts if abs(v @ n - t) < 1e-9]
ok = True
for f in range(12):
    src = face_verts(normals[f]); dst = face_verts(-normals[f])
    for p in src:
        q = gens[f] @ p
        if not any(np.allclose(q, r, atol=1e-9) for r in dst):
            ok = False
print("every generator maps its face's 5 vertices onto the opposite face's vertices:", ok)

# --- BFS over the group, pruned at R_max + circumradius (chain argument), keyed by orbit point.
rho = math.atanh(kr)
RMAX = 3.6
prune = RMAX + rho + 0.05
key = lambda M: tuple(np.round(M @ O, 7))
seen = {key(np.eye(4)): np.eye(4)}
frontier = [np.eye(4)]
while frontier:
    nxt = []
    for M in frontier:
        for g in gens:
            P = M @ g
            p = P @ O
            if dist(O, p) > prune:
                continue
            k = key(P)
            if k not in seen:
                seen[k] = P; nxt.append(P)
    frontier = nxt
els = list(seen.values())
ds = np.array([dist(O, M @ O) for M in els])
VOL = 11.19900  # SW volume (literature value, from memory; ratio below checks it)
print("elements found within prune radius:", len(els))
for R in [1.0, 2.0, 2.5, 3.0, 3.5]:
    n = int((ds <= R).sum())
    pred = math.pi * (math.sinh(2 * R) - 2 * R) / VOL
    print(f"R={R}: orbit points within R = {n:5d}   vol(B_R)/11.199 = {pred:8.1f}")
print("shortest d(o, g o), g != 1:", np.sort(ds)[1:4])

# --- global injectivity radius: min over sample points c in D of min_g d(c, g c) / 2
rng = np.random.default_rng(1)
near = [M for M, d in zip(els, ds) if 0 < d <= 2 * rho + 0.5]
best = 1e9
for _ in range(4000):
    k = rng.uniform(-kr, kr, 3)
    if any(k @ n > t for n in normals):
        continue
    c = klein_to_hyp(k)
    best = min(best, min(dist(c, M @ c) for M in near))
print("min over sampled c in D of min_g d(c, g c) (systole estimate, sampled):", best)
np.save(__file__.replace("sw_group.py", "sw_elements.npy"), np.array(els))
