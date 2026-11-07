// Scratch: float32 emulation (Math.fround after every op) of the two conductor-Fresnel forms,
// against float64 pbrt FrComplex. Usage: npx tsx float32.ts <pbrt spectrum.cpp>
import { readFileSync } from 'node:fs';
const f = Math.fround;
const src = readFileSync(process.argv[2], 'utf8');
function table(name: string): [number, number][] {
    const m = src.match(new RegExp(`const Float ${name}\\[\\] = \\{([^}]*)\\}`))!;
    const nums = m[1].split(',').map(s => s.trim()).filter(Boolean).map(Number);
    const out: [number, number][] = [];
    for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
    return out;
}
function plin(t: [number, number][], l: number) {
    let i = 0; while (t[i + 1][0] < l) i++;
    const u = (l - t[i][0]) / (t[i + 1][0] - t[i][0]);
    return t[i][1] * (1 - u) + t[i + 1][1] * u;
}
type C = [number, number];
function frComplex64(cosI: number, eta: number, k: number): number {
    const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
    const cdiv = (a: C, b: C): C => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
    const csqrt = (z: C): C => { const r = Math.hypot(z[0], z[1]); return [Math.sqrt(0.5 * (r + z[0])), Math.sqrt(Math.max(0, 0.5 * (r - z[0]))) * (z[1] < 0 ? -1 : 1)]; };
    const n2 = (z: C) => z[0] * z[0] + z[1] * z[1];
    const e: C = [eta, k], s2 = 1 - cosI * cosI;
    const sin2t = cdiv([s2, 0], cmul(e, e));
    const ct = csqrt([1 - sin2t[0], -sin2t[1]]);
    const ec = cmul(e, [cosI, 0]), ect = cmul(e, ct);
    return (n2(cdiv([ec[0] - ct[0], ec[1] - ct[1]], [ec[0] + ct[0], ec[1] + ct[1]]))
          + n2(cdiv([cosI - ect[0], -ect[1]], [cosI + ect[0], ect[1]]))) / 2;
}
// Mitsuba real form, every op rounded to float32 (GLSL highp).
function frMitsuba32(c: number, er: number, ei: number): number {
    c = f(c); er = f(er); ei = f(ei);
    const c2 = f(c * c), s2 = f(1 - c2), s4 = f(s2 * s2);
    const t1 = f(f(f(er * er) - f(ei * ei)) - s2);
    const a2pb2 = f(Math.sqrt(Math.max(0, f(f(t1 * t1) + f(f(f(4 * ei) * ei) * f(er * er))))));
    const a = f(Math.sqrt(Math.max(0, f(0.5 * f(a2pb2 + t1)))));
    const term1 = f(a2pb2 + c2), term2 = f(f(2 * c) * a);
    const rs = f(f(term1 - term2) / f(term1 + term2));
    const term3 = f(f(a2pb2 * c2) + s4), term4 = f(term2 * s2);
    const rp = f(rs * f(f(term3 - term4) / f(term3 + term4)));
    return f(0.5 * f(rs + rp));
}
// pbrt complex form, float32.
function frComplex32(cosI: number, eta: number, k: number): number {
    const cmul = (a: C, b: C): C => [f(f(a[0] * b[0]) - f(a[1] * b[1])), f(f(a[0] * b[1]) + f(a[1] * b[0]))];
    const cdiv = (a: C, b: C): C => { const d = f(f(b[0] * b[0]) + f(b[1] * b[1])); return [f(f(f(a[0] * b[0]) + f(a[1] * b[1])) / d), f(f(f(a[1] * b[0]) - f(a[0] * b[1])) / d)]; };
    const csqrt = (z: C): C => { const r = f(Math.sqrt(f(f(z[0] * z[0]) + f(z[1] * z[1])))); return [f(Math.sqrt(Math.max(0, f(0.5 * f(r + z[0]))))), f(f(Math.sqrt(Math.max(0, f(0.5 * f(r - z[0]))))) * (z[1] < 0 ? -1 : 1))]; };
    const n2 = (z: C) => f(f(z[0] * z[0]) + f(z[1] * z[1]));
    cosI = f(cosI); const e: C = [f(eta), f(k)], s2 = f(1 - f(cosI * cosI));
    const sin2t = cdiv([s2, 0], cmul(e, e));
    const ct = csqrt([f(1 - sin2t[0]), f(-sin2t[1])]);
    const ec = cmul(e, [cosI, 0]), ect = cmul(e, ct);
    return f(f(n2(cdiv([f(ec[0] - ct[0]), f(ec[1] - ct[1])], [f(ec[0] + ct[0]), f(ec[1] + ct[1])]))
          + n2(cdiv([f(cosI - ect[0]), f(-ect[1])], [f(cosI + ect[0]), ect[1]]))) / 2);
}
const cases: [string, (l: number) => [number, number]][] = ['Au', 'Cu', 'Ag', 'Al', 'CuZn'].map(m => {
    const te = table(`${m}_eta`), tk = table(`${m}_k`);
    return [m, (l: number) => [plin(te, l), plin(tk, l)] as [number, number]];
});
cases.push(['perfect (eta=0,k=1)', () => [0, 1]]);
cases.push(['eta=0,k=0.1', () => [0, 0.1]]);
cases.push(['eta=1.5,k=1e-4', () => [1.5, 1e-4]]);
cases.push(['eta=0.05,k=8', () => [0.05, 8]]);
for (const [name, nk] of cases) {
    let em = 0, ec = 0, minPerfect = 1;
    for (let l = 360; l <= 830; l += 2) for (let i = 0; i <= 1000; i++) {
        const c = i / 1000; const [n, k] = nk(l);
        const ref = frComplex64(c, n, k);
        const m32 = frMitsuba32(c, n, k), c32 = frComplex32(c, n, k);
        em = Math.max(em, Math.abs(m32 - ref)); ec = Math.max(ec, Math.abs(c32 - ref));
        if (name.startsWith('perfect')) minPerfect = Math.min(minPerfect, m32);
    }
    console.log(`${name.padEnd(22)} max|float32 Mitsuba - f64| ${em.toExponential(2)}   max|float32 pbrt complex - f64| ${ec.toExponential(2)}${name.startsWith('perfect') ? `   min Mitsuba32 F = ${minPerfect}` : ''}`);
}
