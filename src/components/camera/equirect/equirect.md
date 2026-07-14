# Equirectangular camera — what it computes and why

The measurement functional for a full-sphere panorama: every direction on the unit sphere
gets a pixel, laid out on the equirectangular (lat-long) grid. This is a **measurement**
change like every camera — pinhole and equirect do not converge to the same image.

The map, from the (jittered) pixel:

- `uv = jittered_pixel / u_imageSize` ∈ [0,1]².
- **azimuth** `phi = (uv.x − 0.5)·2π` ∈ [−π, π] — 0 at the image center (along `forward`),
  wrapping toward `right`; the ±π seam is directly behind the camera.
- **elevation** `theta = (uv.y − 0.5)·π` ∈ [−π/2, π/2] — 0 at the horizon, +π/2 (top of
  image) straight up along `up`, −π/2 (bottom) straight down.
- direction in the look-at frame:
  `dir = cos(theta)·(cos(phi)·forward + sin(phi)·right) + sin(theta)·up`.

`forward/right/up` come from the same look-at construction as pinhole, with the identical
degenerate up-reference guard (looking ∥ ±Y would otherwise NaN). Because the frame is
orthonormal the spherical combination is already unit; `normalize` only guards fp drift.

No `TAN_FOV`, no aperture: the whole sphere is the frame, so `xiLens` is ignored and there
are no model-unique params — the look-at pose (owned by the feature) is the entire
configuration. Sub-pixel jitter (`xiPixel`) still applies, so antialiasing is unchanged.
The image is naturally 2:1 (azimuth 2π, elevation π); other aspect ratios stretch rather
than crop.

Why this occupant matters beyond panoramas: it establishes "view over the full sphere in
the ambient space" and is the natural camera for immersive/curved-space renders — the
`Ray` seed feeds `ambient_*` unchanged, so the same equirect map will work once the
ambient space is non-Euclidean. Deferred: a configurable angular extent (partial
panoramas) and pole-aware antialiasing (the top/bottom rows oversample the poles).
