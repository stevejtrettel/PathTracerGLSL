// float32 sinh written as (e^x - e^-x)/2 (the GLSL ES definition [mem]) vs exact, small x
import { mk, F32, fmt } from './common.ts';
const A = mk(F32);
for (const x of [1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.1]) console.log(`x=${fmt(x)} rel err of (e^x-e^-x)/2 in f32: ${fmt(Math.abs(A.sinhGLSL(x) - Math.sinh(x)) / Math.sinh(x))}; x itself as sinh: ${fmt(Math.abs(Math.fround(x) - Math.sinh(x)) / Math.sinh(x))}`);
