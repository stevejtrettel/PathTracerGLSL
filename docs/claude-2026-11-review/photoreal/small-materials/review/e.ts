const PI=Math.PI, sq=(x:number)=>x*x;
function E(x:number,y:number){const s=y*(0.0206607+1.58491*y)/(0.0379424+y*(1.32227+y));
const m=y*(-0.193854+y*(-1.14885+y*(1.7932-0.95943*y*y)))/(0.046391+y);
const o=y*(0.000654023+(-0.0207818+0.119681*y)*y)/(1.26264+y*(-1.92021+y));
return Math.exp(-0.5*sq((x-m)/s))/(s*Math.sqrt(2*PI))+o;}
for (const r of [0.05,0.3,0.5,1]) {
  const row=[1,0.9,0.7,0.5,0.3,0.2,0.1,0.05].map(mu=>E(mu,r).toFixed(4)).join(' ');
  // mean over a sphere disk seen orthographically: integral E(mu) 2 mu dmu ; and center 10% box approx mu in [~0.99,1]
  let m=0; const N=10000; for(let i=0;i<N;i++){const mu=(i+0.5)/N; m+=Math.min(1,Math.max(0,E(mu,r)))*2*mu/N;}
  console.log(`r=${r}: E(mu=1,.9,.7,.5,.3,.2,.1,.05)= ${row}  disk-mean=${m.toFixed(4)}`);
}
// sensitivity of c=rho furnace NEE arm to a 10% D normalization error, W=1, rho=0.4: delta = rho*E*0.1
for (const r of [0.05,0.5,1]) console.log(`r=${r} center: 10% D error -> ${(0.4*E(0.99,r)*0.1).toExponential(2)} ; at mu=.2 -> ${(0.4*E(0.2,r)*0.1).toExponential(2)}`);
