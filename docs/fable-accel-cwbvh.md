# fable-accel-cwbvh.md — the compressed wide BVH experiment (design authority)

**STATUS: BUILT & MEASURED Aug 9 2026 — VERDICT: NO-GO on this platform (the §1
clause applied; the occupant stays maintained-but-non-default as the documented
negative result).**

**The numbers (M1 Pro, ANGLE Metal, perf-cloud 200k spheres @512², 24f×3):**
- binary TLAS (params tier): **32.9 ms/frame** (30.8/32.9/34.9)
- CWBVH: **38.9 ms/frame** (39.8/38.9/38.8) — **0.85×**, well under the 1.15× go bar.
- Correctness: `cwbvh ≡ tlas` GPU equality — **Δmean 0.00%, rmse 0.00%** at 96spp
  (identical stream). The chain (collapse DP → conservative quantized pack →
  RGBA32UI upload → scalar octant walk) is exactly right; it is just not faster here.

**Reading:** the memory-tier savings (5 independent texels per ~6-deep walk vs
dependent 2-texel rounds ~18 deep) did not beat the scalar decode cost — the per-slot
byte extraction loop (8 slots × 6 planes of shifts/masks/ternaries) is exactly the ALU
the paper's PRMT/SWAR intrinsics made free, and Apple Silicon's texture path makes the
binary walk's small dependent fetches cheap. Meister §9's GPU skepticism is VINDICATED
for scalar WebGL2 on this hardware; Ylitie's win does not transfer without the
instruction-level and warp-level machinery. Re-open triggers: a platform where the
binary walk measurably starves on fetches (the perf witness would show it), or a
vectorized decode idea that kills the per-slot scalar loop. The first-ever WebGL2
CWBVH datum, either way — nobody had shipped one to find out.

