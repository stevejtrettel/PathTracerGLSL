// Independent re-implementation (does not import space.ts). Column-major-free: matrices as number[4][4].
type V = number[]; type M = number[][];
const f = Math.fround;
const sg = (H: boolean) => (H ? -1 : 1);
const dot = (H: boolean, a: V, b: V) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+sg(H)*a[3]*b[3];
const mm = (A: M, B: M): M => A.map((r) => [0,1,2,3].map((j) => r.reduce((s, x, k) => s + x*B[k][j], 0)));
const mv = (A: M, v: V): V => A.map((r) => r.reduce((s, x, k) => s + x*v[k], 0));
const I = (): M => [0,1,2,3].map((i) => [0,1,2,3].map((j) => +(i===j)));
// exp of the generator: walk distance |v| along v from o. H: boost; S: rotation in the (u,w) plane.
function T(H: boolean, v: V): M {
  const d = Math.hypot(v[0],v[1],v[2]); const R = I(); if (d===0) return R;
  const u = v.map((x)=>x/d); const c = H?Math.cosh(d):Math.cos(d), s = H?Math.sinh(d):Math.sin(d);
  // R = I + (c-1)(u u^T on xyz + e4e4^T) + s(u e4^T + sg' e4 u^T)
  for (let i=0;i<3;i++){ for(let j=0;j<3;j++) R[i][j] += (c-1)*u[i]*u[j]; R[i][3] = s*u[i]; R[3][i] = (H?1:-1)*s*u[i]; }
  R[3][3] = c; return R;
}
const expO = (H: boolean, v: V): V => mv(T(H, v), [0,0,0,1]);
function logO(H: boolean, P: V): V { const n = Math.hypot(P[0],P[1],P[2]); if(!n) return [0,0,0]; const d = H?Math.asinh(n):Math.atan2(n,P[3]); return [0,1,2].map((i)=>P[i]*d/n); }
const inv = (H: boolean, g: M): M => g[0].map((_, j) => g.map((r, i) => r[j] * (H && (i===3)!==(j===3) ? -1 : 1))); // J g^T J (H) or g^T
const n3 = (v: V) => { const l = Math.hypot(v[0],v[1],v[2]); return v.map((x)=>x/l); };
const cr = (a: V, b: V) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function look(fw: V) { const F = n3(fw); const up = Math.abs(F[1])>0.999999?[0,0,1]:[0,1,0]; const R = n3(cr(F, up)); const U = cr(R, F); return {F, R, U}; }
const t4 = (v: V) => [v[0],v[1],v[2],0];
function camOrigin(H: boolean, pos: V, tgt: V) { const G = T(H,pos); const f0 = logO(H, mv(inv(H,G), expO(H,tgt))); const b = look(f0); return { G, P: mv(G,[0,0,0,1]), F: mv(G,t4(b.F)), R: mv(G,t4(b.R)), U: mv(G,t4(b.U)) }; }
function camTarget(H: boolean, pos: V, tgt: V) { const TT = T(H,tgt); const Pp = mv(inv(H,TT), expO(H,pos)); const v = logO(H,Pp); const b = look(v.map((x)=>-x)); const G = mm(TT, T(H,v)); return { P: mv(G,[0,0,0,1]), F: mv(G,t4(b.F)), R: mv(G,t4(b.R)), U: mv(G,t4(b.U)) }; }
function orbitPos(H: boolean, tgt: V, d: number, az: number, el: number) { const u = [Math.cos(el)*Math.sin(az), Math.sin(el), Math.cos(el)*Math.cos(az)]; return logO(H, mv(T(H,tgt), expO(H, u.map((x)=>d*x)))); }

