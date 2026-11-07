// Scratch TS twin of pbrt-v4 src/pbrt/util/noise.cpp (Noise, FBm, Turbulence without differentials).
import { readFileSync } from 'node:fs';
const P: number[] = JSON.parse(readFileSync(new URL('./perm.json', import.meta.url), 'utf8'));
const f = Math.fround;
const perm = (i: number) => P[i & 255];   // NoisePerm[i] for i < 512 (table = two copies)
function grad(x: number, y: number, z: number, dx: number, dy: number, dz: number): number {
  let h = perm(perm(perm(x) + y) + z) & 15;
  const u = h < 8 || h === 12 || h === 13 ? dx : dy;
  const v = h < 4 || h === 12 || h === 13 ? dy : dz;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}
const w = (t: number) => 6 * t ** 5 - 15 * t ** 4 + 10 * t ** 3;
const lerp = (t: number, a: number, b: number) => (1 - t) * a + t * b;
export function noise(x: number, y: number, z: number): number {
  const ix0 = Math.floor(x), iy0 = Math.floor(y), iz0 = Math.floor(z);
  const dx = x - ix0, dy = y - iy0, dz = z - iz0;
  const ix = ix0 & 255, iy = iy0 & 255, iz = iz0 & 255;
  const w000 = grad(ix, iy, iz, dx, dy, dz), w100 = grad(ix + 1, iy, iz, dx - 1, dy, dz);
  const w010 = grad(ix, iy + 1, iz, dx, dy - 1, dz), w110 = grad(ix + 1, iy + 1, iz, dx - 1, dy - 1, dz);
  const w001 = grad(ix, iy, iz + 1, dx, dy, dz - 1), w101 = grad(ix + 1, iy, iz + 1, dx - 1, dy, dz - 1);
  const w011 = grad(ix, iy + 1, iz + 1, dx, dy - 1, dz - 1), w111 = grad(ix + 1, iy + 1, iz + 1, dx - 1, dy - 1, dz - 1);
  const wx = w(dx), wy = w(dy), wz = w(dz);
  return lerp(wz, lerp(wy, lerp(wx, w000, w100), lerp(wx, w010, w110)), lerp(wy, lerp(wx, w001, w101), lerp(wx, w011, w111)));
}
export function fbm(x: number, y: number, z: number, omega: number, octaves: number): number {
  let sum = 0, l = 1, o = 1;
  for (let i = 0; i < octaves; i++) { sum += o * noise(l * x, l * y, l * z); l *= 1.99; o *= omega; }
  return sum;
}
export function turb(x: number, y: number, z: number, omega: number, octaves: number): number {
  let sum = 0, l = 1, o = 1;
  for (let i = 0; i < octaves; i++) { sum += o * Math.abs(noise(l * x, l * y, l * z)); l *= 1.99; o *= omega; }
  return sum;
}
