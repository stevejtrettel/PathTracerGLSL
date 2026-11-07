// A photographic lens described the way a photographer would (focal length, f-number, focus
// distance, sensor height), converted to the fields of the object-space `thinlens` camera.
//
// The thin-lens camera here is object-space: rays leave a lens disk of radius `aperture` at the
// camera position and converge on the plane at `focusDistance` along the view direction. A real
// thin lens of focal length f and f-number N, focused at distance F (measured from the lens),
// has entrance-pupil radius f/2N and forms its sharp image at v = F f/(F − f) behind the lens.
// With
//
//     aperture = f / 2N,    fov = 2 atan(h / 2v),    focusDistance = F,
//
// (h the sensor height, fov the full vertical angle) the two models agree: a point at depth z
// blurs over the angle (f/2N)·|1/z − 1/F| in both, since the real lens's blur-circle radius on
// the sensor, (f/2N)|v_z − v|/v_z, divided by v is the same quantity by the lens equation. So
// the depth of field is that of the real lens. Lengths in scene units are meters divided by
// `metersPerUnit`; angles are unitless.

/** A photographic lens. Every field is required: nothing here has a natural default. */
export interface PhotoLens {
    /** Focal length in millimeters. */
    focalLengthMm: number;
    /** f-number N = focal length / entrance-pupil diameter. */
    fNumber: number;
    /** Distance from the lens to the plane in focus, in SCENE UNITS (as the camera's own
     *  `focusDistance` field). */
    focusDistance: number;
    /** Height of the sensor (the image's vertical extent) in millimeters; 24 for full frame. */
    sensorHeightMm: number;
    /** Meters per scene unit (1 for a scene modeled in meters, 0.01 for centimeters). */
    metersPerUnit: number;
}

/** The thin-lens camera fields for a photographic lens. The pose (position, target) is the
 *  author's, to be spread alongside. Throws on a missing, non-finite or non-positive input, and
 *  when the focus distance is not beyond the focal length (no real image forms). */
export function thinLensFromPhoto(lens: PhotoLens): { type: 'thinlens'; fov: number; aperture: number; focusDistance: number } {
    for (const key of ['focalLengthMm', 'fNumber', 'focusDistance', 'sensorHeightMm', 'metersPerUnit'] as const) {
        const value: unknown = lens[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            throw new Error(`thinLensFromPhoto: ${key} must be a finite number > 0 (got ${String(value)})`);
        }
    }
    const f = lens.focalLengthMm / 1000;
    const F = lens.focusDistance * lens.metersPerUnit;
    if (F <= f) {
        throw new Error(`thinLensFromPhoto: the focus distance (${F} m) must exceed the focal length (${f} m), or no real image forms`);
    }
    const v = (F * f) / (F - f);
    return {
        type: 'thinlens',
        fov: 2 * Math.atan(lens.sensorHeightMm / 1000 / (2 * v)),
        aperture: f / (2 * lens.fNumber) / lens.metersPerUnit,
        focusDistance: lens.focusDistance,
    };
}