console.log('(a) holonomy roll between the two up rules');
for (const [H, tgt, d] of [[true,[3,0,0],2],[false,[1.2,0,0],0.8]] as [boolean,V,number][]) {
  let w = 0; for (let i=0;i<720;i++){ const az = i/720*2*Math.PI; const p = orbitPos(H,tgt,d,az,0.3); const a = camOrigin(H,p,tgt), b = camTarget(H,p,tgt); w = Math.max(w, Math.acos(Math.max(-1,Math.min(1,dot(H,a.U,b.U))))); }
  console.log(`  ${H?'H3':'S3'} target ${tgt} orbit d=${d} el=0.3: max roll ${(w*180/Math.PI).toFixed(2)} deg`);
}

console.log('(b) f32 error of the ray as the OBJECT sees it (local frame), H3, origin-centered frame');
console.log('    object 1 unit ahead of the camera; Ginv rounded to f32; f32 pinhole and f32 mat-vec');
function f32local(H: boolean, camPos: V, cam: any, Ginv: M) {
  let wo = 0, wd = 0;
  for (let k=0;k<200;k++){
    const a = 2*((k*0.6180339)%1)-1, b = 2*((k*0.4142135)%1)-1, kk = 1/Math.sqrt(1+a*a+b*b);
    const d64 = [0,1,2,3].map((i)=>kk*(cam.F[i]+a*cam.R[i]+b*cam.U[i]));
    const lo64 = mv(Ginv, cam.P), ld64 = mv(Ginv, d64);
    const P32 = cam.P.map(f), F32 = cam.F.map(f), R32 = cam.R.map(f), U32 = cam.U.map(f), G32 = Ginv.map((r)=>r.map(f));
    const kk32 = f(1/Math.sqrt(f(1+f(f(a*a)+f(b*b)))));
    const d32 = [0,1,2,3].map((i)=>f(kk32*f(f(F32[i]+f(a*R32[i]))+f(b*U32[i]))));
    const mv32 = (A: M, v: V) => A.map((r)=>f(f(f(f(r[0]*v[0])+f(r[1]*v[1]))+f(r[2]*v[2]))+f(r[3]*v[3])));
    const lo32 = mv32(G32, P32), ld32 = mv32(G32, d32);
    wo = Math.max(wo, ...[0,1,2,3].map((i)=>Math.abs(lo32[i]-lo64[i])));
    wd = Math.max(wd, ...[0,1,2,3].map((i)=>Math.abs(ld32[i]-ld64[i])));
  }
  return {wo, wd};
}
for (const dc of [0,2,4,5,6,8]) {
  const H = true; const pos = [dc,0,0], tgt = [dc+1,0.3,0.2];
  const cam = camOrigin(H,pos,tgt);
  // object at the point 1 unit ahead along F, rotation identity in its transported frame
  const objP = mv(T(H,pos), expO(H, [1,0,0]));
  const Ginv = inv(H, T(H, logO(H,objP)));
  const r = f32local(H, pos, cam, Ginv);
  // camera-relative: camera at the origin looking along +x, the same object 1 unit ahead
  const cam0 = camOrigin(H,[0,0,0],[1,0.3,0.2]);
  const r0 = f32local(H,[0,0,0],cam0, inv(H, T(H,[1,0,0])));
  console.log(`  camera ${dc} from o: local origin err ${r.wo.toExponential(2)}, local dir err ${r.wd.toExponential(2)} | camera-relative: ${r0.wo.toExponential(2)}, ${r0.wd.toExponential(2)}`);
}
console.log('(c) S3 same test');
for (const dc of [0,1,2,3]) {
  const H = false; const pos = [dc,0,0], tgt = [dc+0.5,0.1,0.1];
  const cam = camOrigin(H,pos,tgt); const objP = mv(T(H,pos), expO(H,[0.5,0,0]));
  const r = f32local(H,pos,cam, inv(H, T(H, logO(H,objP))));
  console.log(`  camera ${dc}: local origin err ${r.wo.toExponential(2)}, dir err ${r.wd.toExponential(2)}`);
}
console.log('(d) default pose [0,0,8]: S3 distance from o =', (8 % (2*Math.PI)).toFixed(3), ' -> geodesic distance', Math.min(8%(2*Math.PI), 2*Math.PI-8%(2*Math.PI)).toFixed(3));
