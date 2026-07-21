# data/ — the data-driven scene substrate (rail v2)

**Taxonomy:** the second SUBSTRATE family (sibling of `accel/`): how scene-scale array
data reaches generated GLSL. Design authority: `docs/fable-data-rail.md` (owner-approved
Jul 20 2026). NOT an occupant family — no registry, no swappable axis: this is fixed
infrastructure every data-driven system stands on (meshes, BVHs, instancing, attributes,
mesh lights today; Stage B object tables, light BVH, majorant grids tomorrow).

**The model:** texture count scales with ROLE count, never tenant count. Six **channels**
(one RGBA32F texture each — `channels.ts`); tenants own **regions** (baked base offsets)
inside them; the **ledger** (`ledger.ts` — `planDataLayout`, deterministic from counts,
build-dependent sizes padded to declared proof-sketched bounds) is the ONE layout truth
the Planner (bakes literals) and the App (packs via `pack.ts`) both call. Stored ids are
tenant-LOCAL; only fetches add bases:
`texelFetch(u_data_<channel>, data_texel1d(base + local), 0)`.

**Division of labor:** families own what their bytes MEAN (packMesh, packPlacements,
packMeshLight live with their families and emit raw payloads); the rail owns where bytes
LIVE and how they are addressed. A family never mints a texture. The scene→tenant-counts
adapter (`dataTenantsOf`) lives compiler-side (it needs compiler predicates) and is the
one function feeding the ledger from both Planner and App.

**The budget (fable-data-rail §5):** the sampler roster is checked at feature-merge
against the SPEC floor of 16 fragment units — an over-budget program is an itemized
compile-time error, never a driver link failure. Worst case with everything live:
6 channels + blue-noise + accumulation (≤2) + env (≤4) ≤ 13.

**Adding a data-driven system:** claim regions in existing channels (`records`/`nodes`
are the generic homes) — extend `DataTenants`/the ledger with your tenant kind and its
padding bound, write your family packer, fetch with `base + local`. Adding a CHANNEL is
a design event against the unit budget, not a routine door.