Primary source (transcribe, don't re-derive): Ylitie, Karras, Laine — *Efficient
Incoherent Ray Traversal on GPUs through Compressed Wide BVHs*, HPG 2017
(research.nvidia.com/sites/default/files/publications/ylitie2017hpg-paper.pdf).
Secondary: Meister et al. 2021 (the BVH STAR — the skeptical counterweight, §6.4/§9);
Howard et al. 2019 (arXiv:1901.08088 — conservative quantization proven on sphere
data); tinybvh's OpenCL kernel (intrinsic-free traversal existence proof);
GLSL ES 3.00 spec (the op inventory, verified Aug 9 2026).

## 1. Why, and why it might not work (the honest frame)

Measured on this repo (perf-cloud, 200k spheres, M1 Pro @512²): traversal is
fetch-bound — halving leaf-record bytes bought 15%; the leaf-size sweep showed node
*count* is already SAH-optimal (leaf 2 beat 4 and 8). What remains is bytes-per-node
and dependent-fetch-round count. CWBVH attacks exactly these: 8-wide nodes cut tree
depth ~3× (fewer DEPENDENT fetch rounds — the survey's own latency argument, inverted
in our favor) and quantization cuts node bytes ~3.2×.

Both prior results bracket the expectation:
- Ylitie: 2.36–2.70× incoherent — but part of that is warp-utilization machinery
  (persistent threads, dynamic fetch, triangle postponing) that DOES NOT EXIST in a
  fragment shader. The memory tier (compressed nodes + compressed stack) is the
  paper's dominant incoherent-ray effect and survives.
- Meister §9 recommends binary + per-thread stack on GPUs ("gain not so significant").
- Ylitie Table 4: **4-wide uncompressed ≈ 1.06–1.17×** — there is no cheap middle
  step. 8-wide + compression, or stay binary.

Declared expectation: **1.3–2× on traversal-bound scenes; go/no-go at 1.15×** on
perf-cloud (below that, the complexity isn't paid for; the occupant stays as a
documented negative result). Nobody has shipped this on WebGL2 (three-mesh-bvh
issue #519, open since 2023) — either verdict is a real research datum.

## 2. Node format (Ylitie §3.1/§3.3, Fig. 4 — transcribed; 80 B = 5 RGBA32UI texels)

| field | size | content |
|---|---|---|
| `p` | 3 × f32 | quantization origin = the node's own AABB lo corner |
| `e_x e_y e_z` | 3 × u8 | per-axis power-of-two scale EXPONENTS (fp32 exponent bits) |
| `imask` | u8 | bit i ⇔ child slot i is an internal node |
| child base | u32 | index of first child node (children contiguous) |
| prim base | u32 | index of first leaf item (items contiguous) |
| `meta[8]` | 8 × u8 | per-slot: empty `0x00`; internal `0b001xxxxx`, low5 = slot+24; leaf: high3 = count in UNARY (≤3), low5 = item offset from prim base (< 24) |
| `q_lo`, `q_hi` | 6 × 8 u8 | quantized child planes, 1 byte each |

Texel packing (little-endian bytes within each u32; the ONE write-side truth is the
TS packer, mirrored by the GLSL decode — a round-trip vitest pins them):

```
texel 0: p.x p.y p.z | (e_x | e_y<<8 | e_z<<16 | imask<<24)        (3 floats via floatBitsToUint + 1 uint)
texel 1: childBase primBase | meta[0..3] | meta[4..7]
texel 2: qlo.x[0..3] qlo.x[4..7] qlo.y[0..3] qlo.y[4..7]
texel 3: qlo.z[0..3] qlo.z[4..7] qhi.x[0..3] qhi.x[4..7]
texel 4: qhi.y[0..3] qhi.y[4..7] qhi.z[0..3] qhi.z[4..7]
```

Floats ride `floatBitsToUint` on the CPU / `uintBitsToFloat` in-shader — legal because
the CHANNEL is RGBA32UI end to end (never bitcast packed bits through a FLOAT texture:
denormal flush / NaN canonicalization — verified platform rule). Leaves have NO node
structure — they are ranges of the existing leaf-item arrays (params-tier placement
records / frame records / triangles), untouched.

## 3. Quantization (Ylitie Eq. 1–3 — conservative by construction)

- `e_i = ceil(log2((B_hi,i − p_i) / 255))`, stored as the fp32 exponent byte
  (`2^e` decodes as `uintBitsToFloat(uint(e) << 23)` — EXACT, the power-of-two scale
  is why conservativeness survives decode).
- `q_lo = floor((b_lo − p)/2^e)`, `q_hi = ceil((b_hi − p)/2^e)` — boxes only GROW.
  Cost at 8 bits: +3.4% intersection tests (Ylitie Table 1). Correctness argument
  (Meister §5.5, Howard et al. §II): inflation adds visits, never removes them;
  t-pruning stays valid because the inflated box's t_near lower-bounds the true one.
- Degenerate-extent pin: a zero-width axis (axis-aligned quads/disks as future leaf
  types; empty slots) must still satisfy q_hi ≥ q_lo with the ceil — the packer
  asserts `q_hi > q_lo ∨ (b_hi == b_lo == p_i-grid-aligned)` and empty slots write
  q_lo = 255, q_hi = 0 (the paper's empty-box convention: hi < lo never intersects).

## 4. Collapse (Ylitie §3.4, Eq. 4–8 — the DP, transcribed)

Input: the EXISTING binned-SAH binary tree built with **leaf size 1** (collapse input
only — `buildBVHNodesFlat(boxes, n, 1)`; the shipped binary occupants keep their
leaf sizes). No SBVH (declared deviation: spatial splits are for long/thin/
overlapping primitives — Meister §9 — which describes none of our leaf classes; our
binary SAH is the quality baseline the collapse preserves).

Bottom-up over the binary tree: `C(n, i)` = cost of representing subtree n as a
forest of ≤ i wide roots, i ∈ [1,7]:

```
C(n,1) = min(C_leaf(n), C_internal(n))
C(n,i) = min(C_distribute(n,i), C(n,i−1))
C_leaf(n) = A_n · P_n · c_prim   if P_n ≤ P_max else ∞
C_internal(n) = C_distribute(n,8) + A_n · c_node
C_distribute(n,j) = min over 0<k<j of C(left,k) + C(right,j−k)
```

Constants (paper §5.1): `c_node = 1, c_prim = 0.3, P_max = 3`. The leaf-size sweep's
lesson (sphere test ≈ node step on our hardware) says c_prim ≈ 1 may fit spheres
better — **c_prim is a build knob swept by the perf witness** (0.3 and 1.0 arms),
not a guess. Decisions recorded, backtracked from C(root,1); ≤ 24 items per node
(the meta-byte offset range).

Child-slot ordering (declared deviation): the paper's auction-algorithm assignment is
replaced by the Garanzha–Loop octant heuristic the paper itself benchmarks as
retaining most of the benefit (§3.4: fancier orderings "essentially identical"): for
each child, compute the dominant diagonal `d_s` sign pattern from its centroid
relative to the parent centroid and place it in the matching slot (first-fit on
conflict). Octant traversal order then approximates front-to-back for every ray
octant with zero runtime sorting. Cost of this class of simplification, from the
paper's own Table 2: octant order ≈ 4–9% more node tests than true distance order,
~20% fewer than random.

## 5. Traversal (Ylitie §4, Alg. 1 — scalar port; the strength reductions)

Per ray: octant `oct = signbits(d)`, `octinv = 7 − oct`; per NODE: transform once
(`d'_i = 2^{e_i} / d_i`, `o'_i = (p_i − o_i) / d_i`), then each child plane is one
FMA (`t = q · d' + o'`). State: current node group in registers; `uvec2` stack
entries (node group: base + hits byte + imask; leaf group: base + count bits);
data-dependent `while` with a bounded counter (the ANGLE D3D unroller rule); NO
structs on the hot path (the Adreno precision rule).

GLSL ES 3.00 replacements for the paper's intrinsics (all verified available ops —
shifts, masks, `uintBitsToFloat`, `floatBitsToUint`; NO popc/bfind/PRMT in ES 3.00):

| paper op | scalar ES 3.00 form |
|---|---|
| `extract_byte(x, i)` | `(x >> (8u*i)) & 0xFFu` |
| `bfind` / find-MSB of hits | `int(floatBitsToUint(float(x)) >> 23) − 127` — exact for x < 2²⁴ (hits is 8-bit, leaf bits 24-bit: both covered) |
| `popc(imask & mask)` (≤ 8 bits) | SWAR: `v−=(v>>1)&0x55; v=(v&0x33)+((v>>2)&0x33); v=(v+(v>>4))&0xF` |
| `2^e` | `uintBitsToFloat(uint(e) << 23)` |
| PRMT sign-extend / packed-SWAR hitmask (§4.3) | plain per-child loop over 8 slots (the SWAR form is a throughput trick, not semantics) |
| VMIN/VMAX 3-way | `max(max(a,b),c)` |
| 128-bit loads | 5 adjacent `texelFetch`es on `u_data_nodes_q` — INDEPENDENT loads in one round (the latency win vs the binary walk's dependent 2-texel rounds) |

DROPPED (no fragment-shader analogue — declared and inert): persistent threads,
dynamic ray fetch, triangle postponing (R_t), warp ballots, shared-memory stack.
This is the utilization tier of the paper's speedup; the experiment measures what the
memory tier alone is worth here.

The far-plane 2-ulp guard (Ize 2013) applies to the decoded slab test exactly as in
the binary walk.

## 6. Storage & compiler integration

- New rail channel `data_nodes_q` (usampler2D, RGBA32UI) — role-shaped like the
  six float channels; ledger region per wide tree; budget: heaviest scenes sit at 13
  of 16 units, this is the 14th. Exact linkage: the channel and its uniform exist iff
  a cwbvh occupant is selected (ProgramDescription decision; seam-unused enforced).
- Node-count bound for the ledger: a collapsed 8-wide tree over L binary leaves has
  ≤ ceil((L−1)/7)·(node overhead) internal nodes; the padding bound is
  `5 · ceil(2·T/3)` texels (conservative — derived from P_max=3 forcing ≥ T/24 nodes
  min, ≤ (T-1)/3+1 worst-case single-child chains are impossible post-DP; the packer
  asserts the real count fits, assertFits pattern).
- Occupants: `estimator.instanceAccel: 'cwbvh'` FIRST (sphere clouds are the scale
  case). `estimator.meshTraversal: 'cwbvh'` second, only after the first proves out
  (triangle ranges as leaf items; Woop transforms NOT adopted — plain leaf reuse, the
  paper never compressed triangles).
- **Leaf-order resolution (build discovery, Aug 9):** the cwbvh collapse produces its
  OWN leaf permutation, which cannot equal the binary TLAS's (a wide node's leaf
  children interleave with internal children in binary order, and the 5-bit meta
  offsets cannot span it). Records are packed in leaf order, so the cwbvh occupant
  takes a SECOND placement-records region (same float channel, cwbvh order — ~1
  texel/instance duplicated; +5.6 MB at octic scale), allocated always (the
  sceneTable always-upload precedent: ONE scene layout serves every strategy).
  v1 pins, Validator-enforced: cwbvh ∧ (mesh prototypes ∨ frame-tier batches ∨
  per-instance attributes) → rejected — `Hit.element`'s leaf-order semantics stay
  moot under cwbvh until the attrs region gets the same twin treatment (deferred
  with the mesh front).
- Build lives in `components/accel/cwbvh/` (build core beside bvh/; the walk emitter
  as the occupant descriptor in intersection/index.ts — the family recipe).

## 7. Proof regime

**Vitest (structural):**
- Pack/decode round-trip: TS decoder mirrors the GLSL bit layout; random trees
  round-trip exactly (the inst-format gate pattern).
- Conservative-containment property: every original child box ⊆ decoded quantized
  box, on random and adversarial (degenerate-extent, tiny, huge-exponent) inputs.
- Collapse validity: every binary leaf appears exactly once in the wide tree; per-node
  child count ≤ 8, items ≤ 24, per-slot count ≤ 3; C(root,1) cost decreases vs the
  naive top-down grouping on reference scenes.
- A TS reference traversal (scalar, same algorithm) vs the binary walk's TS twin on
  random rays: identical nearest hits (the ground-truth twin — GLSL correctness then
  reduces to the round-trip gate + the equality witness).
- glslang static compile of the cwbvh programs.

**GPU witnesses:**
- `cwbvh ≡ tlas` equality arm on instance-params-twin (identical stream; near-exact
  gates — same candidates modulo quantization-inflated extra TESTS, which don't
  change any hit: meanTol 0.002, rmse 0.01, the tlas≡linear precedent).
- perf-cloud gains a `cwbvh` strategy arm — THE verdict row: go at ≥ 1.15× vs the
  binary params-tier median, on a quiet machine, one run, both arms same run.
- The full owner sweep stays green (cwbvh is opt-in; defaults untouched).

## 8. Staging

1. **Build core + reference twin (pure TS, no GLSL):** collapse DP + slot assignment
   + quantized packer + TS decoder + TS reference traversal; the vitest gates above.
2. **The walk:** RGBA32UI channel plumbing (ledger/engine texture upload/uniform),
   the generated instance-TLAS cwbvh walk, glslang, the equality witness, the
   perf-cloud arm. VERDICT here.
3. **Mesh BLAS front** (only on a go verdict): `meshTraversal: 'cwbvh'`, mesh
   twins, cacti/mesh perf arm.
4. Deferred regardless: compressed-leaf-only variant (Benthin 2018 — fallback if
   full cwbvh washes but memory matters), rebraiding (trigger: overlapping MESH
   instances — forest; vacuous for single-prim clouds), Ize robust traversal is
   already shipped (batch A).

## 9. Ledger of declared deviations from the paper

| deviation | justification |
|---|---|
| binned SAH input, no SBVH | our geometry has no long/thin/overlapping prims (Meister §9); quality baseline unchanged |
| Garanzha–Loop slot ordering, no auction | paper §3.4: approximate methods "essentially identical" |
| scalar hitmask loop, no §4.3 SWAR | throughput trick with no semantic content; ES 3.00 has no PRMT |
| no persistent threads / postponing / ballots | no warp model in fragment shaders; measured as the utilization tier we knowingly forgo |
| plain leaf items, no Woop/compressed triangles | paper itself stores raw triangles; our leaves are 1-texel sphere records already |
| `c_prim` swept (0.3 vs 1.0) | our leaf-size sweep measured sphere test ≈ node step on target hardware |
