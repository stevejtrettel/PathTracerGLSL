// GLSL ES 3.00 asinh precision is "inherited from" log(x + sqrt(x*x+1)) [mem]; emulate it in f32 for negative x.
import { f32, F } from './lib.ts';
for (const x of [-0.5, -10, -100, -1e3, -1e4]) {
  const naive = f32.asinh(x), sym = F(-f32.asinh(-x));
  console.log(`x=${x}: exact ${Math.asinh(x).toFixed(6)} | formula ${naive} | -asinh(|x|) ${sym}`);
}
