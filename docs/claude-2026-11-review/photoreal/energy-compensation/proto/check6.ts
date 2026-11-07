import { E_cond } from './twin.ts';
for (const mu of [1, 0.995, 0.98, 0.95, 0.9]) console.log(`E(mu=${mu}, alpha=1) = ${E_cond(mu, 1, 1024).toFixed(5)}`);
console.log('1 - ln 2 =', (1 - Math.LN2).toFixed(6));
