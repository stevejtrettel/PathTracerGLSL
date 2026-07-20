# mesh — the triangle-mesh intersection engine (v0)

The intersection family's second occupant (after `raymarch`). It traverses triangle-soup
geometry supplied as data textures; the SHAPES it consumes are not primitives (no
`geometry/` folder) — a mesh is authored as a `MeshObject` and packed by `mesh.ts`.

## Data layout (packer → textures, all RGBA32F, NEAREST)

Per mesh, keyed by ordinal (`meshExternNames`):

| texture | texel | contents |
|---|---|---|
| `mesh_N_position` | 1/vertex | xyz (object-LOCAL) |
| `mesh_N_index` | 1/triangle | ijk vertex indices (stored as float — ≤ 16M is exact in f32) |
| `mesh_N_normal` | 1/vertex | xyz vertex normals (zeros when unauthored; read only when smooth) |
| `mesh_N_uv` | 1/vertex | xy vertex UVs (zeros when unauthored) |

Linear index → texel via `bvh_texel1d` at the fixed `MESH_TEX_WIDTH`. The compiler and the
app both import `MESH_TEX_WIDTH`/`meshExternNames` from `mesh.ts`, so the packed layout and the
`texelFetch` math cannot drift.

## Traversal (v0 brute force, BVH-ready)

`mesh_nearest_local` scans `[0, triCount)` with Möller–Trumbore (transcribed from
three-mesh-bvh), keeping the nearest hit under the running bound `hit.t`. `mesh_any_local` is
the any-hit occlusion form. The BVH upgrade (v1) wraps a node walk around the SAME leaf test —
only the scanned ranges change; nothing here does.

## Ray-into-local (t-preserving)

The generated per-mesh wrapper conjugates the world ray into the mesh's local frame by the
INVERSE similarity, WITHOUT re-normalizing the local direction — so the local parameter `t`
equals the world `t`:

    p_local(t) = M⁻¹(o_world + t·d_world) = ro + t·rd,   ro = M⁻¹o,  rd = M⁻¹d (unnormalized)

Constant placement folds `M⁻¹ = Rᵀ/s` into one mat3; driven placement reuses the §6.1
`placement_rigid/dir/normal` + `placement_scale` helpers (like the analytic arm). The local
geometric/smooth normal is rotated back to world by `R` alone (uniform scale never tilts it).

## v0 scope

Thin surface (no `scene_region_at` containment — the mesh region joins the thin set), single
material per mesh (one region), path-found emission (region_to = owner on a front hit; NEE
sampling of mesh emitters is deferred). See `docs/impl-plan-meshes.md`.
