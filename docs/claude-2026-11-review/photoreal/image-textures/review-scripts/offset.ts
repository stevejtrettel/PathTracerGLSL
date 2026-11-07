const d=(c:number)=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
const codes=[[255,200,160,230],[128,64,192,96],[32,0,16,48],[8,80,24,40]];
const r=codes.map(row=>row.reduce((a,k)=>a+d(k/255),0)/4);
const c=[0,1,2,3].map(j=>codes.reduce((a,row)=>a+d(row[j]/255),0)/4);
console.log('rows',r,'cols',c);
console.log('top correct',7/16*(r[0]+r[1])+1/16*(r[2]+r[3]),'top no half-texel offset',0.25*r[0]+0.5*r[1]+0.25*r[2]);
console.log('left correct',7/16*(c[0]+c[1])+1/16*(c[2]+c[3]),'right',7/16*(c[2]+c[3])+1/16*(c[0]+c[1]));
