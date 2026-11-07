// Object-space thin lens (thinlens.glsl) vs a real thin lens (Gaussian optics): angular blur radius of a point at depth z.
const f = 0.05, N = 1.8, F = 2.0, h = 0.024;
const v = F * f / (F - f);                     // image distance focused at F
const R = f / (2 * N);                          // entrance-pupil radius = proposed `aperture`
const fov = 2 * Math.atan(h / (2 * v));
console.log(`50mm f/1.8 @2m (meters): v=${v.toFixed(6)} fov=${fov.toFixed(6)} rad (${(fov * 180 / Math.PI).toFixed(3)} deg) aperture=${R.toFixed(6)}`);
let maxRel = 0;
for (const z of [0.5, 1, 1.5, 2.5, 4, 10, 100]) {
    // renderer: lens point p → focus point q (on axis, depth F); at depth z the bundle is a disk of radius R|1 - z/F|; angle from lens centre:
    const objAng = R * Math.abs(1 - z / F) / z;
    // real lens: image of depth z at vz = z f/(z - f); blur diameter on the sensor (at v) c = D |vz - v| / vz, D = f/N; angle = (c/2)/v
    const vz = z * f / (z - f);
    const realAng = (f / N) * Math.abs(vz - v) / vz / 2 / v;
    maxRel = Math.max(maxRel, Math.abs(objAng - realAng) / realAng);
    console.log(`z=${z}: object-space ${objAng.toExponential(6)}  real ${realAng.toExponential(6)}`);
}
console.log(`max relative difference ${maxRel.toExponential(2)}`);
