import * as L from "./lib2.mjs"; import {PRESSURES} from "./designs.mjs";
const PRIOR={ROMANTIC:.35,FRIEND:.22,PSYCH:.20,MONEY:.12,TRAINER:.11};
const opts={
  C:{ "R+P1":{ROMANTIC:2,PSYCH:1}, "R+F1":{ROMANTIC:2,FRIEND:1}, "R only":{ROMANTIC:2} },
  R:{ "P+R1":{PSYCH:2,ROMANTIC:1}, "P only":{PSYCH:2} },
  P:{ "F+R1":{FRIEND:2,ROMANTIC:1}, "F only":{FRIEND:2}, "F+P1":{FRIEND:2,PSYCH:1} },
};
const D={MONEY:2,TRAINER:2};
const rows=[];
for(const [cn,c] of Object.entries(opts.C))for(const [rn,r] of Object.entries(opts.R))for(const [pn,p] of Object.entries(opts.P))for(const dom of [3,4]){
  const d={PRESSURES,SCORE:{q5:[c,r,p,D],q6:[r,p,D,c],q7:[D,c,r,p],q8:[p,D,c,r],q9:[c,p,r,D]},
    PRESSURE_SCORE:{money:{MONEY:dom},health:{TRAINER:dom},head:{PSYCH:dom},alone:{ROMANTIC:dom-1,FRIEND:1},notgood:{FRIEND:dom-1,PSYCH:1},change:{PSYCH:dom-1,FRIEND:1}}};
  const a=L.simulate(d,{n:30000,h:1,seed:3,prior:PRIOR}), b=L.simulate(d,{n:30000,h:0.7,seed:3,prior:PRIOR});
  const minRec=Math.min(...L.CORE_ORDER.map(k=>{const row=a.conf[k]||{};const n=Object.values(row).reduce((x,y)=>x+y,0)||1;return (row[k]||0)/n;}));
  rows.push({label:`C:${cn} R:${rn} P:${pn} dom${dom}`,acc1:a.acc,acc7:b.acc,tb1:a.tbRate,tb7:b.tbRate,minRec,ps:a.primOrSec});
}
rows.sort((x,y)=>(y.acc7+y.minRec*0.3)-(x.acc7+x.minRec*0.3));
console.log("config".padEnd(42),"acc(h1) acc(h.7) tb(h1) minRecall(h1) prim|sec");
for(const r of rows.slice(0,10)) console.log(r.label.padEnd(42),(100*r.acc1).toFixed(1).padStart(6),(100*r.acc7).toFixed(1).padStart(8),(100*r.tb1).toFixed(1).padStart(7),(100*r.minRec).toFixed(1).padStart(10),(100*r.ps).toFixed(1).padStart(9));
console.log("... worst:"); for(const r of rows.slice(-2)) console.log(r.label.padEnd(42),(100*r.acc1).toFixed(1),(100*r.acc7).toFixed(1));
