// Quadrature convergence + sanity values for the energy albedos.
import { E_cond, A_diel, G1, woOf } from './twin.ts';
const t0 = Date.now();
for (const [mu, r] of [[1, 0.5], [0.5, 0.5], [0.1, 1], [0.02, 1], [0.5, 1], [1, 1]]) {
    const a = Math.max(1e-3, r * r);
    const e = [64, 256, 1024].map(N => E_cond(mu, a, N));
    console.log(`cond mu=${mu} r=${r}: N64=${e[0].toFixed(6)} N256=${e[1].toFixed(6)} N1024=${e[2].toFixed(6)}`);
}
for (const [mu, r, eta] of [[0.5, 0.5, 1 / 1.5], [0.1, 0.7, 1.5], [0.9, 0.3, 1.5], [0.4, 1, 1.5], [0.15, 0.5, 1 / 1.5]]) {
    const a = Math.max(1e-3, r * r);
    const e = [64, 256, 1024].map(N => A_diel(mu, a, eta, N));
    console.log(`diel mu=${mu} r=${r} eta=${eta.toFixed(3)}: N64=${e[0].toFixed(6)} N256=${e[1].toFixed(6)} N1024=${e[2].toFixed(6)}`);
}
// Cross-check against rough_dielectric.md's measured table (r=0.5 rows): air→glass cos 0.70 → 0.9791; glass→air cos 0.40 → 0.8064
console.log('md check air→glass mu .7 r .5 (doc 0.9791):', A_diel(0.7, 0.25, 1 / 1.5, 512).toFixed(4));
console.log('md check glass→air mu .4 r .5 (doc 0.8064):', A_diel(0.4, 0.25, 1.5, 512).toFixed(4));
console.log('md check glass→air mu .15 r .7 (doc 0.6105):', A_diel(0.15, 0.49, 1.5, 512).toFixed(4));
// index-matched limit: eta → 1 should approach G1(wo)
for (const eta of [1.001, 0.999]) console.log(`eta=${eta} mu=.3 r=.8: A=${A_diel(0.3, 0.64, eta, 512).toFixed(5)} G1(wo)=${G1(woOf(0.3), 0.64).toFixed(5)}`);
// very large eta ratio → conductor limit
console.log('eta=1e3 (exit) vs cond, mu .5 r .7:', A_diel(0.5, 0.49, 1000, 512).toFixed(5), E_cond(0.5, 0.49, 512).toFixed(5));
console.log('eta=1e-3 (enter) vs cond, mu .5 r .7:', A_diel(0.5, 0.49, 1e-3, 512).toFixed(5));
console.log('ms', Date.now() - t0);
