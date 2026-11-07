// Per-column bokeh-edge means (disk), exact in p, integrating over box pixel jitter in x.
const W=160,H=120,tanF=Math.tan(0.4),aspect=W/H,F=2,R=0.5,c=R/2;
const disk=(t)=>{ if(t>=R) return 0; if(t<=-R) return 1; const a=Math.acos(t/R); return (a-Math.sin(a)*Math.cos(a))/Math.PI; };
// hexagon, vertex on +x, circumradius R: area fraction with x > t (t in [R/2, R])
const hex=(t)=>{ if(t>=R) return 0; const h=R-t; /* cap triangle similar */ const capArea=(Math.sqrt(3)/4)*R*R*(h/(R/2))**2; return capArea/((3*Math.sqrt(3)/2)*R*R); };
for (const col of [79,80]) {
  let sd=0, sh=0, n=10000;
  for (let i=0;i<n;i++){ const fx=col+(i+0.5)/n; const s=(2*fx/W-1)*aspect*tanF*F; sd+=disk(c+2*s); sh+=hex(c+2*s);}
  console.log(`column ${col}: disk ${(sd/n).toFixed(5)} hex ${(sh/n).toFixed(5)}`);
}
// radially truncated Gaussian sampling check: r^2 = -2 s^2 ln(1 - xi (1 - e^{-k^2/2}))
const s=0.5,k=2; let N=1e6, inside=0, maxr=0;
for(let i=0;i<N;i++){const xi=Math.random(); const r=s*Math.sqrt(-2*Math.log(1-xi*(1-Math.exp(-k*k/2)))); if(r<=s*k+1e-12) inside++; maxr=Math.max(maxr,r);}
console.log(`radial-truncated Box-Muller: max r ${maxr.toFixed(4)} (cut ${s*k}), inside ${inside}/${N}`);
