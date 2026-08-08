# The `.inst` point-cloud format — writer's one-pager

*Handoff doc for anyone producing point data to render in Steve's path tracer. Emit one
`.inst` file per cloud; we drop it in and render it — nothing else is needed from your
side. (Full spec, if you ever need it: `fable-inst-format.md` in the renderer repo.)*

## What a file contains

One cloud = N spheres. Per point you provide:

| column | per point | required? | notes |
|---|---|---|---|
| position | 3 × float32 | **yes** | world-space center |
| radius | 1 × float32 | no (→ 1.0) | must be > 0; see the floor rule below |
| color | 3 × float32 | no | **LINEAR RGB** — convert display/hex colors with sRGB→linear first (helper below) |
| orientation | 4 × float32 | no (→ identity) | unit quaternion `[x,y,z,w]` — irrelevant for spheres, skip it |
| scalar columns | K × float32 | no | any named per-point quantities (height, mass, error…) — not rendered, but they let us re-derive radii/colors on our side without you regenerating the file. **When in doubt, include the raw quantity.** |

Rules of thumb that make renders work on the first try:

- **Radius floor**: keep radii ≥ **0.01** in a cloud of overall extent ~5–20 units.
  Smaller spheres break the renderer's ray-offset epsilon (shadow artifacts). If your
  natural coordinates are tiny, multiply all positions by a constant instead of
  shrinking radii.
- **Count ceiling**: ≤ ~4 million points per file.
- **Provenance**: put a short "who/when/from-what" string in the file — it gets stamped
  into every exported image, so renders stay traceable to your data version.

## Byte layout (version 1, little-endian, all payload float32)

```
0          4     magic: ASCII 'INST'
4          4     uint32 version = 1
8          4     uint32 N (point count, > 0)
12         4     uint32 flags: bit0 radii, bit1 colors, bit2 orientations
16         24    float32×6: min x,y,z then max x,y,z of the POSITIONS (not inflated by radii)
40         4     uint32 K (scalar column count, 0 allowed)
44         K×32  column names, UTF-8, each zero-padded to exactly 32 bytes (1–31 byte names, unique)
44+32K     4     uint32 P (provenance byte length)
48+32K     P     provenance UTF-8, zero-padded to a multiple of 4 bytes
then, in this exact order, each block present iff its flag is set:
  positions  f32×3N | radii f32×N | colors f32×3N | orientations f32×4N | K scalar blocks f32×N
```

File length must equal header + flagged blocks exactly — the loader validates this and
tells you precisely what's wrong with a malformed file.

## Complete Python writer (numpy only — copy/paste)

```python
import struct
import numpy as np

def write_inst(path, positions, sizes=None, colors=None, orientations=None,
               scalars=None, provenance=""):
    """positions: (N,3); sizes: (N,) radii; colors: (N,3) LINEAR RGB;
    orientations: (N,4) unit quats [x,y,z,w]; scalars: dict name -> (N,)."""
    positions = np.asarray(positions, dtype="<f4")
    n = positions.shape[0]
    scalars = scalars or {}
    flags = (1 if sizes is not None else 0) \
          | (2 if colors is not None else 0) \
          | (4 if orientations is not None else 0)
    aabb = np.concatenate([positions.min(axis=0), positions.max(axis=0)])
    prov = provenance.encode("utf-8")
    with open(path, "wb") as f:
        f.write(b"INST")
        f.write(struct.pack("<3I", 1, n, flags))
        f.write(aabb.astype("<f4").tobytes())
        f.write(struct.pack("<I", len(scalars)))
        for name in scalars:
            nb = name.encode("utf-8")
            assert 1 <= len(nb) < 32, f"column name '{name}' must be 1..31 bytes"
            f.write(nb + b"\0" * (32 - len(nb)))
        f.write(struct.pack("<I", len(prov)))
        f.write(prov + b"\0" * (-len(prov) % 4))
        f.write(positions.tobytes())
        if sizes is not None:
            f.write(np.asarray(sizes, dtype="<f4").tobytes())
        if colors is not None:
            f.write(np.asarray(colors, dtype="<f4").tobytes())
        if orientations is not None:
            f.write(np.asarray(orientations, dtype="<f4").tobytes())
        for name in scalars:
            f.write(np.asarray(scalars[name], dtype="<f4").tobytes())

def srgb_to_linear(c):
    """Display colors (hex components / 255) -> the linear RGB the file wants."""
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
```

Example — points with a size-by-quantity law and a class palette:

```python
r = np.clip(0.3 / np.sqrt(quantity), 0.01, None)     # your law; respect the 0.01 floor
write_inst("mycloud.inst", xyz,
           sizes=r,
           colors=srgb_to_linear(rgb255 / 255.0),
           scalars={"quantity": quantity},            # ship the raw column too
           provenance="myframework v1.2 run=2026-08-07-a")
```

That's the whole interface: send the `.inst` file (they're compact — ~1.4M points with
all columns is ~45 MB) and tell us roughly what it is; we handle lighting, camera, and
materials on our side.
