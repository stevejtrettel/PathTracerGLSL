# Euclidean-assumption inventory (bypass inventory) for H³ / S³ with 4-vector points

Scope: every GLSL file under src/ (96 files, all read or grepped) and the TypeScript that emits
GLSL or does geometry on the CPU (compiler/generate/features/*, components/**/*.ts,
compiler/plan + analyze where they do geometry, app/sceneData.ts, app/utils/*Pack*, camera basis,
App camera controls, authoring). Repo state: branch claudeapp, HEAD 818d433 (+ uncommitted docs).

Evidence used:
- Source read with `cat -n` / `sed -n` (line numbers below are from those reads) [checked-code].
- One complete grep (no truncation) over src/ for length( distance( normalize( cross( reflect(
  refract( MAX_DIST build_basis ambient_ Math.hypot `* t +` `+ t *` d2 inversesqrt placement_
  quat slab aabb AABB: 536 hits, saved as `grep_all.txt` next to this file. I reviewed the hits
  file by file; hits not listed below are comments, imports, type names, or sites listed as OK.
- Generated shaders for fog-area / cornell-area / cornell (all 6 cameras) / haze / fog-sky were
  dumped to `shaders/` here (script `dump.ts`, writes only to this folder) to see what the
  generators actually emit [checked-code].
- Numeric checks: `checks.ts`, `bitident.ts` (run with `npx tsx`, float64 unless Math.fround).

## Category codes

FLOW (point + velocity along a geodesic), DISTANCE, DENSITY (area density A(r) replacing r²),
CONNECTIONS (geodesics joining two points), FAR (far limit / sky), FRAME (tangent frame, metric
dot, normalize, reflect in tangent space), PLACEMENT (isometry instead of similarity), CHART
(BVH/triangles; also surface uv charts), CAMERA, OK (works unchanged; reason given).
Two codes I added, because some sites fit none of the above:
- TYPE = a spelling-only fix: a literal `vec3` (signature, `vec3(0.0)`, `formatVec3`) where the
  value is a Point/Direction. No math changes, but it fails to compile once Point is vec4.
- NUMERIC = a precision constant keyed to coordinate magnitudes.
SEAM = the definition inside the ambient occupant itself (replaced wholesale per space; not a
bypass, not counted in the bypass totals).

Subset column: S = reached by a program in the owner's first subset (SDF/analytic shapes,
area+point lights, pinhole/fisheye, homogeneous media; materials and placement are needed by
any scene so they count as S). X = behind a feature planned as a compile error at first
(meshes, instancing, light tree, CWBVH, table dispatch, GRIN, heterogeneous media,
spot/beam/directional, env image charts, ortho/thinlens/equirect/cylindrical). U = a feature
the owner did not name either way (needs a decision: equiangular, softbeam, AOVs,
GLSL-expression materials reading p, groups' constant composition is S).

## Key facts that change how sites classify

F1. In S³ (unit sphere in R⁴) a tangent vector at p is an ordinary R⁴ vector orthogonal to p,
and the metric is the R⁴ dot product. So raw `dot()` and `normalize()` on two tangent vectors
at the SAME point are already correct in S³ once Direction is vec4 [math]. In H³ they are
wrong: the metric is Minkowski. Example: a unit tangent vector at distance 2 from the origin
has Minkowski norm 1 but Euclidean norm 5.2257 [checked-num bitident.ts]. So FRAME sites below
are "H³ wrong, S³ right once vec4" unless they call `cross()`, which does not exist for vec4 in
GLSL (compile error in both) [mem: GLSL ES 3.00 defines cross() for vec3 only].
F2. Arc length is preserved by isometries and every 1-D medium formula speaks only arc length
t, so homogeneous media (Beer–Lambert, analytic distance sampling, delta tracking along a
segment) are curved-correct as written, provided scene_intersect returns arc length [math].
F3. float32 hyperboloid: cosh overflows at t = 89.416 [checked-num checks.ts #1], so
`ambient_geodesic(p, wi, MAX_DIST=1000)` overflows in H³. Storing a point at distance t as f32
leaves ⟨p,p⟩+1 residuals of 1e-3 at t=5, 1.67 at t=9, 22 at t=10 [checked-num #2] (agrees with
the "breaks down beyond ~9" figure).
F4. Small hyperbolic distances: acosh(f32 cosh d) has 100% relative error at d=1e-4 and 2.3%
at d=1e-3; asinh(|p.xyz|) is accurate to ~5e-8 [checked-num #3]. Any DISTANCE seam in H³ must
avoid acosh(-⟨p,q⟩) near 0 (use asinh of the transverse part or a two-term form).
F5. Sphere-light cone half-angle: sin θmax = sinh R / sinh d (H³), sin R / sin d (S³),
confirmed by brute-force tangent search to 5 digits at four (d,R) pairs; the Euclidean asin(R/d)
is off by 3× at d=3, R=0.5 in H³ [checked-num #6]. Solid angle × A(d) / (πR²) → 1 with
A = sinh² (H³), sin² (S³) [checked-num #7, derived from #6].
F6. Euclidean-authored SDFs: in the Klein chart of H³, d_H ≥ |x−y| for all 200,000 random
pairs (min ratio 1.0016), so a Euclidean SDF evaluated in an object's Klein coordinates is a
conservative (safe) step for sphere tracing in hyperbolic arc length [checked-num #4; the proof
is ds_H ≥ |dx| for the Klein metric, math]. In the gnomonic chart of S³ it is NOT conservative:
every pair with |x|<3 had d_S < |x−y|, ratio down to 0.12 [checked-num #5]. So "SDF shapes in
S³" needs a different chart or a declared scale factor — machinery flag M6.
F7. S³ connections are not unique: a light at q reaches p along the short arc (length d) and
the long arc (2π − d), both with density 1/sin² d [math]. If NEE samples only the short arc,
pt-nee (which drops BSDF-found emission at samplable emitters) loses the long-arc light, and
pt ≡ pt-nee fails. A BSDF ray that first meets the light at t > π has light-pdf 0 under a
short-arc sampler (any direction the sampler emits hits the light before π) [math].
F8. Bit-identity: a distance-based density seam (r = sqrt(d2), A = r·r) changes the f32 result
in 49% of random cases versus today's `d2 = dot(d,d)` [checked-num bitident.ts]. So E³ must keep
its current light-sampler expressions; a seam spelled in r cannot be threaded through E³ bodies
without changing bits. The light files already declare this ("METRIC EXEMPTION … curved spaces
get new bodies", e.g. lights/quad/quad.glsl:10-11) [checked-code].
F9. IEEE multiplication is commutative, so replacing the march's `ray.origin + t*ray.direction`
by `ambient_geodesic(o, d, t)` (`origin + dir*t`) is the same arithmetic [math]; whether a GPU
compiler contracts it into an FMA identically is not checked [unverified]; only
`npm run frames -- compare` would show it, `npm run digest` compares text only.

## Inventory, grouped by file

Format: `id | file:line | quote | CAT | sub | note`

### glsl/core
- C1 | glsl/core/structs.glsl:4-5 | `#define Point vec3` / `#define Direction vec3` | TYPE | S | lives in core, not in the ambient occupant; must move (or be set per space) before any vec4 space
- C2 | glsl/core/structs.glsl:91 | `float distance; // to the sampled point (MAX_DIST for the environment …)` | FAR | S | contract comment encodes "sky at MAX_DIST"
- C3 | glsl/core/math.glsl:11 | `#define MAX_DIST 1000.0` | FAR | S | H³: cosh overflow (F3); S³: owner wants exact 2π
- C4 | glsl/core/math.glsl:54-56 | `max(abs(p.x), max(abs(p.y), abs(p.z)))` in fp_uncertainty | NUMERIC | S | ignores p.w; hyperboloid coords grow like cosh d
- C5 | glsl/core/math.glsl:63-67 | `build_basis(vec3 n, out vec3 t, out vec3 b)` with `cross(up, n)` | FRAME | S | needs a tangent basis at p (callers: disk/softbeam/sphere lights, hg, rayleigh, disk_uv)
- C6 | glsl/core/microfacet.glsl:25-27 | `normalize(f.t * v.x + f.b * v.y + f.n * v.z)` | FRAME | S | combination OK; Euclidean normalize wrong in H³ (F1)
- C7 | glsl/core/placement.glsl:19-21 | `placement_qrot` `v + 2.0 * cross(q.xyz, …)` | PLACEMENT | S | rotation-only quaternion; curved needs a 4×4 isometry
- C8 | glsl/core/placement.glsl:24-26 | `placement_rigid(q, ts, p) = qrot(q,p) + ts.xyz` | PLACEMENT | S |
- C9 | glsl/core/placement.glsl:29-31 | `placement_dir` | PLACEMENT | S |
- C10 | glsl/core/placement.glsl:34-36 | `placement_normal` | PLACEMENT | S |
- C11 | glsl/core/placement.glsl:39-41 | `placement_scale(ts) = ts.w` | PLACEMENT | S | no homotheties in H³/S³: scale must be absorbed into shape params or rejected
- OK: ray.glsl:29-32 ray_spawn (ambient_dot + ambient_geodesic; arc length) [checked-code];
  math.glsl:12,28,39 EPS_INTERFACE / MARCH_CLEARANCE / SHADOW_BACKOFF (arc lengths);
  math.glsl:71-102 concentric_disk, Fresnel; march.glsl:12-20 (march_epsilon of arc length);
  microfacet.glsl:22-24 (to_local via ambient_dot), 29-54 (local vec3 math); interaction.glsl;
  structs_media.glsl (typed Point/Direction); math_media.glsl; data_texture.glsl.

### components/ambient (the seam occupant)
- SEAM | ambient/euclidean/euclidean.glsl:6-8 | `ambient_geodesic = origin + dir*t` | FLOW | returns point only — no velocity at t
- SEAM | euclidean.glsl:13-19 | `ambient_frame` with `cross(nn, t)` | FRAME |
- SEAM | euclidean.glsl:21-23 | `ambient_dot = dot` | FRAME |
- SEAM | euclidean.glsl:25-27 | `ambient_parallel_transport` | FRAME | never called anywhere [checked-code: grep outside ambient/ finds none]
- SEAM | euclidean.glsl:31-33 | `ambient_direction_to = normalize(to - from)` | CONNECTIONS | single-valued (F7)
- (ambient/index.ts:13-23: descriptor is `{type, glsl}` only; the only space gate today is
  Validator.ts:56-57 `Ambient space '…' not yet supported` [checked-code].)

### components/camera (GLSL)
- K1 | camera/pinhole/pinhole.glsl:11-17 | `vec3 forward = u_cameraForward; … make_ray(u_cameraPosition, dir, wl)` | CAMERA | S | the ndc→direction math is OK in the eye's tangent frame; only the world assembly (vec3 basis + position) changes
- K2 | camera/fisheye/fisheye.glsl:29-33 | `if (rho < 1e-6) return make_ray(u_cameraPosition, forward, wl);` | CAMERA | S |
- K3 | camera/fisheye/fisheye.glsl:36-38 | `cos(theta) * forward + sin(theta) * (…) … make_ray(u_cameraPosition, normalize(dir), wl)` | CAMERA | S | normalize also FRAME in H³ unless done in local vec3
- K4 | camera/thinlens/thinlens.glsl:22 | `focus_point = u_cameraPosition + dir * (u_focusDistance / dot(dir, forward))` | FLOW | X | straight line
- K5 | camera/thinlens/thinlens.glsl:28 | `origin = u_cameraPosition + lens.x * right + lens.y * up` | CAMERA | X | lens disk = exp map at the eye
- K6 | camera/thinlens/thinlens.glsl:29 | `normalize(focus_point - origin)` | CONNECTIONS | X |
- K7 | camera/orthographic/orthographic.glsl:18 | `origin = u_cameraPosition + ndc.x * … * right + …` | CAMERA | X | "parallel rays" has no canonical curved meaning
- K8 | camera/equirect/equirect.glsl:18-27 | world vec3 basis + `make_ray(u_cameraPosition, …)` | CAMERA | X | all math is in the eye's tangent space — as cheap as fisheye (see M8)
- K9 | camera/cylindrical/cylindrical.glsl:21-27 | same pattern | CAMERA | X | same remark

### components/lights (GLSL)
- L1 | lights/point/point.glsl:12-13 | `vec3 d = l.position - p; float d2 = dot(d, d);` | DISTANCE | S |
- L2 | lights/point/point.glsl:16 | `ls.wi = d * inversesqrt(d2)` | CONNECTIONS | S | S³: two arcs (F7)
- L3 | lights/point/point.glsl:18 | `ls.radiance = l.intensity / d2` | DENSITY | S | 1/sinh² d, 1/sin² d (F5)
- L4 | lights/quad/quad.glsl:15 | `Point q = l.corner + xi.x * l.edge1 + xi.y * l.edge2` | PLACEMENT | S | uniform-area point on a Euclidean parallelogram; a curved "quad" has no closed-form uniform-area map (M5)
- L5 | lights/quad/quad.glsl:16-17,21 | `vec3 d = q - p; float d2 = dot(d, d); … sqrt(d2)` | DISTANCE | S |
- L6 | lights/quad/quad.glsl:20 | `ls.wi = d * inversesqrt(d2)` | CONNECTIONS | S |
- L7 | lights/quad/quad.glsl:26 | `cos_l = dot(l.normal, -ls.wi)` | CONNECTIONS | S | needs the geodesic's arrival direction at q, not −wi from p
- L8 | lights/quad/quad.glsl:30 | `ls.pdf = d2 / (l.area * cos_l)` | DENSITY | S |
- L9 | lights/quad/quad.glsl:37 | pdf mirror `cos_l = dot(l.normal, -wi)` | CONNECTIONS | S |
- L10 | lights/quad/quad.glsl:39-40 | `vec3 d = light_p - p; return dot(d, d) / (l.area * cos_l)` | DENSITY | S |
- L11 | lights/disk/disk.glsl:17-20 | `build_basis(l.normal, t, b); … Point q = l.center + u.x * t + u.y * b` | PLACEMENT | S | geodesic disk: uniform-area sampling is closed form in H³/S³ (area 2π(cosh r−1) / 2π(1−cos r)) [math]
- L12 | lights/disk/disk.glsl:21-22,26 | `d = q - p; d2 = dot(d,d); sqrt(d2)` | DISTANCE | S |
- L13 | lights/disk/disk.glsl:25 | `ls.wi = d * inversesqrt(d2)` | CONNECTIONS | S |
- L14 | lights/disk/disk.glsl:31 | `cos_l = dot(l.normal, -ls.wi)` | CONNECTIONS | S |
- L15 | lights/disk/disk.glsl:35 | `ls.pdf = d2 / (PI * l.radius * l.radius * cos_l)` | DENSITY | S | πr² is also the Euclidean disk area
- L16 | lights/disk/disk.glsl:42 | pdf mirror cos | CONNECTIONS | S |
- L17 | lights/disk/disk.glsl:44-45 | `dot(d, d) / (PI * r * r * cos_l)` | DENSITY | S |
- L18 | lights/sphere/sphere.glsl:21-24 | `sin2_max = r*r / dc2` | DENSITY | S | cone angle law (F5)
- L19 | lights/sphere/sphere.glsl:27-28,35 | `to_c = l.center - p; dc2 = dot(to_c, to_c); if (dc2 <= r*r)` | DISTANCE | S |
- L20 | lights/sphere/sphere.glsl:49-52 | `w = to_c * inversesqrt(dc2); build_basis(w, t, b); ls.wi = normalize(…)` | FRAME | S | cone axis = direction_to(center) (CONNECTIONS) + tangent basis
- L21 | lights/sphere/sphere.glsl:57-60 | `proj = dot(to_c, ls.wi); perp = …; ls.distance = (dc2 - r*r) / (proj + sqrt(disc))` | FLOW | S | Euclidean root; must equal the sphere geometry's own root (byte-match pin)
- L22 | lights/sphere/sphere.glsl:67-70 | pdf mirror `dc2 = dot(to_c, to_c)` | DISTANCE | S |
- L23 | lights/softbeam/softbeam.glsl:27-32,36 | build_basis + `q = l.position + …; d2 = dot(d,d)` | PLACEMENT | U | same structure as disk
- L24 | lights/softbeam/softbeam.glsl:35,40 | `ls.wi = d * inversesqrt(d2)`; `cos_l = dot(l.direction, -ls.wi)` | CONNECTIONS | U |
- L25 | lights/softbeam/softbeam.glsl:45,52-55 | `d2 / (PI r² cos_l)`; pdf mirror | DENSITY | U |
- L26 | lights/mesh/mesh.glsl:38-42 | world vertices, `q = a*(1-su) + b*… + c*…` | CHART | X | flat triangles: fine in Klein/gnomonic chart, but area density then needs a chart Jacobian
- L27 | lights/mesh/mesh.glsl:44-49 | `d = q - p; d2 = dot(d,d); wi = d*inversesqrt(d2)` | DISTANCE | X |
- L28 | lights/mesh/mesh.glsl:54-55 | `gn = cross(b - a, c - a); cos_l = dot(normalize(gn), -ls.wi)` | CONNECTIONS | X |
- L29 | lights/mesh/mesh.glsl:61,71-74 | `d2 / (l.area * cos_l)`; pdf mirror | DENSITY | X |
- L30 | lights/spot/spot.glsl:16-25 | `d2 = dot(d,d) … intensity * (falloff / d2)` | DENSITY | X |
- L31 | lights/beam/beam.glsl:28-36 | `s = dot(rel, l.direction); radial = rel - s * l.direction` | FLOW | X | collimated beam = a family of parallel lines
- L32 | lights/directional/directional.glsl:21-22 | `ls.wi = -l.direction; ls.distance = MAX_DIST` | FAR | X | owner: directional only in E³

### components/geometry (GLSL) — every primitive needs per-space bodies
(With each object intersected in its own frame at the origin, these become canonical-shape
bodies per space. `_intersect`/`_interval` = closed-form root along a geodesic → FLOW;
`_sdf` → DISTANCE; `_normal` → FRAME; `_uv` → CHART.)
- G1 | geometry/sphere/sphere.glsl:8-10 | `length(p - sp.center) - sp.radius` | DISTANCE | S | H³: asinh(|p.xyz|) − R about the origin (F4)
- G2 | sphere.glsl:28-46 | `sphere_intersect` robust Euclidean quadratic | FLOW | S |
- G3 | sphere.glsl:49-51 | `normalize(p - sp.center)` | FRAME | S |
- G4 | sphere.glsl:59-74 | `sphere_interval` | FLOW | S | march bound for SDF shapes
- G5 | sphere.glsl:84-89 | `sphere_uv` | CHART | S |
- G6 | geometry/plane/plane.glsl:7-9 | `dot(p, pl.normal) + pl.offset` | DISTANCE | S | H³: asinh(⟨p,n⟩); S³: asin(⟨p,n⟩) (thurston-port.md)
- G7 | plane.glsl:14-19 | `t = -(dot(ray.origin, n) + offset) / dot(ray.direction, n)` | FLOW | S | H³: atanh form
- G8 | plane.glsl:22-24 | `return pl.normal` | FRAME | S | normal of a totally geodesic plane varies with p in the 4-vector model
- G9 | geometry/quad/quad.glsl:9-22 | plane root + Gram solve on `ray.origin + ray.direction * t - q.corner` | FLOW | S | the in-quad test is a CHART question (Klein-flat quad)
- G10 | quad.glsl:25-27 | `return q.normal` | FRAME | S |
- G11 | quad.glsl:33-41 | `quad_uv` | CHART | S |
- G12 | geometry/disk/disk.glsl:10-17 | plane root + `dot(local, local) <= r²` | FLOW | S | radius test needs DISTANCE
- G13 | disk.glsl:20-22 | `return d.normal` | FRAME | S |
- G14 | disk.glsl:28-35 | `disk_uv` with build_basis / length | CHART | S |
- G15 | geometry/box/box.glsl:7-10 | `box_sdf` | DISTANCE | S | no curved "box" with this formula; max of half-space SDFs is conservative [math]
- G16 | box.glsl:22-32 | `box_intersect` slab test `1.0 / ray.direction` | FLOW | S |
- G17 | box.glsl:36-42 | `box_normal` axis-picking | FRAME | S |
- G18 | box.glsl:47-58 | `box_interval` slab | FLOW | S | march bound for menger/apollonian
- G19 | geometry/cylinder/cylinder.glsl:11-15 | `cylinder_sdf` | DISTANCE | S | H³ tube about a geodesic has a closed form (thurston-port.md)
- G20 | cylinder.glsl:21-54 | `cylinder_intersect` | FLOW | S |
- G21 | cylinder.glsl:58-64 | `cylinder_normal` | FRAME | S |
- G22 | cylinder.glsl:69-103 | `cylinder_interval` | FLOW | S | march bound for torus/knob/bottle
- G23 | geometry/torus/torus.glsl:15-18 | `torus_sdf` | DISTANCE | S |
- G24 | torus.glsl:25-29 | `torus_uv` | CHART | S |
- G25 | geometry/menger/menger.glsl:18-38 | `menger_sdf` (Euclidean fold) | DISTANCE | S | meaningful only as "Euclidean SDF in a chart" (F6)
- G26 | geometry/apollonian/apollonian.glsl:29-51 | `apollonian_gasket` / `_sdf` | DISTANCE | S | same
- G27 | geometry/bottle/bottle.glsl:30-76 | smooth unions of Euclidean cylinders | DISTANCE | S | same
- G28 | geometry/knob/knob.glsl:47-138 | Euclidean SDF composition incl. `mat3` rotations | DISTANCE | S | same

### components/materials, volume_scattering, aov (GLSL)
- M1 | materials/lambert/lambert.glsl:23 | `normalize(f.t * (…) + f.b * (…) + n * cos_theta)` | FRAME | S | H³ wrong, S³ right (F1)
- M2 | materials/checker/checker.glsl:34 | same normalize | FRAME | S |
- M3 | materials/checker/checker.glsl:14 | `floor(hit.uv * mp.uv_scale)` | CHART | S | reads the shape's uv chart
- M4 | materials/mirror/mirror.glsl:27 | `normalize(2.0 * cos_i * n - wo)` | FRAME | S |
- M5 | materials/dielectric/dielectric.glsl:31 | `normalize(2.0 * cos_i * n - wo)` | FRAME | S |
- M6 | materials/dielectric/dielectric.glsl:39 | `normalize(-eta * wo + (eta * cos_i - cos_t) * n)` | FRAME | S |
- M7 | volume_scattering/hg/hg.glsl:13 | `c = dot(wi, -wo)` | FRAME | S | needs ambient_dot (no base point is passed: signature change)
- M8 | hg.glsl:29-30 | `vec3 t, b; build_basis(-wo, t, b)` | FRAME | S |
- M9 | hg.glsl:33 | `normalize(t * … + b * … + (-wo) * cos_theta)` | FRAME | S |
- M10 | volume_scattering/rayleigh/rayleigh.glsl:11 | `dot(wi, -wo)` | FRAME | S |
- M11 | rayleigh.glsl:24-25 | `build_basis(-wo, t, b)` | FRAME | S |
- M12 | rayleigh.glsl:28 | `normalize(…)` | FRAME | S |
- M13 | aov/normal/normal.glsl:8-10 | `vec3 n = … hit.frame.n; return n * …` | FRAME | U | a world-space normal picture has no meaning for a 4-vector tangent; would need the camera frame
- OK: ggx.glsl (all math in local vec3 via microfacet_to_local; :21 `normalize(wil + wol)` is
  local), rough_dielectric.glsl (local; :131 goes through microfacet_from_local = C6),
  lambert/checker eval+pdf (ambient_dot), dielectric/mirror cos_i (ambient_dot), albedo AOV.

### components/transport (GLSL)
- T1 | transport/techniques/kernel/kernel.glsl:13 | `environment_radiance(s.ray.direction, s.ray.wl)` | FAR | S | H³: needs the ideal endpoint of (origin, direction); E³: the direction
- T2 | transport/techniques/light/light.glsl:20 | `light_p = ambient_geodesic(hit.p, ls.wi, ls.distance)` | FAR | S | through the seam, but ls.distance = MAX_DIST for the sky overflows in H³ (F3)
- T3 | light.glsl:22 | `ambient_direction_to(shadow_ray.origin, light_p)` | CONNECTIONS | S | seam call; S³ two-arc issue only (F7)
- T4 | transport/techniques/light/light_medium.glsl:14 | same as T2 | FAR | S |
- T5 | transport/shadow/opaque/opaque.glsl:17 | `length(light_p - shadow_ray.origin) - SHADOW_BACKOFF` | DISTANCE | S |
- T6 | transport/shadow/media/media.glsl:39 | `length(light_p - seg_ray.origin) - SHADOW_BACKOFF` | DISTANCE | S |
- T7 | transport/volume/analytic/analytic.glsl:32 | `ms.exit_dir = ray.direction` | FLOW | S | the velocity at t, not at the origin
- T8 | transport/volume/delta_tracking/delta_tracking.glsl:111 | `ms.exit_dir = ray.direction` | FLOW | X |
- T9 | transport/techniques/equiangular/equiangular.glsl:25-28 | `D = pos - o; t_c = dot(D, d); h2 = dot(D,D) - t_c²` | CONNECTIONS | U | closest approach of a line to a point
- T10 | equiangular.glsl:31-35 | `t = t_c + h * tan(theta)`; `pdf_t = h / (… (h2 + (t-t_c)²))` | DENSITY | U | Euclidean equiangular law
- T11 | equiangular.glsl:44-47 | `to_light = pos - p_evt; d2 = …; wi = to_light / dist` | DISTANCE | U |
- T12 | equiangular.glsl:56 | `(intensity / d2)` | DENSITY | U |
- T13 | transport/volume/grin/grin.glsl:97-411 | all-vec3 Verlet ray integration (`r_next = r + h * T_half` :236,:353; `length(T)` :220,:347; `normalize(T_half)` :263,:378,:395; `grin_grad_n` :108-125) | FLOW | X | one row for the whole GRIN integrator; a curved version moves onto n² g
- T14 | grin.glsl:325 | `ms.exit_dir = ray.direction;` (the arm's straight-segment scatter) | FLOW | X | the bent exits :263,:378,:395 are covered by T13
- OK: analytic.glsl:9-43,49-51 (arc-length Beer–Lambert, F2); :31 exit_p via ambient_geodesic;
  emission.glsl; delta_tracking.glsl:75,110,143,168 (ambient_geodesic); kernel.glsl:16-34;
  kernel_phase.glsl:7-15 (`make_ray(p_evt, ps.wi)`); light.glsl:21,26; light_medium.glsl:15;
  media.glsl:33,58-59 (spawn + re-aim through the seam); math_mis.glsl.

### components/env (GLSL)
- V1 | env/equirect/equirect_map.glsl:15-20 | `equirect_uv(vec3 dir)` | FAR | S | lookup by a world direction; H³ needs the ideal-point direction (a unit vec3 on S²∞ — the function itself is then reusable)
- V2 | env/equirect/equirect.glsl:19-47 | chart dir/uv/sample as world vec3 | FAR | X | env image charts
- V3 | env/octahedral/octahedral.glsl:21-69 | same | FAR | X |
- V4 | env/sampler_cdf.glsl:13-21,26-52,61-64 | table pdf/sample over world directions | FAR | X | at p in H³ the visual sphere ↔ S²∞ map is a Möbius map with a Jacobian [math]
- V5 | env/sampler_cdf.glsl:73 | `ls.wi = vec3(r * cos(phi), y, r * sin(phi))` | FRAME | X | a world-axis direction, not a tangent vector at p
- V6 | env/sampler_cdf.glsl:78 | `ls.distance = MAX_DIST` | FAR | X |

### components/accel, intersection (GLSL) — all CHART, all X
- A1 | accel/bvh/bvh.glsl:28-36 | `bvh_aabb_hit` slab | CHART | X |
- A2 | bvh.glsl:44-53 | `bvh_aabb_hit_range` | CHART | X |
- A3 | bvh.glsl:59-61 | `bvh_aabb_contains` | CHART | X |
- A4 | accel/cwbvh/cwbvh.glsl:7-18 (+ generated walk) | quantized slabs | CHART | X |
- A5 | accel/light_tree/light_tree.glsl:28-34 | `base = phi / max(d2raw, …)` | DENSITY | X | variance only (importance), not bias
- A6 | light_tree.glsl:44-76 | box-normal bounds, `cos_c = dot(q.n, d)…` | CHART | X | variance only
- A7 | intersection/mesh/mesh.glsl:41-59 | Möller–Trumbore, `cross(e1, e2)` | CHART | X | straight in Klein/gnomonic charts (geometry-accel.md R1)
- A8 | mesh.glsl:84-113 | `mesh_test_range` incl. `dot(rd, nLocal) * dot(rd, gnorm)` :108 | CHART | X |
- A9 | mesh.glsl:116-140 | any / side ranges | CHART | X |
- A10 | mesh.glsl:162-191 | `mesh_nearest_bvh` `inv = 1.0 / rd`, `rd[axis]` | CHART | X |
- A11 | mesh.glsl:197-228 | `MESH_INSIDE_DIR` parity ray | CHART | X |
- A12 | mesh.glsl:231-261 | `mesh_box_dist2`, `mesh_point_tri_dist2` | DISTANCE | X | Euclidean closest point (containment rank)
- A13 | mesh.glsl:266-298,300-321 | closest / any BVH walks | CHART | X |

### compiler/generate/features/intersection.ts (emits GLSL)
- I1 | intersection.ts:382 | `'int scene_region_at(vec3 p)'` (also emitted at :1123) | TYPE | S |
- I2 | intersection.ts:389, 1562, 1578, 1612 | `ior_of(int region, vec3 p, …)` / `ior_of_material(…, vec3 p, …)` | TYPE | S |
- I3 | intersection.ts:418-421 | placement_* signatures `vec3 placement_rigid(vec4 q, vec4 ts, vec3 p)` | PLACEMENT | S |
- I4 | intersection.ts:509, 514 | `float sdf_<id>(vec3 p)` | TYPE | S | world point in, local evaluation inside
- I5 | intersection.ts:515-522 | driven SDF: `p = placement_rigid(…); float s = placement_scale(…)` | PLACEMENT | S |
- I6 | intersection.ts:525-531 | constant SDF: emitPlacementQuery + `scale * <sdf>` prefix | PLACEMENT | S | scale prefix assumes homothety
- I7 | intersection.ts:551 | `Ray lray = make_ray(<ro>, <rd>, ray.wl)` (local ray) | PLACEMENT | S | local frame = inverse isometry in curved spaces
- I8 | intersection.ts:559 | `lp = rayRef.origin + t * rayRef.direction` (normal/uv point) | FLOW | S |
- I9 | intersection.ts:601-630 | emitSdfPlacement: `formatMat3(Rt) * (ray.origin - t)`, `nWorld = mat3(R) * n` | PLACEMENT | S |
- I10 | intersection.ts:639-656 | emitPlacementQuery: `p - t`, `mat3 * p`, `p / s` | PLACEMENT | S |
- I11 | intersection.ts:677-681 | uvFill fallback `vec2(hit.p.x * UV_PLANAR_SCALE, hit.p.z * …)` | CHART | S | compiles with vec4 but reads world hyperboloid/R⁴ coords
- I12 | intersection.ts:709 | `ambient_frame(hit.p, <nWorld>)` | PLACEMENT | S | the seam call is fine; nWorld (local normal pushed to world) is the placement part
- I13 | intersection.ts:723-727 | placementRefs → `rigidInverse` vec4 literals | PLACEMENT | S |
- I14 | intersection.ts:753-754 | placed analytic arm: `make_ray(placement_rigid(…), placement_dir(…))`, `s = placement_scale` | PLACEMENT | S |
- I15 | intersection.ts:763, 765 | `<type>_normal(lray.origin + t * lray.direction, shape)`, uv at the same point | FLOW | S |
- I16 | intersection.ts:864-887 | emitMeshPlacement (`/ s` into unscaled mesh frame) | PLACEMENT | X |
- I17 | intersection.ts:904-907 | mesh hit fill `normalize(nWorld(nLocal))` | FRAME | X |
- I18 | intersection.ts:1008-1036 | instance leaf: `ro = placement_rigid(q, ts, ray.origin) / s` etc. | PLACEMENT | X |
- I19 | intersection.ts:1023-1026 | instance mesh hit fill normalize | FRAME | X |
- I20 | intersection.ts:1052-1053, 1062 | instance normal/uv at `lray.origin + t * lray.direction` | FLOW | X |
- I21 | intersection.ts:1145-1146 | placed region_at: `vec3 lp = placement_rigid(…); s = placement_scale` | PLACEMENT | S |
- I22 | intersection.ts:1162-1190 | tabled containment TLAS point walk | CHART | X |
- I23 | intersection.ts:1203-1210 | closed-mesh containment: local box test, `-ms * mesh_closest_bvh` | CHART | X |
- I24 | intersection.ts:1256-1269 | instanced containment `lp = placement_rigid(…) / s` | PLACEMENT | X |
- I25 | intersection.ts:1300-1321 | emitMeshPointQuery | PLACEMENT | X |
- I26 | intersection.ts:1343-1355 | table SDF leaf: `lp = lray.origin + t * lray.direction`, local ray | FLOW | X |
- I27 | intersection.ts:1396-1400 | `sdf_leaf_field_<type>(vec3 p, …)` placement_rigid | PLACEMENT | X |
- I28 | intersection.ts:1682 | `hit.t = MAX_DIST;   // running nearest = far clip` | FAR | S | S³: 2π; H³: a scene radius (F3)
- I29 | intersection.ts:1694 | `ambient_dot(ray.direction, hit.ng, hit.p) < 0.0` (side test) | FLOW | S | ray.direction is the tangent at the ORIGIN; the dot is taken at hit.p
- OK: :707 `hit.p = ambient_geodesic(…, t)` (arc length is isometry-invariant); :1693, :1701
  (probe via the seam); :1707 (`ambient_frame(hit.p, -hit.frame.n)`).

### components/geometry/index.ts, similarity.ts, descriptors (CPU + emitted GLSL)
- P1 | geometry/index.ts:146-157 | emitCtor: `${scale} * lit` per kind, `s*s` for area | PLACEMENT | S |
- P2 | geometry/index.ts:234 | march sample `${type}_sdf(ray.origin + ${at} * ray.direction, s)` | FLOW | S | F9 on bit identity
- P3 | geometry/index.ts:337-348 | emitSdfNormal: `normalize(k.xyy * sdf(p + k.xyy * NORMAL_EPSILON) + …)` | FRAME | S | taps must be exp-map offsets in a tangent frame; gradient raised by the metric
- P4 | geometry/index.ts:356-385 | derivedFold: point/vector/direction/length kinds | PLACEMENT | S |
- P5 | geometry/index.ts:406-452 | canonicalize / foldPlacementIntoParameters | PLACEMENT | S | the fold puts world positions into shape params; curved needs canonical shapes + an isometry
- P6 | geometry/index.ts:489-520 | classifyPlacement (`quatRotate(g.rotation, c)` :513) | PLACEMENT | S |
- P7 | geometry/index.ts:78-113 | primitiveBounds → AABB | CHART | X | used by table dispatch, light tree, world radius
- P8 | geometry/similarity.ts:13-261 (whole file) | Similarity = TRS + uniform scale; quat ops; similarityApply*/Compose/Inverse/rigidInverse | PLACEMENT | S | one row for the file; every export is Euclidean-similarity math
- P9 | geometry/plane/plane.ts:15, 39 | normal normalization; coupled `fold` (offset under g) | PLACEMENT | S |
- P10 | geometry/quad/quad.ts:13-30, 54, 59-60 | quadCross/quadNormal (`Math.hypot(cross)`), degeneracy, AABB | PLACEMENT | S | compile-time Euclidean normal; also feeds the quad light (one-sided pin)
- P11 | geometry/disk/disk.ts:16-19, 39, 41 | unitVec3 normal (canonicalize); bounds | PLACEMENT | S |
- P12 | geometry/{sphere,box,cylinder}/*.ts:21-23 and every primitive descriptor | `bounds(v)`; `similarityClosed: true/false` | PLACEMENT | S | "which rows absorb R" is a similarity-group fact
- P13 | geometry/boundCheck.ts:24-40, 66-120 | Euclidean field twins (`Math.hypot`), conservativeness + bound containment gates | DISTANCE | S | the SDF Lipschitz gate is w.r.t. the Euclidean metric
- P16 | components/descriptors.ts:445 + torus/menger/apollonian/knob/bottle `marchBound` facts | `marchBound: { type, values(v) }` — Euclidean bounding shape for the march | DISTANCE | S | the bound must contain the shape in the curved metric
- P14 | geometry/custom.ts:26-140 | defineSDF: scene-local Euclidean GLSL fields | DISTANCE | S | meaning in a curved space is undefined (F6)
- P15 | compiler/generate/schema.ts:25-31 | rowGlslType: `kind 'point' → 'Point'`, `'direction' → 'Direction'`, else `vec3` | TYPE | S | shape AND light rows become vec4 under a global Point=vec4 define, while shape bodies take local vec3 — see M3

### compiler/generate/features/lighting.ts, components/lights/*.ts
- Q1 | lighting.ts:410-424 | lightCtor: Point rows emitted with `formatVec3`; derived fields (quad normal/area) | TYPE | S | light geometry authored as Euclidean coordinates
- Q2 | lighting.ts:318 | `pos = ${formatVec3(...)}` in lighting_query_delta | TYPE | U | equiangular only
- Q3 | lights/quad/quad.ts:13-15, 42 | `quadArea = Math.hypot(...quadCross(e1, e2))` → derived `area` row read by the pdf | DENSITY | S | correctness, not just variance (quad.glsl:30,40)
- Q4 | lights/quad/quad.ts:46-47 | power `π · area · Le` | DENSITY | S | variance-only (pmf is mirrored in lighting_pdf) — OK for bias
- Q5 | lights/disk/disk.ts:33-35 | power `π² r² Le` | DENSITY | S | variance-only
- Q6 | lights/sphere/sphere.ts:24-26 | power `4π² r² Le` | DENSITY | S | variance-only
- Q7 | lights/quad/quad.ts:66, disk/disk.ts:59, sphere/sphere.ts:37, point/point.ts:30, spot/spot.ts:69, softbeam/softbeam.ts:72 (`treeBounds`) | Euclidean boxes | CHART | X | light tree
- Q8 | lights/mesh/mesh.ts:49-90 | world area / CDF `Math.hypot(cross)/2` | DENSITY | X |
- Q9 | lights/directional/directional.ts:28-29 + compiler/plan/Planner.ts:340-341, 982-1015 | sceneWorldRadius via `Math.hypot` of AABB corners | DISTANCE | X | directional power only
- Q10 | lights/softbeam/softbeam.ts:33-36, 66, 74 | power, cone geometry | DENSITY | U |
- Q11 | lighting.ts:459-474 | sceneRadiusEstimate: `Math.hypot(point row) + Σ length rows` → P(select env) | DISTANCE | S | variance-only (stated in its comment)
- OK: lights/point/point.ts:25 power `4π I` (a point light's power is 4π·I in any space — the
  full solid angle at the source is 4π) [math]; lighting.ts:447,449,665,668 (dispatch passes q.p).

### compiler/generate/features/environment.ts
- E1 | environment.ts:74-86 | constant-env sampler: `ls.wi = vec3(r*cos(phi), z, r*sin(phi))` | FRAME | S | world-axis direction; needs a tangent frame at p (uniform pdf 1/4π is then right in any space)
- E2 | environment.ts:81 | `ls.distance = MAX_DIST` | FAR | S |
- E3 | environment.ts:95, 101, 251 | `environment_radiance(vec3 dir, …)`, `environment_pdf(vec3 dir)` | FAR | S | the seam must hand the sky a far-direction (ideal point), not the ray's direction
- E4 | environment.ts:162 | image: `texture(u_envMap, equirect_uv(dir))` | FAR | S | lookup only (sampling is X)
- E5 | environment.ts:215 | procedural: `dir = env_rotate_cs(normalize(dir), u_envRotCS)` | FAR | S |
- OK: environment.ts:33-34 env_rotate_cs (rotates the sky's own S² — still meaningful on S²∞);
  :70-72 constant pdf 1/(4π).

### compiler/generate/features/camera.ts, components/camera/basis.ts, App controls
- K10 | camera.ts:86-103 | basis uniforms `u_cameraForward/Right/Up` (vec3, from cameraBasis) | CAMERA | S |
- K11 | camera.ts:112, 129-130 | `u_cameraPosition` vec3; params `camera.position`, `camera.target` vec3 | CAMERA | S | a curved pose is an isometry (mat4), not position+target
- K12 | components/camera/basis.ts:30-55 | look-at with `cross`, `Math.hypot`, world +Y up | CAMERA | S |
- K13 | app/extensions/OrbitControls.ts:220-231 | spherical-to-Cartesian orbit around target, `Math.sqrt(dx²+dy²+dz²)` | CAMERA | S | App layer
- K14 | app/extensions/KeyboardControls.ts:99-103, 272-296, 326-376 | `position += worldDir * distance`; target = position + 5·forward; Frame orthonormalize | CAMERA | S | App layer; the private Frame is the closest existing thing to a curved pose
- K15 | app/utils/vector3.ts:10, 44 | Euclidean normalize/length helpers for the controls | CAMERA | S |
- K16 | compiler/analyze/Validator.ts:846 | `Math.hypot(position − target) < 1e-8` | CAMERA | S |
- K17 | authoring/strategy.ts:13-18 | `withPose(strategy, position, target)` | CAMERA | S |
- OK: fisheye.ts / pinhole.ts / cylindrical.ts / orthographic.ts / thinlens.ts derived uniforms
  (u_tanFov, u_fisheyeK, u_cylFocal) are pure angle/pixel facts.

### compiler/generate/features/materials.ts
- R1 | materials.ts:253, 378 | `scene_material_properties(int id, vec3 p, …)` | TYPE | S |
- R2 | materials.ts:280, 554 | `scene_medium_properties(int mat, vec3 p, …)` | TYPE | S |
- R3 | materials.ts:286, 665 | `ior_at(int med, vec3 p, …)` | TYPE | X | GRIN
- R4 | materials.ts:941 | softbeam cone gate `step(cosδ, dot(wo, <vec3 axis literal>))` | FRAME | U | world-constant axis compared with a tangent vector at hit.p
- R5 | compiler/generate/values.ts:75 (expression rows) | GLSL-expression material/medium rows read `p` (world coordinates) | CHART | U | an author's `p.x` means a different thing on the hyperboloid

### components/transport TS (integrator, kernel, combiner)
- N1 | transport/integrators/pt/pt.ts:137 | `LightQuery(p, vec3(0.0), false)` | TYPE | S |
- N2 | transport/techniques/kernel/kernel.ts:35 | `LightQuery(ray.origin, vec3(0.0), false)` | TYPE | S |
- N3 | pt.ts:331 | `medium_sample(med_mat, s.ray, boundary ? hit.t : MAX_DIST, …)` | FAR | S | H³ with an ambient medium: an infinite segment; S³: 2π
- N4 | pt.ts:327 | equiangular `boundary ? hit.t : MAX_DIST` | FAR | U |
- N5 | pt.ts:410 | null interface: `s.ray = ray_spawn(hit, s.ray.direction)` | FLOW | S | continues with the ORIGIN direction; needs the velocity at hit.p
- N6 | pt.ts:420 | `Direction wo = -s.ray.direction;` | FLOW | S | same — every BSDF eval/sample receives it
- OK: combiner.ts:39 and :60-61 (`lighting_pdf(s.prev_query, s.ray.direction, …)`,
  `environment_pdf(s.ray.direction)`): the direction at the ray origin is the direction at the
  previous vertex, which is what the pdfs mean. Caveat: the origin was offset by hit.eps from
  q.p, so the vector is tangent at the offset point; O(eps) [math]. pt.ts:307 aov `vec3(0.0)`
  (a color); pt.ts:451 `ior_of(…, hit.p, …)`; accumulation.ts:26 `color_to_pixel(film,
  ray.direction, …)` (ray_dir is unused by both sensors: sensor/ideal/ideal.glsl:2,
  sensor/cie1931/cie1931.glsl:3).

### Planner / Validator / sceneData / packers / authoring (CPU)
- W1 | compiler/plan/Planner.ts:789-830 | transform resolution (quatNormalize, axis-angle) | PLACEMENT | S |
- W2 | compiler/analyze/Validator.ts:1586-1633, 1702-1710, 1317 | quaternion / axis / scale rules | PLACEMENT | S | scale > 0 rule assumes homotheties exist
- W3 | compiler/analyze/Validator.ts:1131-1135 | packed orientations unit-quat check | PLACEMENT | X | instancing
- W4 | compiler/sceneData.ts:145 | `transformAABB(primitiveBounds(…), similarityApplyPoint(residual, p))` | CHART | X | table
- W5 | app/sceneData.ts:44-116 | mesh-light packing, TLAS `resolveBox` (similarity-transformed AABBs), light-tree boxes | CHART | X |
- W6 | app/utils/instancePack.ts, packWorker.ts, lightTreePack.ts, lightTreeWorker.ts | AABB / similarity packing | CHART | X |
- W7 | components/intersection/instancing/instancing.ts:39-155, 235-254 | world boxes by quat-rotate·s+t; params-record fold | PLACEMENT | X |
- W8 | components/accel/bvh/bvh.ts:57-70, 95-140, 427-486 | emitted slab test; SAH centroids; transformAABB | CHART | X |
- W9 | components/accel/cwbvh/cwbvh.ts (77-470) | quantized slabs, per-node ray transform | CHART | X |
- W10 | components/accel/light_tree/light_tree.ts | Euclidean light boxes + cones | CHART | X |
- W11 | components/intersection/mesh/mesh.ts, topology.ts:21, 80-82 | local AABB, signed volume via cross | CHART | X |
- W12 | authoring/flatten.ts:77, 90, 118, 146-175 | group chains compose similarities (`similarityCompose`, size × parent scale) | PLACEMENT | S | constant groups are allowed in a first-subset scene unless rejected
- W13 | authoring/loadOBJ.ts:43-53 | face normals `Math.hypot(cross)` | CHART | X |
- W14 | authoring/loadInstances.ts:12-49, authoring/instance.ts | world AABB header, quats | CHART | X |
- OK: compiler/analyze/propertyValidation.ts:31 (`min-length` constraint on authored vectors —
  a validation of authored numbers, not a geometric law).

## Totals (counted by `awk` over the rows above; SEAM rows excluded)

Counted by `count.sh` over the rows above [checked-num count.sh]. A row is one function, block or
(for GRIN and similarity.ts) one whole file, so these are counts of places to change, not lines.

| category | rows | S (first subset) | X (compile error first) | U (undecided) |
|---|---|---|---|---|
| PLACEMENT | 37 | 29 | 7 | 1 |
| CHART | 32 | 6 | 25 | 1 |
| FRAME | 27 | 22 | 3 | 2 |
| FLOW | 24 | 17 | 7 | 0 |
| DISTANCE | 24 | 20 | 3 | 1 |
| FAR | 18 | 12 | 5 | 1 |
| DENSITY | 18 | 10 | 4 | 4 |
| CAMERA | 15 | 11 | 4 | 0 |
| CONNECTIONS | 12 | 8 | 2 | 2 |
| TYPE | 12 | 10 | 1 | 1 |
| NUMERIC | 1 | 1 | 0 | 0 |
| total | 220 | 146 | 61 | 13 |

Plus 5 SEAM rows (the Euclidean occupant's own definitions).

Of the 22 subset FRAME rows, 10 are raw `normalize`/`dot` on tangent vectors at one point
(C6, M1, M2, M4, M5, M6, M7, M9, M10, M12): wrong in H³, already right in S³ once Direction is
vec4 (F1). The other 12 need a tangent basis or a per-space normal in both spaces (C5, L20, G3,
G8, G10, G13, G17, G21, M8, M11, P3, E1).

Of the 17 subset FLOW rows: 9 are per-primitive closed-form roots (G2, G4, G7, G9, G12, G16,
G18, G20, G22 — per-space shape bodies), 3 are generated straight-line points (I8, I15, P2 —
respell through ambient_geodesic), 4 need the velocity at t (I29, N5, N6, T7), and 1 is the
sphere light's distance root (L21).

## Machinery flags (things that would add moving parts)

M1. Velocity at t. Five subset sites need the geodesic's velocity at the hit/event, not the
origin direction: I29 (side test), N5 (null continuation), N6 (wo), T7 (medium event
direction), and the FAR lookup T1. Plus I8/I15/P2 need the point (already via ambient_geodesic
if respelled). Fewest parts: one extra seam function returning the velocity (E³: returns d,
bit-identical), or `Hit` carrying the arrival direction filled once in the dispatcher.
[thought-through, not checked]
M2. Light samplers: every area/point sampler mixes DISTANCE, CONNECTIONS and DENSITY in a few
lines with E³-specific spellings (d2, inversesqrt). Threading a distance-based seam through the
E³ bodies changes bits (F8). The files already declare "curved spaces get new bodies". Fewest
parts: per-space light bodies for the subset kinds (point, sphere, disk), E³ untouched.
[thought-through, not checked]
M3. One `Point` typedef serves world points AND shape/light parameter rows (schema.ts:28-29) AND
local-frame shape bodies (`vec3 p` signatures). With objects at the origin of their own frame,
curved shapes are canonical (no center rows) and their bodies take 4-vector local rays. The
struct rows `kind: 'point'` (sphere center, quad corner, box center) have no curved meaning.
Deciding which rows exist per space is new machinery unless curved spaces get their own
(small) canonical shape list. [thought-through, not checked]
M4. Similarity → isometry: the whole placement fold (P1, P4-P6, P8-P12, I5-I14, I21, W1, W2,
W12) is Euclidean-similarity math. Curved needs a 4×4 isometry per object (thurston-style)
and no scale. The fold (placement baked into world-space params) is an E³ optimization that
curved spaces cannot use, so curved programs need the "placed arm" path for every object.
[thought-through, not checked]
M5. Quad light in curved space: no closed-form uniform-area sampling of a geodesic
quadrilateral; sampling in a chart needs a Jacobian. Disk (geodesic disk) and sphere lights
have closed forms (F5, L11 note). [math; not checked numerically for the disk]
M6. SDF meaning: Euclidean SDFs in a Klein chart are conservative in H³ (F6), so menger/
apollonian/bottle/knob/torus could be "Euclidean shapes drawn in the object's Klein chart" in
H³ — but not in S³'s gnomonic chart (F6). Supporting "any Euclidean SDF" in S³ needs a chart
with a known metric bound — new machinery. True curved SDFs exist for ball, half-space, tube
(thurston-port.md). The normal (P3) and the conservativeness gate (P13) also change.
M7. S³ connections (F7): either NEE enumerates both arcs per light sample (two shadow rays, the
long one longer than π) or pt-nee must count BSDF hits at t > π. Either is new machinery in the
transport; H³ and H²×R are uniquely geodesic. [math]
M8. Equirect and cylindrical cameras do everything in the eye's tangent space (only the final
basis/position assembly is CAMERA, K8/K9), so they would cost the same as fisheye. Leaving them
as compile errors saves nothing structural. [checked-code: equirect.glsl:9-27,
cylindrical.glsl:12-27]
M9. Camera pose: position+target with world +Y up (K10-K17) is a Euclidean pose; curved needs an
isometry uniform (mat4). The App controls (K13-K15) are App-layer and would need curved
versions or a frame-based control (KeyboardControls already keeps a private Frame).
M10. FAR in H³ with an ambient medium: medium_sample over [0, ∞) is fine analytically, but the
event point at large t loses the hyperboloid constraint in f32 (F3). Needs a declared far
radius for H³ (a truncation for the bias ledger) or local re-centering.

## Where H²×R differs (brief)

- FLOW: closed form splits into an H² part (cosh/sinh of λt) and a vertical part; thurston's
  version divides by λ, NaN for vertical rays (thurston-port.md).
- DISTANCE: sqrt(d_{H²}² + Δz²) — unique geodesics, so no F7 issue.
- DENSITY: direction-dependent — one transverse Jacobi field grows like sinh(λt)/λ, the other
  like t — so a density helper must take the direction (or both endpoints), not just r [math].
  The S³/H³ "A(r)" shape does not fit.
- FAR: the ideal boundary is not a round sphere; a sky must be parameterized by (H² ideal point,
  slope), not by a unit vec3.
- FRAME: tangent space T H² ⊕ R with metric diag(1,1,−1,1) on the 4-vector.
- PLACEMENT: the isometry group is Isom(H²) × Isom(R): authored rotations that tilt the vertical
  are not isometries, so the quaternion rotation field itself is too general.
- CHART: no chart makes geodesics straight lines, so slab/BVH (A1-A13) do not port even in a
  chart (geometry-accel.md R1).
- CAMERA: same as H³/S³ (an isometry pose).
