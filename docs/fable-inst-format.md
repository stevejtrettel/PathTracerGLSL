# fable-inst-format.md — the `.inst` file format: spec + writer's guide

**STATUS: v1, BUILT Aug 7 2026.** The practical companion to
`fable-instance-clouds.md` (the design authority — why the format is shaped this way).
This document is deliberately SELF-CONTAINED so it can be handed to a collaborator who
generates data and has never seen this repo: everything needed to write a valid `.inst`
file is here, including a complete Python writer.

An `.inst` file is a **render-ready instance cloud**: N placements of one shape
(position, size, color, orientation), plus optional named per-instance scalar columns
for later re-derivation. The renderer draws it with no further interpretation — all
science (how height became a radius, what palette encodes a class) is baked by whoever
writes the file.

---

## 1. What goes in the file — semantics first

| Column | Per instance | Required? | Meaning |
|---|---|---|---|
| positions | 3 × f32 | **yes** | world-space center |
| sizes | 1 × f32 | no (absent → 1.0) | **uniform scale**, strictly > 0. For the sphere shape this IS the world radius. Never a per-axis scale — placements are similarities. |
| colors | 3 × f32 | no | **LINEAR RGB** (not sRGB, not hex). Convert display colors with the sRGB→linear transfer before writing. Drives a material row (albedo by default) — values are reflectances, typically in [0,1]. |
| orientations | 4 × f32 | no (absent → identity) | **unit quaternions `[x, y, z, w]`** (Hamilton convention), identity = `(0,0,0,1)`. Pointless for spheres; meaningful for oriented shapes. |
| scalar columns | K × (1 × f32) | no (K = 0..n) | named per-instance data (e.g. `height`) — NOT rendered; inputs for scene-side re-derivation hooks (resize/recolor without regenerating the file). |

Practical rules learned the hard way:

