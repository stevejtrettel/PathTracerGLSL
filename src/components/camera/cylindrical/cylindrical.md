# Cylindrical panorama camera — what it computes and why

The "stitched wide panorama" projection: wrap a unit cylinder around the camera with its
axis along `up`, and read the image off the cylinder wall.

**Square pixels via one focal length.** Two independent angle dials (hfov + vfov) scaled to
fill the window would give non-square pixels — spheres render as ellipses — because the
degrees-per-pixel differ per axis unless the window aspect happens to match. Instead, both
axes share ONE focal length `f = width_px / hfov` (the cylinder radius, in pixels), set by
the single horizontal-sweep dial. Then the vertical field FOLLOWS the window aspect at
square pixels — the render is perspectivally correct at any window size, and resizing shows
more/less vertically rather than stretching (standard panorama-viewer behavior).

From the centered pixel `c = film − imageSize/2`:

- **`hfov`** (width in degrees, up to 360°) sets `f = width_px / radians(hfov)`.
- **azimuth** `φ = c.x / f` — *linear* in x, so **vertical lines stay straight** (the
  panorama's defining property); horizontal lines bow.
- **cylinder height** `h = c.y / f` — SAME `f`, hence square pixels. Elevation `θ = atan(h)`;
  the vertical fov is the derived `2·atan(height_px / (2f))`.
- ray: `dir = normalize(cos φ·forward + sin φ·right + h·up)` in the look-at frame (with the
  pinhole degenerate-axis guard). The horizontal part rides the unit cylinder; `h·up` climbs
  it.

Fills the full rectangle (no mask); `hfov` is a live slider in DEGREES. Changing it changes
the INTEGRAL (measurement), so it does not converge to any other camera. (An exact vertical
fov would require letterboxing the fixed content aspect — a deliberate alternative, not the
default.)
