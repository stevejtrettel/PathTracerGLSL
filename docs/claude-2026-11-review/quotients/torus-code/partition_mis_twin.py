"""Float64 twin: direct irradiance at a surface point in a flat 3-torus E^3 / (Lx Z + Ly Z + Lz Z).

Scene in the fundamental domain D = [-L/2, L/2]^3: one emitting sphere (Le = 1, opaque) and one
black occluder sphere. Irradiance E(x, n) = int_H Le(w) cos dw, where Le(w) = Le if the first
hit along (x, w) within the far clip FAR is an image of the light. Every lattice image within
FAR is ray-cast exactly (brute force over images), so occlusion by other images is real.

Estimators (each sample = one BSDF (cosine) direction + for NEE variants one light direction):
  pt                 cosine sampling only
  nee27-mis          NEE: uniform image in S = {-1,0,1}^3, cone sampling; power-heuristic MIS
                     with partition rule (BSDF hit on an image outside S: NEE pdf 0, weight 1)
  nee27-binary       same NEE, pt-nee combiner: BSDF hit weight 0 if image in S, else 1
  nearest-mis        S(x) = {nearest image of the light center}, p_sel = 1
  invd2-mis          S = 27 cells, p_sel(c) proportional to 1 / |center_c - x|^2
All must agree with pt (unbiasedness of partition MIS); per-sample variances compared.
Run: python3 -I partition_mis_twin.py
"""
import numpy as np

rng = np.random.default_rng(12345)
L = np.array([1.0, 1.3, 0.8])
FAR = 4.0                       # >= 2 * diam(D) = 3.65
LIGHT_C, LIGHT_R, LE = np.array([0.2, 0.1, -0.15]), 0.08, 1.0
OCC_C, OCC_R = np.array([-0.25, 0.3, 0.1]), 0.15
S27 = np.array([[i, j, k] for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1)])


def images(center, radius, x):
    """Lattice images (offset k, center) of a sphere within FAR + radius of x."""
    n = np.ceil((FAR + radius + L) / L).astype(int)
    ks = np.array([[i, j, k] for i in range(-n[0], n[0] + 1)
                   for j in range(-n[1], n[1] + 1) for k in range(-n[2], n[2] + 1)])
    cs = center + ks * L
    keep = np.linalg.norm(cs - x, axis=1) <= FAR + radius
    return ks[keep], cs[keep]


def first_hit(x, w, sph_c, sph_r):
    """Nearest hit t in (0, FAR) of rays (x, w[i]) against spheres; returns (t, index or -1)."""
    oc = x - sph_c                                  # (M,3)
    b = w @ oc.T                                    # (N,M)  w . (x - c)
    cc = np.sum(oc * oc, axis=1) - sph_r ** 2       # (M,)
    disc = b * b - cc
    sq = np.sqrt(np.maximum(disc, 0.0))
    t0 = -b - sq
    t1 = -b + sq
    t = np.where(t0 > 1e-9, t0, np.where(t1 > 1e-9, t1, np.inf))
    t = np.where(disc >= 0.0, t, np.inf)
    t = np.where(t < FAR, t, np.inf)
    idx = np.argmin(t, axis=1)
    tmin = t[np.arange(len(w)), idx]
    idx = np.where(np.isfinite(tmin), idx, -1)
    return tmin, idx


def frame(n):
    a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
    t = np.cross(n, a); t /= np.linalg.norm(t)
    return t, np.cross(n, t)


def cosine_dirs(n, N):
    u1, u2 = rng.random(N), rng.random(N)
    r, phi = np.sqrt(u1), 2 * np.pi * u2
    t, b = frame(n)
    z = np.sqrt(np.maximum(0, 1 - u1))
    return (r * np.cos(phi))[:, None] * t + (r * np.sin(phi))[:, None] * b + z[:, None] * n


def cone_one_minus_cos(dc2):
    s2 = LIGHT_R ** 2 / dc2
    return s2 / (1 + np.sqrt(np.maximum(0, 1 - s2)))


def cone_dirs(x, centers):
    """One cone sample toward each given sphere center (rows); returns w, pdf."""
    to_c = centers - x
    dc2 = np.sum(to_c * to_c, axis=1)
    omc = cone_one_minus_cos(dc2)
    u1, u2 = rng.random(len(centers)), rng.random(len(centers))
    wt = u1 * omc
    cos_t, sin_t = 1 - wt, np.sqrt(np.maximum(0, wt * (2 - wt)))
    phi = 2 * np.pi * u2
    a = to_c / np.sqrt(dc2)[:, None]
    helper = np.where((np.abs(a[:, 0]) < 0.9)[:, None], np.array([1.0, 0, 0]), np.array([0, 1.0, 0]))
    t = np.cross(a, helper); t /= np.linalg.norm(t, axis=1)[:, None]
    b = np.cross(a, t)
    out = t * (sin_t * np.cos(phi))[:, None] + b * (sin_t * np.sin(phi))[:, None] + a * cos_t[:, None]
    return out, 1.0 / (2 * np.pi * omc)