- **Radius floor**: keep sizes ≥ **0.01 world units** in a scene of extent ~10 (10× the
  renderer's fixed ray-spawn epsilon of 0.001). Smaller spheres shadow-tunnel and
  develop shading acne. If your data wants finer grains, scale the whole cloud up.
- **Batch ceiling**: one file = one render batch; the compiler rejects batches over
  ~**4M instances** (the acceleration-structure texture bound at `DATA_TEX_WIDTH`
  4096). Split larger sets.
- **Sizes are baked, but not final**: the scene can multiply them (`sizeScale`) or
  recompute them from a scalar column (`size:` hook) at load — so bake your best
  current law AND ship the raw quantity (e.g. `height`) as a scalar column when you
  expect iteration.

## 2. Byte layout (version 1)

Little-endian throughout. All payload blocks are f32 and 4-byte aligned.

```
offset            size    field
0                 4       magic: the ASCII bytes 'INST'
4                 4       u32 version = 1
8                 4       u32 count N            (must be > 0)
12                4       u32 flags              bit0 = sizes present
                                                 bit1 = colors present
                                                 bit2 = orientations present
                                                 bits 3–31 RESERVED (must be 0;
                                                 readers reject unknown bits)
16                24      f32×6 AABB of the POSITIONS: min.x min.y min.z max.x max.y max.z
                          (positions only — do NOT inflate by radii; must be finite)
40                4       u32 K                  scalar column count (0 allowed)
44                K×32    column names: UTF-8, each zero-padded to exactly 32 bytes
                          (1–31 bytes of name; names must be unique)
44+32K            4       u32 P                  provenance byte length (0 allowed)
48+32K            P→pad4  provenance: UTF-8, zero-padded to a multiple of 4 bytes.
                          Write WHO/WHEN/FROM WHAT (e.g. "myscript v3 src=run17.csv
                          2026-08-07") — the renderer stamps this string into every
                          exported image, so a render is traceable to its data.
—— payload blocks, in exactly this order, each present iff flagged ——
positions         f32 × 3N     x0 y0 z0 x1 y1 z1 …  (must be finite — the encoder
                               rejects NaN/Inf, which would escape the header AABB)
sizes             f32 × N
colors            f32 × 3N     r0 g0 b0 …  (linear RGB)
orientations      f32 × 4N     x0 y0 z0 w0 …  (unit quaternions)
scalar columns    K blocks of f32 × N, in header name order
```

Total byte length must equal header + flagged blocks EXACTLY — the loader validates
this arithmetic and refuses truncated or padded files. It also enforces: magic,
version, N > 0, finite non-empty AABB, unique non-empty column names, sizes > 0,
|quaternion| = 1 within 1e-3, finite positions.

## 3. Writing one from JavaScript (this repo)

Never hand-roll the byte layout in JS — `tools/inst-format.mjs` is the single
write-side implementation, kept in lockstep with the loader by a round-trip test:

```js
import { encodeInstances } from './tools/inst-format.mjs';
import { writeFileSync } from 'node:fs';

const buffer = encodeInstances({
    positions,                        // Float32Array, 3N — required
    sizes,                            // Float32Array, N — optional
    colors,                           // Float32Array, 3N, LINEAR RGB — optional
    orientations,                     // Float32Array, 4N, unit [x,y,z,w] — optional
    scalars: { height },              // { name: Float32Array(N) } — optional
    provenance: 'my-converter v1 src=data.json 2026-08-07',
});
writeFileSync('test-data/mycloud.inst', Buffer.from(buffer));
```

The AABB is computed for you. `tools/make-inst-fixture.mjs` is a complete
from-scratch example. Converters for EXTERNAL schemas are deliberately not repo
surface — write them as untracked scripts beside your data (e.g. in `test-data/`),
importing this encoder; the renderer itself only ever reads `.inst`.

## 4. Writing one from Python (for data generators)

Complete, tested writer — numpy only:

```python
import struct
import numpy as np

def write_inst(path, positions, sizes=None, colors=None, orientations=None,
               scalars=None, provenance=""):
    """positions: (N,3) float; sizes: (N,); colors: (N,3) LINEAR RGB;
    orientations: (N,4) unit quats [x,y,z,w]; scalars: dict name -> (N,) float."""
    positions = np.asarray(positions, dtype="<f4")
    n = positions.shape[0]
    scalars = scalars or {}
    flags = (1 if sizes is not None else 0) \
          | (2 if colors is not None else 0) \
          | (4 if orientations is not None else 0)
    aabb = np.concatenate([positions.min(axis=0), positions.max(axis=0)])
    prov = provenance.encode("utf-8")
    prov_padded = prov + b"\0" * (-len(prov) % 4)

    with open(path, "wb") as f:
        f.write(b"INST")
        f.write(struct.pack("<3I", 1, n, flags))            # version, count, flags
        f.write(aabb.astype("<f4").tobytes())               # positions-only AABB
        f.write(struct.pack("<I", len(scalars)))            # K
        for name in scalars:                                # 32-byte names
            nb = name.encode("utf-8")
            assert 1 <= len(nb) < 32, f"column name '{name}' must be 1..31 bytes"
            f.write(nb + b"\0" * (32 - len(nb)))
        f.write(struct.pack("<I", len(prov)))               # provenance
        f.write(prov_padded)
        f.write(positions.tobytes())                        # blocks, fixed order
        if sizes is not None:
            f.write(np.asarray(sizes, dtype="<f4").tobytes())
        if colors is not None:
            f.write(np.asarray(colors, dtype="<f4").tobytes())
        if orientations is not None:
            f.write(np.asarray(orientations, dtype="<f4").tobytes())
        for name in scalars:
            f.write(np.asarray(scalars[name], dtype="<f4").tobytes())

def srgb_to_linear(c):
    """Display colors (e.g. from hex codes, /255) -> the linear RGB the file wants."""
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
```

Usage sketch for a point set with a height quantity:

```python
r = np.clip(0.15 / np.sqrt(height), 0.01, None)      # bake your radius law (floor 0.01!)
write_inst("mycloud.inst", xyz, sizes=r,
           colors=srgb_to_linear(rgb255 / 255.0),
           scalars={"height": height},
           provenance="clebsch-points v2 2026-08-07")
```

## 5. Rendering one (this repo)

Drop the file in `test-data/` (untracked, dev-server-served). A scene is one entry in
`demos/dataScenes.ts` — or from scratch:

```ts
import { loadInstances } from '../src/authoring/loadInstances.js';
import { instanceCloud } from '../src/authoring/instance.js';

const table = await loadInstances('/test-data/mycloud.inst');
const cloud = instanceCloud(table, {
    shape: 'sphere',                 // v1: sphere (cube deferred — fable-instance-clouds §8)
    material: 'point',               // a scene material; per-instance colors override it
    colorDrives: 'albedo',           // which material row the color column drives
    sizeScale: 0.5,                  // uniform rescale — no data needed
    // Re-derive sizes from a scalar column WITHOUT regenerating the file
    // (CPU-only, at load — laws never run on the GPU):
    // size: (cols, i) => 0.3 / Math.sqrt(cols.height[i]),
});
```

Retune loop: edit the hook/`sizeScale`, reload the page. Changing sizes re-packs data
textures only — shaders never recompile. Exports (`x`/`X` in the lab) stamp the file's
provenance string into the image metadata.

## 6. Validating a writer

The loader is the gate — a malformed file fails loudly with a specific message, never
renders wrong. To check a new writer end to end without the browser, run a few lines
through vite-node (ships with vitest):

```js
// check.mjs — npx vite-node check.mjs
import { readFileSync } from 'node:fs';
import { parseInstances } from './src/authoring/loadInstances.js';
const raw = readFileSync('test-data/mycloud.inst');
const t = parseInstances(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
console.log(t.count, Object.keys(t.scalars), t.provenance);
```

(The §4 Python writer was validated exactly this way.) The executable reference for
every rule in §2 is `tests/authoring/instFormat.test.ts`.
