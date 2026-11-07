// S3 float32: the 2*pi return, position error is uniform (no growth), large free-flight t,
// and the size of the bias if an ambient medium's free flight is truncated at 2*pi.
import { V, eucl, add, sub, scale, rng, unit3, f, sFlow } from './lib.ts';
const r = rng(4242);
const out = (s: string) => console.log(s);
const F = (a: V) => a.map(f);
const unit4 = (): V => { const a = [0,0,0,0].map(() => { const u = r(), v = r(); return Math.sqrt(-2*Math.log(u+1e-300))*Math.cos(2*Math.PI*v); }); const l = Math.sqrt(eucl(a, a)); return a.map((x) => x / l); };
const tangent = (p: V): V => { const a = unit4(); const t = sub(a, scale(p, eucl(a, p))); const l = Math.sqrt(eucl(t, t)); return t.map((x) => x / l); };
const sDist = (p: V, q: V) => { const a = Math.sqrt(eucl(sub(p, q), sub(p, q))), b = Math.sqrt(eucl(add(p, q), add(p, q))); return 2 * Math.atan2(a, b); };
const fflow = (p: V, v: V, t: number) => { const c = f(Math.cos(f(t))), s = f(Math.sin(f(t))); return p.map((x, i) => f(f(x * c) + f(v[i] * s))); };
const renorm = (p: V) => { const l = Math.sqrt(eucl(p, p)); return p.map((x) => x / l); };
const TWO_PI_F = f(6.28318530718);

// 1. A ray that misses returns to its origin at t = 2*pi; float32 TWO_PI constant.
{
    let worst = 0;
    for (let k = 0; k < 5000; k++) { const p = unit4(), v = tangent(p); worst = Math.max(worst, sDist(p, renorm(fflow(F(p), F(v), TWO_PI_F)))); }
    out(`[1] float32 TWO_PI = ${TWO_PI_F} (2pi + ${(TWO_PI_F - 2 * Math.PI).toExponential(2)}); max dist(p, flow(p,v,TWO_PI)) in float32 = ${worst.toExponential(2)}`);
}

// 2. Position error of flowed float32 points does not grow with where they are.
{
    for (const t of [0.5, 1.5, 3.0, 3.14, 4.5, 6.0]) {
        let worst = 0;
        for (let k = 0; k < 5000; k++) { const p = unit4(), v = tangent(p); worst = Math.max(worst, sDist(sFlow(p, v, t), renorm(fflow(F(p), F(v), t)))); }
        out(`[2] t=${t}: max arc error of float32 flowed point (radial renorm) ${worst.toExponential(2)}; 2^-23 = ${(2 ** -23).toExponential(2)}`);
    }
}

// 3. Long free flights: t = -log(1-xi)/sigma can be ~17/sigma. Error of the event point if
//    t is used directly in float32 (fround(t) representation alone) vs reduced mod 2*pi first.
{
    for (const t of [10.123456789, 100.123456789, 1000.123456789, 10000.123456789]) {
        const p = unit4(), v = tangent(p);
        const exact = sFlow(p, v, t);
        const direct = sFlow(p, v, f(t));                          // only the argument rounding (optimistic: real GPU sin/cos of large args is worse)
        const red = f(f(t) - f(TWO_PI_F * Math.floor(f(t) / TWO_PI_F)));   // GLSL mod(t, TWO_PI)
        const reduced = sFlow(p, v, red);
        out(`[3] t=${t}: arc error from rounding t alone ${sDist(exact, direct).toExponential(2)}; after mod(t, TWO_PI) in float32 ${sDist(exact, reduced).toExponential(2)}`);
    }
}

// 4. Ambient medium in S3: probability that a free flight survives a full lap (2*pi), which a
//    2*pi truncation turns into black, and the expected laps if instead the walk re-traces the lap.
{
    for (const sig of [0.001, 0.01, 0.1, 0.5, 1]) {
        const p = Math.exp(-2 * Math.PI * sig);
        out(`[4] sigma_t=${sig}: P(survive one lap) = ${p.toFixed(4)}; expected laps until an event = ${(1 / (1 - p)).toFixed(1)}`);
    }
}

// 5. Point light at the antipode region: irradiance on both arcs, I/sin^2 d each; flux check:
//    integral over the geodesic sphere of radius d of I/sin^2 d = 4 pi I for every d.
{
    for (const d of [0.3, 1.5, 3.0]) out(`[5] d=${d}: area 4pi sin^2 d * (I/sin^2 d) = 4pi I; short arc ${d}, long arc ${(2 * Math.PI - d).toFixed(4)}, same falloff 1/sin^2 = ${(1 / Math.sin(d) ** 2).toFixed(4)}`);
}