def selection(x, mode):
    """Image set S(x) (offsets) and selection probabilities p_sel."""
    if mode == 'nearest':
        k = np.round((x - LIGHT_C) / L).astype(int)   # nearest lattice image of the center
        return k[None, :], np.array([1.0])
    if mode == 'uniform27':
        return S27, np.full(27, 1 / 27)
    if mode == 'invd2':
        d2 = np.sum((LIGHT_C + S27 * L - x) ** 2, axis=1)
        w = 1 / d2
        return S27, w / w.sum()
    raise ValueError(mode)


def nee_pdf_of_image(x, kimg, mode):
    """NEE solid-angle pdf for the direction that hit light image kimg (rows); 0 if not in S."""
    S, ps = selection(x, mode)
    match = (kimg[:, None, :] == S[None, :, :]).all(axis=2)          # (n, |S|)
    p_sel = (match * ps[None, :]).sum(axis=1)                         # 0 when the image is not in S
    c = LIGHT_C + kimg * L
    return p_sel / (2 * np.pi * cone_one_minus_cos(np.sum((c - x) ** 2, axis=1)))


def run(x, n, N):
    lk, lc = images(LIGHT_C, LIGHT_R, x)
    ok, oc = images(OCC_C, OCC_R, x)
    sph_c = np.vstack([lc, oc])
    sph_r = np.concatenate([np.full(len(lc), LIGHT_R), np.full(len(oc), OCC_R)])
    nl = len(lc)
    res = {}
    # BSDF (cosine) samples, shared by all estimators
    wb = cosine_dirs(n, N)
    _, ib = first_hit(x, wb, sph_c, sph_r)
    is_light = (ib >= 0) & (ib < nl)
    pb_cos = np.sum(wb * n, axis=1) / np.pi
    res['pt'] = np.where(is_light, LE * np.pi, 0.0)
    for mode in ('uniform27', 'nearest', 'invd2'):
        S, ps = selection(x, mode)
        # NEE sample
        pick = rng.choice(len(S), size=N, p=ps)
        kk = S[pick]
        centers = LIGHT_C + kk * L
        wl, pdf_dir = cone_dirs(x, centers)
        cosl = np.sum(wl * n, axis=1)
        _, il = first_hit(x, wl, sph_c, sph_r)
        # visible iff the first hit is the SAME light image (same lattice offset)
        hit_k = np.where((il >= 0)[:, None] & (il < nl)[:, None], lk[np.clip(il, 0, nl - 1)], 99)
        vis = (hit_k == kk).all(axis=1) & (cosl > 0)
        p_nee = ps[pick] * pdf_dir
        p_bsdf_at_l = np.maximum(cosl, 0) / np.pi
        w_nee = p_nee ** 2 / (p_nee ** 2 + p_bsdf_at_l ** 2)
        nee_term = np.where(vis, LE * np.maximum(cosl, 0) / p_nee, 0.0)
        # BSDF side
        kb = lk[np.clip(ib, 0, nl - 1)]
        p_nee_at_b = np.zeros(N)
        idx = np.where(is_light)[0]
        p_nee_at_b[idx] = nee_pdf_of_image(x, kb[idx], mode)
        w_b = pb_cos ** 2 / (pb_cos ** 2 + p_nee_at_b ** 2)
        bsdf_mis = np.where(is_light, LE * np.pi * w_b, 0.0)
        res[f'{mode}-mis'] = nee_term * w_nee + bsdf_mis
        if mode == 'uniform27':
            bsdf_bin = np.where(is_light & (p_nee_at_b == 0), LE * np.pi, 0.0)
            res['uniform27-binary'] = nee_term + bsdf_bin
    return res


if __name__ == '__main__':
    cases = [
        (np.array([-0.3, -0.4, 0.25]), np.array([0.0, 1.0, 0.0])),
        (np.array([0.35, 0.5, -0.3]), np.array([-0.6, -0.5, 0.62])),
        (np.array([0.45, -0.55, 0.35]), np.array([0.3, 0.3, -0.9])),   # near a corner of D
    ]
    N, reps = 4000, 100
    for x, n in cases:
        n = n / np.linalg.norm(n)
        acc = {}
        for _ in range(reps):
            for k, v in run(x, n, N).items():
                acc.setdefault(k, []).append(v)
        print(f'x = {x}, n = {np.round(n, 3)}   ({N * reps} samples each)')
        pv = np.concatenate(acc['pt']); ref = pv.mean(); se_pt = pv.std() / np.sqrt(len(pv))
        for k, vs in acc.items():
            v = np.concatenate(vs)
            m, se = v.mean(), v.std() / np.sqrt(len(v))
            print(f'  {k:18s} mean {m:.6f} +- {se:.6f}   z vs pt {(m - ref) / max(np.sqrt(se**2 + se_pt**2), 1e-12):+6.2f}   var/sample {v.var():.4e}')
